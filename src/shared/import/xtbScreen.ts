/**
 * XTB "Szczegóły pozycji" (position details) read from a screenshot: OCR words (Tesseract TSV) → labelled values.
 * The panel is a grid of gray labels with values under them (times: date and clock in two rows); labels are matched
 * loosely (OCR drops diacritics and confuses letters), values are the words in the label's column under it, or on
 * its right in the same row. Times are XTB's Warsaw wall clock. Pure; the trade editor shows the result for review.
 */
import { DateTime } from 'luxon'
import { newId } from '../ids'
import type { BrokerFill, Trade } from '../schema'
import { normHeader, parseBrokerTime, parseNumber } from './broker'
import { brokerTimeToUtc, pairForSymbol } from './match'

export interface OcrWord {
  text: string
  left: number
  top: number
  width: number
  height: number
  /** Tesseract confidence 0–100. */
  conf: number
  /** Tesseract block / paragraph / line, "b.p.l". */
  line: string
}

/** Words of Tesseract's TSV output (level 5 rows with text). */
export function parseTesseractTsv(tsv: string): OcrWord[] {
  const out: OcrWord[] = []
  for (const row of tsv.split(/\r?\n/)) {
    const c = row.split('\t')
    if (c.length < 12 || c[0] !== '5') continue
    const text = (c[11] ?? '').trim()
    if (!text) continue
    const [left, top, width, height, conf] = [c[6], c[7], c[8], c[9], c[10]].map(Number) as [number, number, number, number, number]
    if (![left, top, width, height].every(Number.isFinite)) continue
    const word = { text, left, top, width, height, conf: Number.isFinite(conf) ? conf : 0, line: `${c[2]}.${c[3]}.${c[4]}` }
    out.push(...splitGlued(word))
  }
  return out
}

/** A truncated label glued to the next one ("zabezpiec..Swap") → two words, widths by characters. */
function splitGlued(w: OcrWord): OcrWord[] {
  const m = /^(.*\p{L}(?:\.{2,}|…))(\p{L}.*)$/u.exec(w.text)
  if (!m) return [w]
  const share = m[1]!.length / w.text.length
  const first = Math.round(w.width * share)
  return [
    { ...w, text: m[1]!, width: first },
    { ...w, text: m[2]!, left: w.left + first, width: w.width - first }
  ]
}

export type XtbField =
  | 'type'
  | 'volume'
  | 'profit'
  | 'gross'
  | 'openPrice'
  | 'closePrice'
  | 'openTime'
  | 'closeTime'
  | 'rollover'
  | 'margin'
  | 'swap'
  | 'commission'
  | 'stopLoss'
  | 'takeProfit'

/** Label spellings (normalized: lowercase ASCII letters only). Polish first, English xStation second. */
const LABELS: Record<XtbField, string[]> = {
  type: ['typ', 'type'],
  volume: ['wolumen', 'volume'],
  profit: ['zyskstrata', 'profit', 'pl', 'netprofit'],
  gross: ['zyskbrutto', 'grossprofit', 'grosspl'],
  openPrice: ['cenaotwarcia', 'openprice'],
  closePrice: ['cenazamkniecia', 'closeprice'],
  openTime: ['czasotwarcia', 'opentime'],
  closeTime: ['czaszamkniecia', 'closetime'],
  rollover: ['rolowanie', 'rollover'],
  margin: ['depozytzabezpieczajacy', 'margin'],
  swap: ['swap'],
  commission: ['prowizja', 'commission'],
  stopLoss: ['stoploss'],
  takeProfit: ['takeprofit']
}

const TIME_FIELDS: ReadonlySet<XtbField> = new Set(['openTime', 'closeTime'])

const letters = (s: string) => normHeader(s).replace(/[^a-z]/g, '')

function distance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j]!
      prev[j] = Math.min(up + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = up
    }
  }
  return prev[b.length]!
}

/** Does OCR text `s` (normalized) read as label `label`? Small typos allowed; a truncated label ("…") as a prefix. */
function labelMatches(s: string, label: string, truncated: boolean): boolean {
  if (!s) return false
  if (s === label) return true
  if (label.length <= 3) return false
  const tolerance = label.length >= 10 ? 2 : label.length >= 6 ? 1 : 0
  if (distance(s, label) <= tolerance) return true
  return truncated && s.length >= 8 && distance(s, label.slice(0, s.length)) <= tolerance
}

interface Box {
  text: string
  left: number
  top: number
  right: number
  bottom: number
  height: number
  line: string
}

const boxOf = (ws: readonly OcrWord[]): Box => ({
  text: ws.map((w) => w.text).join(' '),
  left: Math.min(...ws.map((w) => w.left)),
  top: Math.min(...ws.map((w) => w.top)),
  right: Math.max(...ws.map((w) => w.left + w.width)),
  bottom: Math.max(...ws.map((w) => w.top + w.height)),
  height: Math.max(...ws.map((w) => w.height)),
  line: ws[0]!.line
})

