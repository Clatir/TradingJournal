import { z } from 'zod'
import { formatDateTime } from './calc/time'
import { round, tradeMetrics, metricsContext } from './calc/trade'
import { validateTrade } from './calc/validator'
import { migrateRaw, SchemaTooNewError } from './migrations'
import type { Collection, FileKind } from './paths'
import { dayPlanSchema, type DayPlan } from './schema/day'
import { forecastSchema, type Forecast } from './schema/forecast'
import { journalSchema, type JournalFile, type Settings } from './schema/journal'
import { libraryItemSchema, type LibraryItem } from './schema/library'
import { tradeSchema, type Trade } from './schema/trade'
import { weekReviewSchema, type WeekReview } from './schema/week'

export interface RecordTypes {
  journal: JournalFile
  trades: Trade
  days: DayPlan
  weeks: WeekReview
  library: LibraryItem
  forecasts: Forecast
}

export type AnyRecord = RecordTypes[Collection]

export const SCHEMAS: { [K in FileKind]: z.ZodType<RecordTypes[K]> } = {
  journal: journalSchema as z.ZodType<JournalFile>,
  trades: tradeSchema as z.ZodType<Trade>,
  days: dayPlanSchema as z.ZodType<DayPlan>,
  weeks: weekReviewSchema as z.ZodType<WeekReview>,
  library: libraryItemSchema as z.ZodType<LibraryItem>,
  forecasts: forecastSchema as z.ZodType<Forecast>
}

export type ParseOutcome<K extends FileKind> =
  | { ok: true; value: RecordTypes[K]; migrated: boolean; fromVersion: number }
  | { ok: false; error: string; tooNewVersion?: number }

export function formatZodError(error: z.ZodError): string {
  return error.issues
    .slice(0, 4)
    .map((i) => `${i.path.length ? i.path.join('.') : '(plik)'}: ${i.message}`)
    .join('; ')
}

/** Parse JSON text of a record file: JSON → migrations → schema validation. Never throws. */
export function parseRecordText<K extends FileKind>(kind: K, text: string): ParseOutcome<K> {
  let raw: unknown
  try {
    raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
  } catch (e) {
    return { ok: false, error: `Uszkodzony JSON: ${(e as Error).message}` }
  }
  return parseRecordObject(kind, raw)
}

export function parseRecordObject<K extends FileKind>(kind: K, raw: unknown): ParseOutcome<K> {
  let migrated
  try {
    migrated = migrateRaw(kind, raw)
  } catch (e) {
    if (e instanceof SchemaTooNewError) return { ok: false, error: e.message, tooNewVersion: e.fileVersion }
    return { ok: false, error: (e as Error).message }
  }
  // `computed` is informational output written for humans; it is always recalculated.
  delete migrated.data.computed
  const parsed = SCHEMAS[kind].safeParse(migrated.data)
  if (!parsed.success) return { ok: false, error: `Niepoprawna struktura: ${formatZodError(parsed.error)}` }
  return { ok: true, value: parsed.data, migrated: migrated.migrated, fromVersion: migrated.fromVersion }
}

const r2 = (v: number | null) => (v == null ? null : round(v, 2))
const r1 = (v: number | null) => (v == null ? null : round(v, 1))

export interface SerializeContext {
  settings: Settings
  /** Day plan of the trade's trading date (for the HTF-bias and news rules). */
  dayPlan?: DayPlan | null
}

/** Human-readable derived values stored alongside a trade (ignored on read). */
export function tradeComputed(trade: Trade, ctx: SerializeContext): Record<string, unknown> {
  const settings = ctx.settings
  const m = tradeMetrics(trade, metricsContext(settings))
  const v = validateTrade(trade, m, settings, ctx.dayPlan ?? null)
  return {
    note: 'Pola wyliczane automatycznie przy zapisie - edycja nie ma wpływu.',
    tradingDateNy: m.tradingDate,
    entryNy: formatDateTime(trade.entryTime, 'NY'),
    entryWarsaw: formatDateTime(trade.entryTime, 'WAW'),
    killzones: m.killzoneNames,
    riskPips: r1(m.riskPips),
    rrTp1: r2(m.rrTp1),
    rrTp2: r2(m.rrTp2),
    resultR: r2(m.resultR),
    resultPips: r1(m.resultPips),
    outcome: m.outcome,
    complianceScore: v.score == null ? null : Math.round(v.score * 100),
    brokenRules: v.broken.map((b) => `${b.label}: ${b.detail}`)
  }
}

/** Serialize a record as indented JSON with a trailing newline. */
export function serializeRecord(kind: FileKind, record: AnyRecord | JournalFile, ctx?: SerializeContext): string {
  const out: Record<string, unknown> = { ...(record as unknown as Record<string, unknown>) }
  delete out.computed
  if (kind === 'trades' && ctx) out.computed = tradeComputed(record as Trade, ctx)
  return `${JSON.stringify(out, null, 2)}\n`
}
