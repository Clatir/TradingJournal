/**
 * Archive NBP rates (table A) for converting trade amounts at the rate of the day before the transaction – the rule
 * of the Polish tax settlement (the last table published before the day of closing). Stored in journal.json
 * (`settings.fx.history`, per currency: covered date range + mid rates), so every computer has them, also offline.
 * Pure functions; the main process fetches (`rates/A/{code}/{start}/{end}`, at most 367 days per request).
 */
import { DateTime } from 'luxon'
import { z } from 'zod'
import { isoDate, type Settings, type Trade } from './schema'

export type FxHistory = Settings['fx']['history']

/** NBP limit for one request of a currency's rates. */
export const NBP_HISTORY_MAX_DAYS = 367
/** A table older than this before the transaction is not trusted (a hole in the stored history). */
const MAX_GAP_DAYS = 10
/** History is fetched from this many days before the earliest transaction (weekends, holidays). */
const LEAD_DAYS = 10

export function nbpHistoryPath(code: string, start: string, end: string): string {
  return `/api/exchangerates/rates/A/${code}/${start}/${end}/?format=json`
}

const historyResponseSchema = z.looseObject({
  code: z.string().optional(),
  rates: z.array(z.looseObject({ effectiveDate: isoDate, mid: z.number() }))
})

/** NBP response ({ code, rates: [{ no, effectiveDate, mid }] }) → date → mid; null if it is not one. */
export function parseNbpHistory(raw: unknown): Record<string, number> | null {
  const parsed = historyResponseSchema.safeParse(raw)
  if (!parsed.success) return null
  const out: Record<string, number> = {}
  for (const r of parsed.data.rates) if (Number.isFinite(r.mid) && r.mid > 0) out[r.effectiveDate] = r.mid
  return out
}

const day = (iso: string) => DateTime.fromISO(iso, { zone: 'UTC' })
const addDays = (date: string, n: number) => day(date).plus({ days: n }).toISODate()!

/** Warsaw calendar date of an instant. */
export function warsawDate(iso: string): string {
  return DateTime.fromISO(iso, { zone: 'utc' }).setZone('Europe/Warsaw').toISODate()!
}

/** Date of the transaction for the conversion: the last exit (closing), else the entry; Warsaw calendar. */
export function transactionDate(trade: Pick<Trade, 'entryTime' | 'exits'>): string {
  const exits = trade.exits.map((x) => x.time).filter((t): t is string => !!t).sort()
  return warsawDate(exits.at(-1) ?? trade.entryTime)
}

/**
 * Rate from → to of the last NBP table published before `date` (mid / mid, PLN = 1, 6 places), with the table date;
 * null when the stored history does not cover the day before `date`.
 */
export function historicalRate(from: string, to: string, date: string, settings: Pick<Settings, 'fx'>): { rate: number; tableDate: string } | null {
  if (from === to) return null
  const history = settings.fx.history
  const codes = [from, to].filter((c) => c !== 'PLN')
  const before = addDays(date, -1)
  // Every currency must cover the day before; the table date is the latest one strictly before `date`.
  let tableDate: string | null = null
  for (const code of codes) {
    const h = history[code]
    if (!h || h.from > before || h.to < before) return null
    const dates = Object.keys(h.rates).filter((d) => d < date)
    const latest = dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null
    if (!latest || latest < addDays(date, -MAX_GAP_DAYS)) return null
    if (tableDate == null) tableDate = latest
    else if (tableDate !== latest) return null
  }
  if (!tableDate) return null
  const mid = (code: string) => (code === 'PLN' ? 1 : (history[code]?.rates[tableDate!] ?? null))
  const a = mid(from)
  const b = mid(to)
  if (a == null || b == null) return null
  return { rate: Number((a / b).toFixed(6)), tableDate }
}

export interface HistoryNeed {
  code: string
  start: string
  end: string
}

/**
 * Date ranges still to fetch for conversions of `uses` (currency, transaction date): from LEAD_DAYS before the earliest
 * date to the day before the latest one (at most today), beyond what each currency already covers; split into
 * requests of at most 367 days.
 */
export function historyNeeds(uses: ReadonlyArray<{ code: string; date: string }>, history: FxHistory, today: string): HistoryNeed[] {
  const byCode = new Map<string, { min: string; max: string }>()
  for (const u of uses) {
    if (u.code === 'PLN') continue
    const r = byCode.get(u.code)
    if (!r) byCode.set(u.code, { min: u.date, max: u.date })
    else {
      if (u.date < r.min) r.min = u.date
      if (u.date > r.max) r.max = u.date
    }
  }
  const out: HistoryNeed[] = []
  const push = (code: string, start: string, end: string) => {
    for (let s = start; s <= end; s = addDays(s, NBP_HISTORY_MAX_DAYS)) {
      const e = addDays(s, NBP_HISTORY_MAX_DAYS - 1)
      out.push({ code, start: s, end: e < end ? e : end })
    }
  }
  for (const [code, r] of [...byCode].sort(([a], [b]) => a.localeCompare(b))) {
    const needFrom = addDays(r.min, -LEAD_DAYS)
    const lastDay = addDays(r.max, -1)
    const needTo = lastDay < today ? lastDay : today
    if (needFrom > needTo) continue
    const h = history[code]
    if (!h) {
      push(code, needFrom, needTo)
      continue
    }
    if (needFrom < h.from) push(code, needFrom, addDays(h.from, -1))
    if (needTo > h.to) push(code, addDays(h.to, 1), needTo)
  }
  return out
}

/**
 * Currency / date pairs of trade amounts that get converted: the currency of the amounts and the account currency,
 * on the transaction date (only trades with amounts).
 */
export function historyUses(trades: ReadonlyArray<Pick<Trade, 'entryTime' | 'exits' | 'riskAmount' | 'pnlAmountOverride' | 'amountCurrency'>>, settings: Pick<Settings, 'risk'>): Array<{ code: string; date: string }> {
  const account = settings.risk.accountCurrency
  const out: Array<{ code: string; date: string }> = []
  for (const t of trades) {
    if (t.riskAmount == null && t.pnlAmountOverride == null) continue
    const date = transactionDate(t)
    const own = t.amountCurrency ?? settings.risk.legacyAmountCurrency ?? account
    out.push({ code: own, date })
    if (account !== own) out.push({ code: account, date })
  }
  return out
}

/** History with a fetched range added (ranges are fetched next to the covered one, so coverage stays contiguous). */
export function mergeHistory(history: FxHistory, code: string, start: string, end: string, rates: Record<string, number>): FxHistory {
  const h = history[code]
  return {
    ...history,
    [code]: {
      from: h && h.from < start ? h.from : start,
      to: h && h.to > end ? h.to : end,
      rates: { ...(h?.rates ?? {}), ...rates }
    }
  }
}

/** Result of the fetchFxHistory IPC channel. */
export type FxHistoryResult = { ok: true; rates: Record<string, number> } | { ok: false; message: string }