interface FoundLabel extends Box {
  field: XtbField
  words: Set<OcrWord>
}

/** A word that can be (part of) a label: letters, at most one stray digit from OCR noise ("2Zysk"). */
function isLabelWord(w: OcrWord): boolean {
  const l = (w.text.match(/\p{L}/gu) ?? []).length
  const d = (w.text.match(/\d/g) ?? []).length
  return l > 0 && (d === 0 || (d === 1 && l >= 3))
}

/** Labels: one to three adjacent words of one OCR line that read as a known label. */
function findLabels(words: readonly OcrWord[]): FoundLabel[] {
  const byLine = new Map<string, OcrWord[]>()
  for (const w of words) byLine.set(w.line, [...(byLine.get(w.line) ?? []), w])
  const found: FoundLabel[] = []
  const taken = new Set<XtbField>()
  for (const line of byLine.values()) {
    line.sort((a, b) => a.left - b.left)
    for (let i = 0; i < line.length; i++) {
      for (let n = 3; n >= 1; n--) {
        const ws = line.slice(i, i + n)
        if (ws.length < n) continue
        // Labels are words (a number next to a label is its value); words of one label are close to each other.
        if (!ws.every(isLabelWord)) continue
        if (ws.some((w, k) => k > 0 && w.left - (ws[k - 1]!.left + ws[k - 1]!.width) > 1.6 * Math.max(w.height, ws[k - 1]!.height))) continue
        const raw = ws.map((w) => w.text).join(' ')
        const s = letters(raw)
        const truncated = /(\.{2,}|…)$/.test(raw.trim())
        const field = (Object.keys(LABELS) as XtbField[]).find((f) => !taken.has(f) && LABELS[f].some((l) => labelMatches(s, l, truncated)))
        if (!field) continue
        found.push({ ...boxOf(ws), field, words: new Set(ws) })
        taken.add(field)
        i += n - 1
        break
      }
    }
  }
  return found
}

/** Rows of words (similar top), top to bottom, each left to right. */
function rowsOf(words: readonly OcrWord[]): OcrWord[][] {
  const rows: OcrWord[][] = []
  for (const w of [...words].sort((a, b) => a.top - b.top)) {
    const row = rows.find((r) => Math.abs(r[0]!.top + r[0]!.height / 2 - (w.top + w.height / 2)) < 0.6 * Math.max(w.height, r[0]!.height))
    if (row) row.push(w)
    else rows.push([w])
  }
  for (const r of rows) r.sort((a, b) => a.left - b.left)
  return rows
}

/** The first words of a row that are close together (a missing label must not join two columns' values). */
function firstCluster(row: readonly OcrWord[]): OcrWord[] {
  const out = [row[0]!]
  for (const w of row.slice(1)) {
    const prev = out[out.length - 1]!
    if (w.left - (prev.left + prev.width) > 1.5 * Math.max(w.height, prev.height)) break
    out.push(w)
  }
  return out
}

/** The value of a label: the words in its column under it (two rows for times), else on its right in its row. */
function valueOf(label: FoundLabel, labels: readonly FoundLabel[], free: readonly OcrWord[]): OcrWord[] | null {
  const h = label.height
  // The column ends where the next column starts: a label of any row to the right (rows of the grid share columns).
  const nextLeft = Math.min(...labels.filter((l) => l !== label && l.left > label.left + 2 * h).map((l) => l.left), Number.POSITIVE_INFINITY)
  const below = free.filter((w) => w.top >= label.bottom - 0.3 * h && w.left >= label.left - 1.5 * h && w.left < nextLeft - 0.5 * h && w.top - label.bottom < 3.5 * h)
  // Stop at the next label under this one (an empty value must not borrow the next row's).
  const nextBelow = Math.min(...labels.filter((l) => l.top > label.bottom && l.left < nextLeft && l.right > label.left - 1.5 * h).map((l) => l.top), Number.POSITIVE_INFINITY)
  const rows = rowsOf(below.filter((w) => w.top < nextBelow - 0.3 * h))
  const wanted = TIME_FIELDS.has(label.field) ? 2 : 1
  if (rows.length) {
    const first = rows[0]!
    // Rows of one value are close to each other (the date and the clock of a time).
    const picked = [first, ...rows.slice(1, wanted).filter((r, k) => r[0]!.top - (rows[k]![0]!.top + rows[k]![0]!.height) < 1.6 * h)]
    return picked.flatMap((r) => firstCluster(r))
  }
  // "Label  value" in one row.
  const right = free
    .filter((w) => Math.abs(w.top + w.height / 2 - (label.top + label.height / 2)) < 0.6 * h && w.left > label.right)
    .filter((w) => w.left < Math.min(...labels.filter((l) => l !== label && Math.abs(l.top - label.top) < h && l.left > label.right).map((l) => l.left), Number.POSITIVE_INFINITY))
    .sort((a, b) => a.left - b.left)
  return right.length ? firstCluster(right) : null
}

