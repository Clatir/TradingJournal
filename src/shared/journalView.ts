/**
 * Journal list (1.4.0): filters (also saved under a name), the user's own trade fields and the choice and order of
 * columns. Pure; the renderer only draws the cells.
 */
import { deepEqual } from './merge'
import type { TradeMetrics } from './calc/trade'
import type { ValidationResult } from './calc/validator'
import { journalFilterSchema, type CustomCondition, type CustomField, type DictionaryKey, type JournalFile, type JournalFilter, type SavedFilter, type Settings, type Trade } from './schema'

export interface FilterRow {
  trade: Trade
  m: TradeMetrics
  v: ValidationResult
}

export const EMPTY_FILTER: JournalFilter = journalFilterSchema.parse({})

const dictName = (journal: JournalFile | null, key: DictionaryKey, id: string | null) => (id ? (journal?.dictionaries[key].find((d) => d.id === id)?.name ?? '') : '')

/** A custom value as text ("" when empty; options by name, yes/no in Polish). */
export function customValueText(field: CustomField, value: Trade['custom'][string] | undefined): string {
  if (value == null || value === '') return ''
  switch (field.type) {
    case 'select':
      return field.options.find((o) => o.id === value)?.name ?? ''
    case 'check':
      return value === true ? 'tak' : value === false ? 'nie' : ''
    case 'number':
      return typeof value === 'number' ? String(value) : ''
    default:
      return typeof value === 'string' ? value : String(value)
  }
}

/** A value typed in the editor, normalized for the field's type (null = empty). */
export function normalizeCustomValue(field: CustomField, value: unknown): string | number | boolean | null {
  switch (field.type) {
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? value : null
    case 'check':
      return typeof value === 'boolean' ? value : null
    case 'select':
      return typeof value === 'string' && field.options.some((o) => o.id === value) ? value : null
    default:
      return typeof value === 'string' && value.trim() ? value.slice(0, 2000) : null
  }
}

/** Set (or clear) one custom value of a trade; an empty value removes the key. */
export function withCustomValue(trade: Trade, field: CustomField, value: unknown): Trade {
  const v = normalizeCustomValue(field, value)
  const custom = { ...trade.custom }
  if (v == null) delete custom[field.id]
  else custom[field.id] = v
  return { ...trade, custom }
}

/** A condition with nothing set does not filter. */
export function conditionActive(c: CustomCondition): boolean {
  return !!c.text?.trim() || c.optionId != null || c.min != null || c.max != null || c.checked != null
}

function matchesCondition(field: CustomField, value: Trade['custom'][string] | undefined, c: CustomCondition): boolean {
  switch (field.type) {
    case 'text': {
      const q = c.text?.trim().toLowerCase()
      return !q || (typeof value === 'string' && value.toLowerCase().includes(q))
    }
    case 'select':
      return c.optionId == null || value === c.optionId
    case 'check':
      // "no" also matches an empty box.
      return c.checked == null || (c.checked ? value === true : value !== true)
    case 'number':
      if (c.min == null && c.max == null) return true
      if (typeof value !== 'number') return false
      return (c.min == null || value >= c.min) && (c.max == null || value <= c.max)
  }
}

/** How many filters beyond search, pair and status are set (for the "Filtry" button). */
export function advancedCount(f: JournalFilter): number {
  return (
    (f.from ? 1 : 0) +
    (f.to ? 1 : 0) +
    (f.outcome !== 'all' ? 1 : 0) +
    (f.compliance !== 'all' ? 1 : 0) +
    (f.mistakes !== 'all' ? 1 : 0) +
    (f.modelId ? 1 : 0) +
    f.custom.filter(conditionActive).length
  )
}

export function filterRows<R extends FilterRow>(rows: readonly R[], f: JournalFilter, journal: JournalFile | null): R[] {
  const q = f.query.trim().toLowerCase()
  const parts = q ? q.split(/\s+/) : []
  const fields = journal?.settings.customFields ?? []
  const conditions = f.custom.filter(conditionActive).map((c) => ({ c, field: fields.find((x) => x.id === c.fieldId) }))
  return rows.filter((r) => {
    const t = r.trade
    if (f.pair && t.pair !== f.pair) return false
    if (f.status !== 'all' && t.status !== f.status) return false
    if (f.from && r.m.tradingDate < f.from) return false
    if (f.to && r.m.tradingDate > f.to) return false
    if (f.outcome !== 'all' && (t.status !== 'closed' || r.m.outcome !== f.outcome)) return false
    if (f.compliance === 'compliant' && r.v.compliant !== true) return false
    if (f.compliance === 'broken' && r.v.broken.length === 0) return false
    if (f.mistakes === 'with' && t.psychology.mistakeTagIds.length === 0) return false
    if (f.mistakes === 'without' && t.psychology.mistakeTagIds.length > 0) return false
    if (f.modelId && t.entryModelId !== f.modelId) return false
    for (const { c, field } of conditions) if (field && !matchesCondition(field, t.custom[field.id], c)) return false
    if (!parts.length) return true
    const hay = [
      t.pair,
      r.m.tradingDate,
      t.notes,
      dictName(journal, 'entryModels', t.entryModelId),
      dictName(journal, 'pdArrays', t.entryPdArrayId),
      ...r.m.killzoneNames,
      ...t.psychology.mistakeTagIds.map((id) => dictName(journal, 'mistakeTags', id)),
      ...fields.map((field) => customValueText(field, t.custom[field.id]))
    ]
      .join(' ')
      .toLowerCase()
    return parts.every((part) => hay.includes(part))
  })
}

