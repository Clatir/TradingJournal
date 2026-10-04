/**
 * Currency conversion rates: hand-entered rates win over the last fetched NBP table (table A, mid rates).
 * Pure functions shared by the main process (fetch, validation) and the renderer (calculators, forecast).
 */
import { z } from 'zod'
import { isoDate, type NbpTable, type Settings } from './schema'

/** NBP table A, the latest one. */
export const NBP_TABLE_PATH = '/api/exchangerates/tables/A?format=json'
export const NBP_API = 'https://api.nbp.pl'
/** A table older than this is fetched again at start. */
export const NBP_REFRESH_AFTER_MS = 12 * 60 * 60 * 1000

export type RateSource = 'same' | 'manual' | 'nbp'
export interface Rate {
  rate: number
  source: RateSource
}

const round6 = (v: number): number => Number(v.toFixed(6))
const manualKey = (from: string, to: string) => `${from}>${to}`

/** Rate from the NBP table alone (mid(from) / mid(to), mid(PLN) = 1), rounded to 6 places; null without both currencies. */
export function nbpRate(from: string, to: string, settings: Pick<Settings, 'fx'>): number | null {
  const table = settings.fx.nbp
  if (!table) return null
  const mid = (code: string) => (code === 'PLN' ? 1 : (table.rates[code] ?? null))
  const a = mid(from)
  const b = mid(to)
  if (a == null || b == null || !(a > 0) || !(b > 0)) return null
  return round6(a / b)
}

/** How many units of `to` one unit of `from` is worth. */
export function rateFor(from: string, to: string, settings: Pick<Settings, 'risk' | 'fx'>): Rate | null {
  if (from === to) return { rate: 1, source: 'same' }
  if (to === settings.risk.accountCurrency) {
    const own = settings.risk.conversionRates[from]
    if (own != null && own > 0) return { rate: own, source: 'manual' }
  }
  const manual = settings.fx.manual[manualKey(from, to)]
  if (manual != null && manual > 0) return { rate: manual, source: 'manual' }
  const nbp = nbpRate(from, to, settings)
  return nbp != null ? { rate: nbp, source: 'nbp' } : null
}

/** A typed rate is stored where it always was for the account currency (risk.conversionRates), otherwise in fx.manual. */
export function withManualRate<S extends Pick<Settings, 'risk' | 'fx'>>(settings: S, from: string, to: string, rate: number): S {
  if (!(rate > 0) || from === to) return settings
  if (to === settings.risk.accountCurrency) return { ...settings, risk: { ...settings.risk, conversionRates: { ...settings.risk.conversionRates, [from]: rate } } }
  return { ...settings, fx: { ...settings.fx, manual: { ...settings.fx.manual, [manualKey(from, to)]: rate } } }
}

/** Forget the hand-entered rate from → to (both places), so the NBP rate applies again. */
export function withoutManualRate<S extends Pick<Settings, 'risk' | 'fx'>>(settings: S, from: string, to: string): S {
  const key = manualKey(from, to)
  const ownRates = { ...settings.risk.conversionRates }
  const manual = { ...settings.fx.manual }
  if (to === settings.risk.accountCurrency) delete ownRates[from]
  delete manual[key]
  return { ...settings, risk: { ...settings.risk, conversionRates: ownRates }, fx: { ...settings.fx, manual } }
}

/** Every hand-entered rate (account currency ones first), for the settings list. */
export function manualRates(settings: Pick<Settings, 'risk' | 'fx'>): Array<{ from: string; to: string; rate: number }> {
  const account = settings.risk.accountCurrency
  const own = Object.entries(settings.risk.conversionRates).map(([from, rate]) => ({ from, to: account, rate }))
  const other = Object.entries(settings.fx.manual).map(([key, rate]) => {
    const [from, to] = key.split('>') as [string, string]
    return { from, to, rate }
  })
  return [...own, ...other.filter((r) => !own.some((o) => o.from === r.from && o.to === r.to))]
}

const nbpResponseSchema = z
  .array(
    z.looseObject({
      table: z.string().optional(),
      no: z.string().min(1),
      effectiveDate: isoDate,
      rates: z.array(z.looseObject({ code: z.string(), mid: z.number() }))
    })
  )
  .min(1)

/** NBP API response ([{ table, no, effectiveDate, rates: [{ currency, code, mid }] }]) → the stored table; null if it is not one. */
export function parseNbpResponse(raw: unknown, fetchedAt: string): NbpTable | null {
  const parsed = nbpResponseSchema.safeParse(raw)
  if (!parsed.success) return null
  const t = parsed.data[0]!
  const rates: Record<string, number> = {}
  for (const r of t.rates) if (/^[A-Z]{3}$/.test(r.code) && Number.isFinite(r.mid) && r.mid > 0) rates[r.code] = r.mid
  if (!Object.keys(rates).length) return null
  return { no: t.no, effectiveDate: t.effectiveDate, fetchedAt, rates }
}

/** The automatic fetch at start runs only for a writable real journal whose table is missing or older than 12 h. */
export function nbpFetchDue(settings: Pick<Settings, 'fx'>, opts: { readOnly: boolean; isSample: boolean; now: Date }): boolean {
  if (!settings.fx.autoFetch || opts.readOnly || opts.isSample) return false
  const last = settings.fx.nbp ? Date.parse(settings.fx.nbp.fetchedAt) : Number.NaN
  return !Number.isFinite(last) || opts.now.getTime() - last > NBP_REFRESH_AFTER_MS
}

/** Result of the fetchFxRates IPC channel. */
export type FxFetchResult = { ok: true; table: NbpTable } | { ok: false; message: string }