/** OCR number fixes: letters that look like digits inside a number, dashes as minus, a trailing currency. */
export function ocrNumber(s: string | null): number | null {
  if (!s) return null
  let t = s
    .trim()
    .replace(/\s*(?:[A-Z]{3}|zł|zl|\$|€)$/i, '')
    .replace(/^[—–−~]/, '-')
  if (!/\d/.test(t)) return null
  t = t.replace(/[Oo]/g, '0').replace(/[lI|]/g, '1').replace(/\s+/g, '')
  // "1 234.56" is fine, "1.12414" too; anything else with letters is not a number.
  return parseNumber(t)
}

/** "06.10.2026 09:58" (also with seconds, a comma, "2026-10-06", OCR "09.58" / "0958") → "2026-10-06T09:58:00". */
export function ocrTime(s: string | null): string | null {
  if (!s) return null
  const t = s.replace(/[Oo]/g, '0')
  const date = /(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})|(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/.exec(t)
  if (!date) return null
  const ymd = date[3] ? `${date[3]}-${date[2]}-${date[1]}` : `${date[4]}-${date[5]}-${date[6]}`
  const rest = t.slice(date.index + date[0].length)
  const clock = /(\d{1,2})\s*[:.]\s*(\d{2})(?:\s*[:.]\s*(\d{2}))?/.exec(rest) ?? /\b(\d{2})(\d{2})\b/.exec(rest)
  return parseBrokerTime(clock ? `${ymd} ${clock[1]}:${clock[2]}${clock[3] ? `:${clock[3]}` : ''}` : ymd)
}

function sideOf(s: string | null): 'long' | 'short' | null {
  const t = letters(s ?? '')
  if (/^(buy|kupno|kup|long)/.test(t)) return 'long'
  if (/^(sell|sprzedaz|sprzedaj|short)/.test(t)) return 'short'
  return null
}

const NOT_SYMBOLS = new Set(['CFD', 'STC', 'ETF', 'ETFCFD', 'BUY', 'SELL', 'SL', 'TP'])