/** The filter part of a saved filter (without id and name), normalized. */
export function filterOf(saved: SavedFilter | JournalFilter): JournalFilter {
  const { id: _id, name: _name, ...rest } = saved as SavedFilter
  return journalFilterSchema.parse({ ...rest, custom: rest.custom.filter(conditionActive) })
}

export function sameFilter(a: JournalFilter, b: JournalFilter): boolean {
  return deepEqual(filterOf(a), filterOf(b))
}

// ---- Columns -------------------------------------------------------------------------------------------------------

export interface ColumnDef {
  id: string
  label: string
  title?: string
  /** CSS grid track. */
  width: string
  align?: 'right'
  /** Custom field shown in the column. */
  field?: CustomField
}

export const BUILTIN_COLUMNS: readonly ColumnDef[] = [
  { id: 'date', label: 'Data NY', width: '82px' },
  { id: 'weekday', label: 'Dz.', title: 'Dzień tygodnia', width: '28px' },
  { id: 'ny', label: 'NY', title: 'Godzina wejścia w Nowym Jorku', width: '40px' },
  { id: 'waw', label: 'WAW', title: 'Godzina wejścia w Warszawie', width: '40px' },
  { id: 'pair', label: 'Para', width: '60px' },
  { id: 'direction', label: 'Kier.', title: 'Kierunek', width: '40px' },
  { id: 'killzone', label: 'Killzone', width: 'minmax(64px,0.7fr)' },
  { id: 'model', label: 'Model', width: 'minmax(84px,1.2fr)' },
  { id: 'status', label: 'Status', width: '50px' },
  { id: 'sl', label: 'SL p', title: 'Stop loss w pipsach', width: '40px', align: 'right' },
  { id: 'rr', label: 'R:R', title: 'R:R do TP1', width: '38px', align: 'right' },
  { id: 'pips', label: 'Pips', width: '50px', align: 'right' },
  { id: 'r', label: 'R', width: '58px', align: 'right' },
  { id: 'score', label: 'Zas.', title: 'Zgodność z zasadami', width: '44px', align: 'right' },
  { id: 'mistakes', label: 'Błędy', width: 'minmax(60px,1fr)' },
  { id: 'pdArray', label: 'PD array', width: 'minmax(70px,0.8fr)' },
  { id: 'liquidity', label: 'Płynność', title: 'Zebrana płynność', width: 'minmax(70px,0.8fr)' },
  { id: 'exitNy', label: 'Wyj. NY', title: 'Godzina ostatniego wyjścia w Nowym Jorku', width: '44px' },
  { id: 'duration', label: 'Czas', title: 'Czas trwania transakcji', width: '52px', align: 'right' },
  { id: 'lots', label: 'Loty', width: '44px', align: 'right' },
  { id: 'risk', label: 'Ryz. %', title: 'Ryzyko w % kapitału', width: '48px', align: 'right' },
  { id: 'amount', label: 'Kwota', title: 'Zysk / strata w walucie konta (≈ = szacunek z ryzyka % i salda konta)', width: '104px', align: 'right' },
  { id: 'notes', label: 'Notatki', width: 'minmax(80px,1.4fr)' }
]

export const DEFAULT_COLUMNS: readonly string[] = ['date', 'weekday', 'ny', 'waw', 'pair', 'direction', 'killzone', 'model', 'status', 'sl', 'rr', 'pips', 'r', 'score', 'mistakes']

export const customColumnId = (fieldId: string) => `cf:${fieldId}`

function customColumn(field: CustomField): ColumnDef {
  const width = field.type === 'number' ? '56px' : field.type === 'check' ? '44px' : 'minmax(64px,0.8fr)'
  return { id: customColumnId(field.id), label: field.name, width, align: field.type === 'number' ? 'right' : undefined, field }
}

/** Every column that can be shown: built-in ones, then active custom fields. */
export function allColumns(fields: readonly CustomField[]): ColumnDef[] {
  return [...BUILTIN_COLUMNS, ...fields.filter((f) => !f.archived).map(customColumn)]
}

/** Columns to draw, in order (unknown ids and archived fields skipped; nothing left = the default set). */
export function resolveColumns(columns: readonly string[] | null, fields: readonly CustomField[]): ColumnDef[] {
  const byId = new Map(allColumns(fields).map((c) => [c.id, c]))
  const out = [...new Set(columns ?? DEFAULT_COLUMNS)].map((id) => byId.get(id)).filter((c): c is ColumnDef => !!c)
  return out.length ? out : DEFAULT_COLUMNS.map((id) => byId.get(id)!)
}

