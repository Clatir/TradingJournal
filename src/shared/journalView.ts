/**
 * Journal list (1.4.0): filters (also saved under a name), the user's own trade fields and the choice and order of
 * columns. Pure; the renderer only draws the cells.
 */
import { deepEqual } from './merge'
import type { TradeMetrics } from './calc/trade'
import type { ValidationResult } from './calc/validator'
import { journalFilterSchema, type CustomCondition, type CustomField, type DictionaryKey, type JournalFile, type JournalFilter, type SavedFilter, type Trade } from './schema'

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
  { id: 'amount', label: 'Kwota', title: 'Wynik w walucie konta (gdy kwoty są włączone)', width: '72px', align: 'right' },
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

/** Show / hide a column (shown columns keep their order; a new one goes to the end). */
export function toggleColumn(current: readonly string[] | null, id: string): string[] {
  const list = [...(current ?? DEFAULT_COLUMNS)]
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id]
}

export function moveColumn(current: readonly string[] | null, id: string, delta: -1 | 1): string[] {
  const list = [...(current ?? DEFAULT_COLUMNS)]
  const i = list.indexOf(id)
  const j = i + delta
  if (i < 0 || j < 0 || j >= list.length) return list
  ;[list[i], list[j]] = [list[j]!, list[i]!]
  return list
}
