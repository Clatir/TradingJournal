/**
 * Field-level differences and three-way merges of records (JSON values).
 * - Objects are compared key by key; arrays of objects with a string `id` (exits, screens, sessions, dictionary
 *   items…) item by item; any other array, and scalars, as one value.
 * - merge3(base, mine, theirs): a field changed on one side only takes that side; changed on both sides to different
 *   values it is a conflict (`choose` decides, by default "mine"). Bookkeeping fields (updatedAt, updatedBy,
 *   schemaVersion, computed) never conflict: the newer / theirs wins.
 */

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export type Path = Array<string>

export interface FieldChange {
  path: Path
  before: unknown
  after: unknown
}

export interface MergeConflict {
  path: Path
  base: unknown
  mine: unknown
  theirs: unknown
}

export type Side = 'mine' | 'theirs'

/** Never shown nor in conflict: written by the app on every save. */
const BOOKKEEPING = new Set(['updatedAt', 'updatedBy', 'schemaVersion', 'computed'])

const isObject = (v: unknown): v is Record<string, unknown> => v != null && typeof v === 'object' && !Array.isArray(v)
const isIdArray = (v: unknown): v is Array<{ id: string }> =>
  Array.isArray(v) && v.every((x) => isObject(x) && typeof x.id === 'string')

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b || a == null || b == null) return a === b || (a == null && b == null)
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((x, i) => deepEqual(x, b[i]))
  }
  if (isObject(a) && isObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    for (const k of keys) if (!deepEqual(a[k], b[k])) return false
    return true
  }
  return false
}

export const pathKey = (p: Path) => p.join('\u0001')

/** Leaf-level changes from `a` to `b` (bookkeeping fields at the top level are left out). */
export function diffRecords(a: unknown, b: unknown, path: Path = []): FieldChange[] {
  if (deepEqual(a, b)) return []
  if (isObject(a) && isObject(b)) {
    const out: FieldChange[] = []
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (path.length === 0 && BOOKKEEPING.has(k)) continue
      out.push(...diffRecords(a[k], b[k], [...path, k]))
    }
    return out
  }
  if (isIdArray(a) && isIdArray(b) && (a.length || b.length)) {
    const out: FieldChange[] = []
    const ids = [...new Set([...a.map((x) => x.id), ...b.map((x) => x.id)])]
    for (const id of ids) {
      const x = a.find((i) => i.id === id)
      const y = b.find((i) => i.id === id)
      if (x && y) out.push(...diffRecords(x, y, [...path, `#${id}`]))
      else out.push({ path: [...path, `#${id}`], before: x, after: y })
    }
    return out
  }
  return [{ path, before: a, after: b }]
}

interface MergeResult<T> {
  merged: T
  conflicts: MergeConflict[]
}

/**
 * Three-way merge. `base` = the version both sides started from (undefined when unknown: then every difference
 * between mine and theirs is a conflict).
 */
export function merge3<T>(base: unknown, mine: T, theirs: T, choose: (conflict: MergeConflict) => Side = () => 'mine'): MergeResult<T> {
  const conflicts: MergeConflict[] = []
  const merged = mergeAt(base, mine, theirs, [], conflicts, choose) as T
  return { merged, conflicts }
}

const ABSENT = undefined

function mergeAt(base: unknown, mine: unknown, theirs: unknown, path: Path, conflicts: MergeConflict[], choose: (c: MergeConflict) => Side): unknown {
  if (deepEqual(mine, theirs)) return mine
  if (base !== ABSENT && deepEqual(base, mine)) return theirs
  if (base !== ABSENT && deepEqual(base, theirs)) return mine
  if (isObject(mine) && isObject(theirs)) {
    const b = isObject(base) ? base : undefined
    const out: Record<string, unknown> = {}
    const keys = [...new Set([...Object.keys(theirs), ...Object.keys(mine)])]
    for (const k of keys) {
      if (path.length === 0 && BOOKKEEPING.has(k)) {
        out[k] = theirs[k] ?? mine[k]
        continue
      }
      const v = mergeAt(b?.[k], mine[k], theirs[k], [...path, k], conflicts, choose)
      if (v !== undefined) out[k] = v
    }
    return out
  }
  if (isIdArray(mine) && isIdArray(theirs)) {
    const b = isIdArray(base) ? base : base === ABSENT ? undefined : []
    const byId = (arr: Array<{ id: string }> | undefined, id: string) => arr?.find((x) => x.id === id)
    // Order: theirs, then items only I added (in my order).
    const ids = [...theirs.map((x) => x.id), ...mine.map((x) => x.id).filter((id) => !byId(theirs, id))]
    const out: unknown[] = []
    for (const id of ids) {
      const m = byId(mine, id)
      const t = byId(theirs, id)
      const bi = byId(b, id)
      const p = [...path, `#${id}`]
      if (m && t) {
        out.push(mergeAt(bi, m, t, p, conflicts, choose))
      } else if (m && !t) {
        // Theirs removed it (it was in base) or I added it.
        if (!bi && b !== undefined) out.push(m)
        else if (bi && deepEqual(bi, m)) continue
        else if (pick({ path: p, base: bi, mine: m, theirs: undefined }, conflicts, choose) === 'mine') out.push(m)
      } else if (t && !m) {
        if (!bi && b !== undefined) out.push(t)
        else if (bi && deepEqual(bi, t)) continue
        else if (pick({ path: p, base: bi, mine: undefined, theirs: t }, conflicts, choose) === 'theirs') out.push(t)
      }
    }
    // Removals on both sides, or of an item only in base: nothing to add.
    return out
  }
  return pick({ path, base, mine, theirs }, conflicts, choose) === 'mine' ? mine : theirs
}