/** CSS grid template of the columns plus the screens indicator at the end. */
export function gridTemplate(cols: readonly ColumnDef[]): string {
  return [...cols.map((c) => c.width), '24px'].join(' ')
}

/** The narrowest the list can be (px): column minimums, the screens indicator, 6 px gaps and 8 px padding. */
export function gridMinWidth(cols: readonly ColumnDef[]): number {
  const min = (w: string) => Number(/^(?:minmax\()?(\d+(?:\.\d+)?)px/.exec(w)?.[1] ?? 0)
  return cols.reduce((s, c) => s + min(c.width), 0) + 24 + 6 * cols.length + 16
}

/** Where a shown column goes: next to its neighbour (the amount beside R), else at the end. */
const PLACE_AFTER: Record<string, string> = { amount: 'r' }

/** Show / hide a column (shown columns keep their order; a new one goes to the end, the amount next to R). */
export function toggleColumn(current: readonly string[] | null, id: string): string[] {
  const list = [...(current ?? DEFAULT_COLUMNS)]
  if (list.includes(id)) return list.filter((x) => x !== id)
  const after = PLACE_AFTER[id] ? list.indexOf(PLACE_AFTER[id]) : -1
  return after >= 0 ? [...list.slice(0, after + 1), id, ...list.slice(after + 1)] : [...list, id]
}

export function moveColumn(current: readonly string[] | null, id: string, delta: -1 | 1): string[] {
  const list = [...(current ?? DEFAULT_COLUMNS)]
  const i = list.indexOf(id)
  const j = i + delta
  if (i < 0 || j < 0 || j >= list.length) return list
  ;[list[i], list[j]] = [list[j]!, list[i]!]
  return list
}

// ---- Amount --------------------------------------------------------------------------------------------------------

export interface AmountShown {
  /** Result in the account currency; null when it cannot be told. */
  value: number | null
  /** An estimate from risk % × the current account balance (the trade has no amounts or lots). */
  estimated: boolean
  /** Where the amount comes from, or what is missing for it (tooltip). */
  hint: string
}

const money = (v: number, currency: string) => `${v.toLocaleString('pl-PL', { maximumFractionDigits: 2 })} ${currency}`

/**
 * The money result of a trade for the journal list: the computed amount (typed result, R × risk amount, or from the
 * lots), else an estimate R × risk % × account balance (marked), else nothing – with a hint what to fill in.
 */
export function tradeAmount(trade: Trade, m: TradeMetrics, risk: Pick<Settings['risk'], 'accountCurrency' | 'accountBalance'>): AmountShown {
  const cur = risk.accountCurrency
  if (trade.status === 'missed') return { value: null, estimated: false, hint: 'Missed – wynik hipotetyczny, bez kwoty.' }
  if (m.pnlAmount != null) {
    const source = m.amountSource === 'typed' ? 'wpisany wynik w kwocie' : m.amountSource === 'risk' ? 'R × kwota ryzyka' : 'z lotów: pipsy × wartość pipsa × loty'
    const converted =
      m.amountCurrency && m.amountCurrency !== cur
        ? `, przeliczone z ${m.amountCurrency} kursem ${m.amountRateDate ? `NBP z ${m.amountRateDate}` : 'dzisiejszym'}`
        : ''
    return { value: m.pnlAmount, estimated: false, hint: `Kwota: ${source}${converted}.` }
  }
  if (m.pnlAmountOwn != null && m.amountCurrency)
    return {
      value: null,
      estimated: false,
      hint: `Brak kursu ${m.amountCurrency} → ${cur}: Ustawienia → Wyświetlanie i ryzyko → Kursy walut („Odśwież kursy NBP” albo kurs ręczny).`
    }
  if (trade.status === 'open') return { value: null, estimated: false, hint: 'Otwarta – kwota po zamknięciu.' }
  const balance = risk.accountBalance
  if (m.countsInStats && m.resultR != null && trade.riskPercent != null && trade.riskPercent > 0 && balance != null && balance > 0) {
    const value = Number(((m.resultR * trade.riskPercent * balance) / 100).toFixed(2))
    return {
      value,
      estimated: true,
      hint:
        `Szacunek: ${m.resultR.toFixed(2)} R × ryzyko ${trade.riskPercent}% × saldo konta ${money(balance, cur)} (obecne saldo z kalkulatora pozycji). ` +
        'Dokładna kwota: wpisz loty albo wynik w kwocie w edytorze transakcji.'
    }
  }
  if (m.resultR == null) return { value: null, estimated: false, hint: 'Brak wyniku (cena wejścia, SL albo wyjście).' }
  return {
    value: null,
    estimated: false,
    hint:
      'Brak danych do kwoty: wpisz w edytorze transakcji loty, kwotę ryzyka albo wynik w kwocie' +
      (trade.riskPercent != null ? ' – albo saldo konta w kalkulatorze pozycji (z ryzykiem % da szacunek).' : '.')
  }
}