/** Upper-case start of a word ("EURUSDcrD" → "EURUSD": OCR glues the small "CFD" badge to the symbol). */
const symbolPart = (text: string) => /^[A-Z0-9][A-Z0-9.#_]*/.exec(text.replace(/[^A-Za-z0-9.#_]/g, ''))?.[0] ?? ''

/**
 * Instrument symbol: the first line above the labels that starts with an upper-case token, e.g. "EURUSD", "DE40",
 * "US500", "OIL.WTI" (OCR may split it at the dot: "OIL WTI" → "OIL.WTI").
 */
function symbolOf(words: readonly OcrWord[], labels: readonly FoundLabel[]): { text: string; words: OcrWord[] } | null {
  const firstLabel = Math.min(...labels.map((l) => l.top), Number.POSITIVE_INFINITY)
  for (const row of rowsOf(words.filter((w) => w.top + w.height <= firstLabel))) {
    const taken: OcrWord[] = []
    for (const w of row) {
      const part = symbolPart(w.text)
      const whole = part.length === w.text.replace(/[^A-Za-z0-9.#_]/g, '').length
      const prev = taken[taken.length - 1]
      // An icon before the symbol (read as "‘®") is skipped.
      if (!prev && part.length < 2 && !/\p{L}{2}/u.test(w.text)) continue
      // A later word belongs to the symbol only when it is upper case through and close ("OIL" "WTI"), not "Cr".
      if (!part || NOT_SYMBOLS.has(part) || (prev && (!whole || w.left - (prev.left + prev.width) > 1.2 * Math.max(w.height, prev.height)))) break
      taken.push(w)
      // Lower case after the symbol ends it ("EURUSDcrD").
      if (!whole) break
    }
    const text = taken.map((w) => symbolPart(w.text)).join('.').replace(/\.{2,}/g, '.').replace(/^\.|\.$/g, '')
    if (text.replace(/[^A-Z]/g, '').length >= 2 && text.replace(/[^A-Z0-9]/g, '').length >= 3) return { text, words: taken }
  }
  return null
}

/** A part of the OCR'd image (its pixels), e.g. where a value was found – for a second, closer reading. */
export interface Region {
  left: number
  top: number
  width: number
  height: number
}

const regionOf = (ws: readonly OcrWord[]): Region => {
  const b = boxOf(ws)
  return { left: b.left, top: b.top, width: b.right - b.left, height: b.bottom - b.top }
}

export interface XtbPosition {
  symbol: string | null
  direction: 'long' | 'short' | null
  volume: number | null
  /** "Zysk/strata": the net result in the account currency. */
  profit: number | null
  gross: number | null
  openPrice: number | null
  closePrice: number | null
  /** Warsaw wall clock "YYYY-MM-DDTHH:mm:ss". */
  openTime: string | null
  closeTime: string | null
  rollover: number | null
  margin: number | null
  swap: number | null
  commission: number | null
  stopLoss: number | null
  takeProfit: number | null
  /** Texts found under each label (for the review). */
  raw: Partial<Record<XtbField, string>>
  /** Where the symbol and each value are in the image. */
  regions: Partial<Record<XtbField | 'symbol', Region>>
  /** Prices read without the decimal point (scaled to match the other prices when they allow it): suspicious. */
  undotted: PriceField[]
  /** The line under the symbol, e.g. "Euro to American Dollar currency pair". */
  description: string | null
  /** Every symbol read (several readings of one screenshot), most likely first. */
  symbols: string[]
  /** Values the readings disagreed on, with the other readings (to check in the review). */
  uncertain: Partial<Record<VotedKey, string[]>>
}

/** Values compared between readings. */
export type VotedKey =
  | 'symbol'
  | 'direction'
  | 'volume'
  | 'profit'
  | 'gross'
  | 'openPrice'
  | 'closePrice'
  | 'openTime'
  | 'closeTime'
  | 'rollover'
  | 'margin'
  | 'swap'
  | 'commission'
  | 'stopLoss'
  | 'takeProfit'

const VOTED: readonly VotedKey[] = [
  'symbol',
  'direction',
  'volume',
  'profit',
  'gross',
  'openPrice',
  'closePrice',
  'openTime',
  'closeTime',
  'rollover',
  'margin',
  'swap',
  'commission',
  'stopLoss',
  'takeProfit'
]

const PRICE_FIELDS = ['openPrice', 'closePrice', 'stopLoss', 'takeProfit'] as const
type PriceField = (typeof PRICE_FIELDS)[number]

/**
 * OCR sometimes drops the decimal point of a price ("1.12414" → "112414"). The prices of one position are close to
 * each other, so a price that is 10^k times the ones read with a point is scaled back.
 */
function repairPrices(p: XtbPosition): XtbPosition {
  const undotted = PRICE_FIELDS.filter((f) => p[f] != null && !/[.,]/.test(p.raw[f] ?? ''))
  const dotted = PRICE_FIELDS.filter((f) => p[f] != null && !undotted.includes(f)).map((f) => p[f]!)
  const out = { ...p, undotted }
  if (!dotted.length) return out
  const ref = [...dotted].sort((a, b) => a - b)[Math.floor(dotted.length / 2)]!
  for (const f of undotted) {
    const v = p[f]!
    if (v / ref < 5 && v / ref > 0.2) continue
    for (let k = 1; k <= 7; k++) {
      const scaled = Number((v / 10 ** k).toFixed(10))
      if (scaled / ref < 2 && scaled / ref > 0.5) {
        out[f] = scaled
        break
      }
    }
  }
  return out
}

/** Read the position from OCR words; null when it does not look like a position panel (fewer than 3 labels). */
export function parseXtbScreen(words: readonly OcrWord[]): XtbPosition | null {
  const labels = findLabels(words)
  if (labels.length < 3) return null
  const used = new Set<OcrWord>()
  for (const l of labels) for (const w of l.words) used.add(w)
  const free = words.filter((w) => !used.has(w))
  const raw: Partial<Record<XtbField, string>> = {}
  const regions: XtbPosition['regions'] = {}
  for (const l of labels) {
    const ws = valueOf(l, labels, free)
    if (!ws?.length) continue
    raw[l.field] = ws.map((w) => w.text).join(' ')
    regions[l.field] = regionOf(ws)
  }
  const symbol = symbolOf(words, labels)
  if (symbol) regions.symbol = regionOf(symbol.words)
  const direction = sideOf(raw.type ?? null) ?? sideOf(words.find((w) => sideOf(w.text))?.text ?? null)
  return positionFromTexts(raw, { symbol: symbol?.text ?? null, direction, regions, description: symbol ? descriptionOf(words, labels, symbol.words) : null })
}

/** The line under the symbol (above the labels): XTB's name of the instrument. */
function descriptionOf(words: readonly OcrWord[], labels: readonly FoundLabel[], symbol: readonly OcrWord[]): string | null {
  const firstLabel = Math.min(...labels.map((l) => l.top), Number.POSITIVE_INFINITY)
  const below = Math.max(...symbol.map((w) => w.top + w.height))
  const row = rowsOf(words.filter((w) => w.top >= below - 0.2 * w.height && w.top + w.height <= firstLabel))[0]
  return row ? row.map((w) => w.text).join(' ') : null
}

/** A position from the texts of its values (one reading: the whole panel, or each value read again on its own). */
export function positionFromTexts(
  raw: Partial<Record<XtbField, string>>,
  extra: { symbol: string | null; direction: 'long' | 'short' | null; regions?: XtbPosition['regions']; description?: string | null }
): XtbPosition {
  const num = (f: XtbField) => ocrNumber(raw[f] ?? null)
  // Zero SL / TP in XTB means "not set".
  const level = (f: XtbField) => {
    const v = num(f)
    return v != null && v > 0 ? v : null
  }
  return repairPrices({
    symbol: extra.symbol,
    direction: extra.direction ?? sideOf(raw.type ?? null),
    volume: level('volume'),
    profit: num('profit'),
    gross: num('gross'),
    openPrice: level('openPrice'),
    closePrice: level('closePrice'),
    openTime: ocrTime(raw.openTime ?? null),
    closeTime: ocrTime(raw.closeTime ?? null),
    rollover: num('rollover'),
    margin: num('margin'),
    swap: num('swap'),
    commission: num('commission'),
    stopLoss: level('stopLoss'),
    takeProfit: level('takeProfit'),
    raw,
    regions: extra.regions ?? {},
    undotted: [],
    description: extra.description ?? null,
    symbols: extra.symbol ? [extra.symbol] : [],
    uncertain: {}
  })
}

/** Characters a value can have: the second reading of a value is limited to them (Tesseract whitelist). */
export function valueCharset(key: XtbField | 'symbol'): string {
  if (key === 'symbol') return 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.'
  if (TIME_FIELDS.has(key as XtbField)) return '0123456789.:'
  return '0123456789.-'
}

/** A symbol read on its own: upper case, without XTB's "CFD" badge glued to it. */
export function cleanSymbol(text: string): string | null {
  const t = text.toUpperCase().replace(/\s+/g, '.').replace(/[^A-Z0-9.]/g, '').replace(/\.{2,}/g, '.').replace(/^\.|\.$/g, '')
  const s = t.length > 5 ? t.replace(/\.?C[FR][DO0]?$/, '') : t
  return s.replace(/[^A-Z]/g, '').length >= 2 && s.replace(/[^A-Z0-9]/g, '').length >= 3 ? s : null
}

const FIELD_NAMES: Record<XtbField, string> = {
  type: 'typ',
  volume: 'wolumen',
  profit: 'zysk/strata',
  gross: 'zysk brutto',
  openPrice: 'cena otwarcia',
  closePrice: 'cena zamknięcia',
  openTime: 'czas otwarcia',
  closeTime: 'czas zamknięcia',
  rollover: 'rolowanie',
  margin: 'depozyt',
  swap: 'swap',
  commission: 'prowizja',
  stopLoss: 'stop loss',
  takeProfit: 'take profit'
}

/** Fields needed for a complete trade; another OCR pass is worth it while one of them is missing. */
export function xtbMissing(p: XtbPosition | null): string[] {
  if (!p) return ['wszystko']
  const need: Array<[keyof XtbPosition, string]> = [
    ['symbol', 'instrument'],
    ['direction', FIELD_NAMES.type],
    ['volume', FIELD_NAMES.volume],
    ['openPrice', FIELD_NAMES.openPrice],
    ['closePrice', FIELD_NAMES.closePrice],
    ['openTime', FIELD_NAMES.openTime],
    ['closeTime', FIELD_NAMES.closeTime],
    ['profit', FIELD_NAMES.profit]
  ]
  return need.filter(([k]) => p[k] == null).map(([, name]) => name)
}

const sameValue = (k: VotedKey, a: unknown, b: unknown) =>
  k === 'symbol' ? String(a).replace(/[^A-Z0-9]/g, '') === String(b).replace(/[^A-Z0-9]/g, '') : a === b

/**
 * Several readings of one screenshot (whole panel binarized / in gray, each value read again on its own) → one
 * position: for every value the reading with the most weight wins (a price read without its decimal point counts
 * less); values the readings disagree on are listed in `uncertain` with the other readings.
 */
export function combineXtb(readings: ReadonlyArray<{ position: XtbPosition | null; weight: number }>): XtbPosition | null {
  const list = readings.filter((r): r is { position: XtbPosition; weight: number } => r.position != null)
  if (!list.length) return null
  const first = list[0]!.position
  const out: XtbPosition = {
    ...first,
    raw: Object.assign({}, ...[...list].reverse().map((r) => r.position.raw)),
    regions: Object.assign({}, ...[...list].reverse().map((r) => r.position.regions)),
    description: list.map((r) => r.position.description).find((d) => d) ?? null,
    undotted: [],
    symbols: [],
    uncertain: {}
  }
  for (const k of VOTED) {
    const groups: Array<{ value: unknown; weight: number; undotted: boolean }> = []
    for (const { position, weight } of list) {
      const value = position[k]
      if (value == null) continue
      const undotted = (position.undotted as string[]).includes(k)
      const w = weight * (undotted ? 0.3 : 1)
      const g = groups.find((x) => sameValue(k, x.value, value))
      if (g) {
        g.weight += w
        g.undotted &&= undotted
      } else groups.push({ value, weight: w, undotted })
    }
    groups.sort((a, b) => b.weight - a.weight)
    // OCR merges a doubled narrow digit ("0.84311" → "0.8431") far more often than it doubles one: the longer wins.
    const doubled = typeof groups[0]?.value === 'number' ? groups.findIndex((g) => typeof g.value === 'number' && hasDoubledDigit(String(g.value), String(groups[0]!.value))) : -1
    if (doubled > 0) groups.unshift(...groups.splice(doubled, 1))
    ;(out as unknown as Record<string, unknown>)[k] = groups[0]?.value ?? null
    if (groups[0]?.undotted && (PRICE_FIELDS as readonly string[]).includes(k)) out.undotted.push(k as PriceField)
    if (k === 'symbol') out.symbols = groups.map((g) => String(g.value))
    if (groups.length > 1) out.uncertain[k] = groups.slice(1).map((g) => String(g.value))
  }
  return out
}

/** Is `long` the text `short` with one digit doubled ("4.2711" vs "4.271")? */
function hasDoubledDigit(long: string, short: string): boolean {
  if (long.length !== short.length + 1) return false
  for (let i = 0; i + 1 < long.length; i++) if (long[i] === long[i + 1] && /\d/.test(long[i]!) && long.slice(0, i) + long.slice(i + 1) === short) return true
  return false
}

/** Two readings: the first one's values unless the second agrees better (see `combineXtb`). */
export function mergeXtb(a: XtbPosition | null, b: XtbPosition | null): XtbPosition | null {
  return combineXtb([
    { position: a, weight: 1 },
    { position: b, weight: 0.9 }
  ])
}

// ---- Instrument ----------------------------------------------------------------------------------------------------

/** XTB's English names of currencies ("Euro to American Dollar currency pair"). */
const CURRENCY_NAMES: Array<[string, string]> = [
  ['euro', 'EUR'],
  ['americandollar', 'USD'],
  ['usdollar', 'USD'],
  ['britishpound', 'GBP'],
  ['japaneseyen', 'JPY'],
  ['swissfranc', 'CHF'],
  ['australiandollar', 'AUD'],
  ['newzealanddollar', 'NZD'],
  ['canadiandollar', 'CAD'],
  ['polishzloty', 'PLN'],
  ['czechkoruna', 'CZK'],
  ['hungarianforint', 'HUF'],
  ['swedishkrona', 'SEK'],
  ['norwegiankrone', 'NOK'],
  ['danishkrone', 'DKK'],
  ['turkishlira', 'TRY'],
  ['mexicanpeso', 'MXN'],
  ['southafricanrand', 'ZAR'],
  ['singaporedollar', 'SGD'],
  ['hongkongdollar', 'HKD'],
  ['chineseyuan', 'CNH'],
  ['offshorechineseyuan', 'CNH']
]

function currencyOf(name: string): string | null {
  const s = letters(name)
  if (!s) return null
  let best: { code: string; d: number } | null = null
  for (const [n, code] of CURRENCY_NAMES) {
    const d = distance(s, n)
    if (d <= Math.max(1, Math.floor(n.length / 5)) && (!best || d < best.d)) best = { code, d }
  }
  return best?.code ?? null
}

/** "Euro to American Dollar currency pair" → "EURUSD"; null for other descriptions. */
export function pairFromDescription(description: string | null): string | null {
  if (!description) return null
  const m = /^(.+?)\s+to\s+(.+?)(?:\s+currency\s*pair.*)?$/i.exec(description.trim())
  if (!m) return null
  const base = currencyOf(m[1]!)
  const quote = currencyOf(m[2]!)
  return base && quote && base !== quote ? base + quote : null
}

/** Characters OCR mixes up (each group): a swap inside a group costs little. */
const CONFUSED = ['O0DQ', 'I1LT', 'S5', 'B8', 'Z2', 'G6', 'A4', 'UV', 'EF', 'PR', 'CG', 'MN', 'H4']

function swapCost(a: string, b: string): number {
  if (a === b) return 0
  return CONFUSED.some((g) => g.includes(a) && g.includes(b)) ? 0.3 : 1
}

/** Edit distance with cheap OCR swaps and insertions; trailing extra characters (a glued badge) cost little. */
function symbolDistance(read: string, pair: string): number {
  const a = read
  const b = pair
  // d[i][j]: a[0..i) vs b[0..j)
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  let best = prev[b.length]! + 0.2 * a.length
  for (let i = 1; i <= a.length; i++) {
    const cur = [i * 0.6]
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j]! + 0.6, cur[j - 1]! + 1, prev[j - 1]! + swapCost(a[i - 1]!, b[j - 1]!))
    prev = cur
    best = Math.min(best, prev[b.length]! + 0.2 * (a.length - i))
  }
  return best
}

export type PairMatch = { pair: string; how: 'exact' | 'description' | 'similar'; read: string | null } | { pair: null; how: null; read: string | null }

/**
 * The journal pair of the read instrument: the symbol as it is (also without the broker's suffixes), then XTB's
 * description of a currency pair, then the closest pair allowing typical OCR mix-ups ("USS00" → US500, "DEA40" → DE40).
 */
export function matchInstrument(p: Pick<XtbPosition, 'symbols' | 'symbol' | 'description'>, pairs: readonly string[]): PairMatch {
  const reads = [...new Set([...(p.symbols ?? []), ...(p.symbol ? [p.symbol] : [])])]
  const read = reads[0] ?? null
  for (const r of reads) {
    const pair = pairForSymbol(r, pairs)
    if (pair) return { pair, how: 'exact', read: r }
  }
  const fromDesc = pairFromDescription(p.description)
  const descPair = fromDesc ? pairForSymbol(fromDesc, pairs) : null
  if (descPair) return { pair: descPair, how: 'description', read }
  const alnum = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const scored = pairs
    .map((pair) => ({ pair, cost: Math.min(...reads.map((r) => symbolDistance(alnum(r), alnum(pair))), Number.POSITIVE_INFINITY) }))
    .sort((a, b) => a.cost - b.cost)
  const [best, second] = scored
  if (best && best.cost <= 0.3 * alnum(best.pair).length + 0.3 && (!second || second.cost - best.cost >= 0.5)) return { pair: best.pair, how: 'similar', read }
  return { pair: null, how: null, read }
}

/** Checks of the read values against each other (OCR mistakes, a wrong panel). */
export function xtbWarnings(p: XtbPosition): string[] {
  const out: string[] = []
  if (p.direction && p.openPrice != null && p.closePrice != null && p.profit != null && p.openPrice !== p.closePrice) {
    const moved = (p.closePrice - p.openPrice) * (p.direction === 'long' ? 1 : -1)
    const costs = (p.commission ?? 0) + (p.swap ?? 0) + (p.rollover ?? 0)
    // Costs can turn a small gain into a loss, never a loss into a gain.
    if (moved < 0 && p.profit - costs > 0.005) out.push('Kierunek nie zgadza się z wynikiem i cenami – sprawdź typ (Buy / Sell) i ceny.')
    else if (moved > 0 && p.profit - costs < -0.005) out.push('Kierunek nie zgadza się z wynikiem i cenami – sprawdź typ (Buy / Sell) i ceny.')
  }
  if (p.gross != null && p.profit != null) {
    const net = p.gross + (p.commission ?? 0) + (p.swap ?? 0) + (p.rollover ?? 0)
    if (Math.abs(net - p.profit) > 0.015) out.push('Zysk/strata różni się od zysku brutto z kosztami – sprawdź odczytane kwoty.')
  }
  if (p.undotted.length) out.push(`Bez kropki dziesiętnej odczytano: ${p.undotted.map((f) => FIELD_NAMES[f]).join(', ')} – sprawdź (cena dopasowana do skali pozostałych).`)
  if (p.openTime && p.closeTime && p.closeTime < p.openTime) out.push('Czas zamknięcia jest wcześniejszy niż czas otwarcia.')
  if (p.direction && p.openPrice != null && p.stopLoss != null && (p.direction === 'long' ? p.stopLoss > p.openPrice : p.stopLoss < p.openPrice))
    out.push('Stop Loss jest po stronie zysku (przesunięty) – nie mówi o ryzyku wejścia.')
  return out
}

// ---- Applying to a trade -------------------------------------------------------------------------------------------

export type ScreenFieldKey = 'pair' | 'direction' | 'entryTime' | 'entry' | 'stopLoss' | 'takeProfit' | 'lots' | 'exit' | 'result'

export interface ScreenValues {
  pair: string | null
  direction: 'long' | 'short' | null
  /** UTC ISO. */
  entryTime: string | null
  entry: number | null
  stopLoss: number | null
  takeProfit: number | null
  lots: number | null
  exitPrice: number | null
  /** UTC ISO. */
  exitTime: string | null
  /** Net result in `currency`. */
  result: number | null
  commission: number | null
  swap: number | null
  gross: number | null
}

/** Screen values for the editor: the symbol mapped to a journal pair, Warsaw times to UTC. */
export function screenValues(p: XtbPosition, pairs: readonly string[]): ScreenValues {
  const swap = p.swap != null || p.rollover != null ? (p.swap ?? 0) + (p.rollover ?? 0) : null
  return {
    pair: matchInstrument(p, pairs).pair,
    direction: p.direction,
    entryTime: p.openTime ? brokerTimeToUtc(p.openTime, 'Europe/Warsaw') : null,
    entry: p.openPrice,
    stopLoss: p.stopLoss,
    takeProfit: p.takeProfit,
    lots: p.volume,
    exitPrice: p.closePrice,
    exitTime: p.closeTime ? brokerTimeToUtc(p.closeTime, 'Europe/Warsaw') : null,
    result: p.profit,
    commission: p.commission,
    swap,
    gross: p.gross
  }
}

/** Fields that would change the trade (a value read and different from the current one). */
export function changedScreenFields(trade: Trade, v: ScreenValues, currency: string): ScreenFieldKey[] {
  const out: ScreenFieldKey[] = []
  const sameTime = (a: string | null, b: string | null) => a != null && b != null && Math.abs(Date.parse(a) - Date.parse(b)) < 60_000
  if (v.pair && v.pair !== trade.pair) out.push('pair')
  if (v.direction && v.direction !== trade.direction) out.push('direction')
  if (v.entryTime && !sameTime(v.entryTime, trade.entryTime)) out.push('entryTime')
  if (v.entry != null && v.entry !== trade.prices.entry) out.push('entry')
  if (v.stopLoss != null && v.stopLoss !== trade.prices.stopLoss) out.push('stopLoss')
  if (v.takeProfit != null && v.takeProfit !== trade.prices.takeProfit1) out.push('takeProfit')
  if (v.lots != null && v.lots !== trade.lots) out.push('lots')
  if (v.exitPrice != null) {
    const x = trade.exits
    const same = x.length === 1 && x[0]!.percent === 100 && x[0]!.price === v.exitPrice && (v.exitTime == null || sameTime(x[0]!.time, v.exitTime))
    if (!same) out.push('exit')
  }
  if (v.result != null && (trade.pnlAmountOverride !== v.result || (trade.amountCurrency ?? currency) !== currency)) out.push('result')
  return out
}

/**
 * The trade with the chosen screen values. The exit replaces all exits with one 100% exit (and closes an open trade);
 * the result is the net amount in `currency` (the account currency) and keeps commission and swap in `trade.broker`.
 */
export function applyScreenValues(trade: Trade, v: ScreenValues, fields: ReadonlySet<ScreenFieldKey>, opts: { currency: string; symbol: string | null; now: string }): Trade {
  const on = (k: ScreenFieldKey) => fields.has(k)
  const prices = {
    ...trade.prices,
    entry: on('entry') && v.entry != null ? v.entry : trade.prices.entry,
    stopLoss: on('stopLoss') && v.stopLoss != null ? v.stopLoss : trade.prices.stopLoss,
    takeProfit1: on('takeProfit') && v.takeProfit != null ? v.takeProfit : trade.prices.takeProfit1
  }
  const exit = on('exit') && v.exitPrice != null
  const result = on('result') && v.result != null
  const next: Trade = {
    ...trade,
    pair: on('pair') && v.pair ? v.pair : trade.pair,
    direction: on('direction') && v.direction ? v.direction : trade.direction,
    entryTime: on('entryTime') && v.entryTime ? v.entryTime : trade.entryTime,
    prices,
    lots: on('lots') && v.lots != null ? v.lots : trade.lots,
    exits: exit ? [{ id: trade.exits[0]?.id ?? newId(), time: v.exitTime, price: v.exitPrice, percent: 100, note: trade.exits[0]?.note ?? '' }] : trade.exits,
    status: exit && trade.status === 'open' ? 'closed' : trade.status,
    pnlAmountOverride: result ? Number(v.result!.toFixed(2)) : trade.pnlAmountOverride,
    // The entry's amounts share one currency: a typed risk amount keeps its value in the account currency.
    amountCurrency: result ? opts.currency : trade.amountCurrency,
    updatedAt: opts.now
  }
  if (result) {
    const broker: BrokerFill = {
      ...(trade.broker ?? {}),
      tickets: trade.broker?.tickets ?? [],
      symbol: opts.symbol ?? trade.broker?.symbol ?? '',
      volume: v.lots,
      openTime: v.entryTime,
      closeTime: v.exitTime,
      openPrice: v.entry,
      closePrice: v.exitPrice,
      profit: v.gross,
      commission: v.commission,
      swap: v.swap,
      net: v.result,
      currency: opts.currency,
      importedAt: opts.now,
      source: 'screen'
    }
    next.broker = broker
  }
  return next
}

/**
 * The gross result the prices and the volume give: price move × volume × units per lot × rate of the quote currency
 * to the account currency. Compared with the result read, it catches a misread digit in a price or the volume.
 */
export function expectedGross(v: Pick<ScreenValues, 'direction' | 'entry' | 'exitPrice' | 'lots'>, contractSize: number, rate: number): number | null {
  if (!v.direction || v.entry == null || v.exitPrice == null || v.lots == null) return null
  return (v.exitPrice - v.entry) * (v.direction === 'long' ? 1 : -1) * v.lots * contractSize * rate
}

/** Does the result read disagree with the one from prices and volume (by more than a quarter)? */
export function resultMismatch(actual: number | null, expected: number | null): boolean {
  if (actual == null || expected == null) return false
  const scale = Math.max(Math.abs(actual), Math.abs(expected))
  return scale >= 1 && Math.abs(actual - expected) > 0.25 * scale
}

/** "06.10.2026 09:58" for the review dialog (Warsaw). */
export function warsawText(iso: string | null): string {
  return iso ? DateTime.fromISO(iso, { zone: 'Europe/Warsaw' }).toFormat('dd.MM.yyyy HH:mm') : '—'
}

/** A Warsaw wall clock as read ("2026-10-06T09:58:00") → "06.10.2026 09:58". */
export function wallText(wall: string): string {
  const d = DateTime.fromISO(wall)
  return d.isValid ? d.toFormat('dd.MM.yyyy HH:mm') : wall
}