function pick(c: MergeConflict, conflicts: MergeConflict[], choose: (c: MergeConflict) => Side): Side {
  conflicts.push(c)
  return choose(c)
}

/** Choices keyed by the conflict path (from a dialog) as a `choose` function; unknown paths take `fallback`. */
export function chooser(choices: ReadonlyMap<string, Side> | Record<string, Side>, fallback: Side = 'mine'): (c: MergeConflict) => Side {
  const get = (k: string) => (choices instanceof Map ? choices.get(k) : (choices as Record<string, Side>)[k])
  return (c) => get(pathKey(c.path)) ?? fallback
}

// ------------------------------------------------------------------ labels for the UI

const LABELS: Record<string, string> = {
  status: 'Status',
  pair: 'Para',
  direction: 'Kierunek',
  entryTime: 'Czas wejścia',
  killzoneOverride: 'Killzone (ręcznie)',
  continuationOf: 'Kontynuacja',
  entryModelId: 'Model wejścia',
  entryPdArrayId: 'PD array wejścia',
  htfPdArrayId: 'PD array HTF',
  liquidityTakenIds: 'Zebrana płynność',
  'prices.entry': 'Cena wejścia',
  'prices.stopLoss': 'Stop loss',
  'prices.takeProfit1': 'TP1',
  'prices.takeProfit2': 'TP2',
  exits: 'Wyjścia',
  'exits.price': 'Wyjście – cena',
  'exits.time': 'Wyjście – czas',
  'exits.percent': 'Wyjście – %',
  'exits.note': 'Wyjście – notatka',
  maePips: 'MAE (pips)',
  mfePips: 'MFE (pips)',
  riskPercent: 'Ryzyko %',
  riskAmount: 'Kwota ryzyka',
  lots: 'Loty',
  pnlAmountOverride: 'Wynik (kwota)',
  amountCurrency: 'Waluta kwot',
  tradingViewUrl: 'Link TradingView',
  stopBeyondLiquidity: 'SL poza płynnością',
  'psychology.before.score': 'Psychologia – przed',
  'psychology.during.score': 'Psychologia – w trakcie',
  'psychology.after.score': 'Psychologia – po',
  'psychology.before.note': 'Psychologia – przed (notatka)',
  'psychology.during.note': 'Psychologia – w trakcie (notatka)',
  'psychology.after.note': 'Psychologia – po (notatka)',
  'psychology.mistakeTagIds': 'Tagi błędów',
  'psychology.didWell': 'Co zrobiłem dobrze',
  'psychology.nextTime': 'Następnym razem',
  'missed.reasonId': 'Powód (missed)',
  'missed.hypotheticalOutcome': 'Wynik hipotetyczny',
  notes: 'Notatki',
  screens: 'Screeny',
  broker: 'Dane brokera',
  date: 'Data',
  title: 'Tytuł',
  type: 'Rodzaj',
  review: 'Po sesji',
  'review.whatHappened': 'Po sesji – co się stało',
  'review.vsPlan': 'Po sesji – zgodnie z planem',
  'review.notes': 'Po sesji – notatki',
  news: 'Newsy',
  pairs: 'Pary',
  intermarket: 'Intermarket',
  sessions: 'Sesje analizy',
  wellbeing: 'Samopoczucie',
  name: 'Nazwa',
  settings: 'Ustawienia',
  dictionaries: 'Słowniki'
}

/** Polish label of a changed field: known fields by name, items of lists by their position in the path. */
export function fieldLabel(path: Path): string {
  const named = path.filter((p) => !p.startsWith('#'))
  const key = named.join('.')
  if (LABELS[key]) return LABELS[key]
  for (let i = named.length - 1; i > 0; i--) {
    const prefix = LABELS[named.slice(0, i).join('.')]
    if (prefix) return `${prefix} – ${named.slice(i).join('.')}`
  }
  return key || '(cały wpis)'
}

/** Short text of a value for the diff lists. */
export function formatValue(v: unknown, max = 80): string {
  if (v === undefined) return '—'
  if (v === null || v === '') return 'puste'
  if (typeof v === 'string') return v.length > max ? `${v.slice(0, max - 1)}…` : v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return v.length === 0 ? 'puste' : `${v.length} ${v.length === 1 ? 'pozycja' : v.length < 5 ? 'pozycje' : 'pozycji'}`
  const s = JSON.stringify(v)
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}
