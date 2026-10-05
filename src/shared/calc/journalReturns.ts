/**
 * "Weź z moich wyników" in the payout forecast: monthly returns of the journal (closed trades, R × risk % of each trade,
 * by NY trading month; months without trades between the first and the last one count as 0%) turned into the
 * forecast's percent mode: a random return from the profitable months' range and losing months with their size.
 */
import { DateTime } from 'luxon'
import type { Trade } from '../schema'
import { percentile } from './forecast'
import type { TradeMetrics } from './trade'

export interface MonthReturn {
  /** YYYY-MM (NY trading date). */
  month: string
  /** Sum of R × risk % of the month's closed trades. */
  pct: number
  trades: number
}

export function monthlyReturns(trades: readonly Trade[], metrics: (t: Trade) => TradeMetrics, defaultRiskPercent: number): MonthReturn[] {
  const byMonth = new Map<string, MonthReturn>()
  for (const t of trades) {
    const m = metrics(t)
    if (!m.countsInStats || m.resultR == null) continue
    const month = m.tradingDate.slice(0, 7)
    const row = byMonth.get(month) ?? { month, pct: 0, trades: 0 }
    row.pct += m.resultR * (t.riskPercent ?? defaultRiskPercent)
    row.trades++
    byMonth.set(month, row)
  }
  if (!byMonth.size) return []
  const months = [...byMonth.keys()].sort()
  const out: MonthReturn[] = []
  const last = DateTime.fromISO(`${months.at(-1)}-01`, { zone: 'UTC' })
  for (let d = DateTime.fromISO(`${months[0]}-01`, { zone: 'UTC' }); d <= last; d = d.plus({ months: 1 })) {
    const key = d.toFormat('yyyy-MM')
    out.push(byMonth.get(key) ?? { month: key, pct: 0, trades: 0 })
  }
  return out
}

/** Fewer months than this are not enough to say anything. */
export const MIN_HISTORY_MONTHS = 3

export interface HistoryForecast {
  months: number
  from: string
  to: string
  /** Average monthly return (all months), percent. */
  mean: number
  /** Range of the profitable (≥ 0) months: 10th–90th percentile. */
  gainLo: number
  gainHi: number
  /** Share of losing months, percent (0 = none). */
  lossProbability: number
  /** Size of a losing month (positive percent), 10th–90th percentile; null without losing months. */
  lossLo: number | null
  lossHi: number | null
}

const r2 = (v: number) => Number(v.toFixed(2))
const range = (values: number[]): [number, number] => {
  const s = [...values].sort((a, b) => a - b)
  return [r2(percentile(s, 0.1)), r2(percentile(s, 0.9))]
}

/** Parameters of the percent mode from the monthly returns; null with fewer than MIN_HISTORY_MONTHS months. */
export function forecastFromHistory(months: readonly MonthReturn[]): HistoryForecast | null {
  if (months.length < MIN_HISTORY_MONTHS) return null
  const gains = months.filter((m) => m.pct >= 0).map((m) => m.pct)
  const losses = months.filter((m) => m.pct < 0).map((m) => -m.pct)
  const [gainLo, gainHi] = gains.length ? range(gains) : [0, 0]
  const loss = losses.length ? range(losses) : null
  return {
    months: months.length,
    from: months[0]!.month,
    to: months.at(-1)!.month,
    mean: r2(months.reduce((s, m) => s + m.pct, 0) / months.length),
    gainLo,
    gainHi,
    lossProbability: Number(((losses.length / months.length) * 100).toFixed(1)),
    lossLo: loss ? loss[0] : null,
    lossHi: loss ? loss[1] : null
  }
}
