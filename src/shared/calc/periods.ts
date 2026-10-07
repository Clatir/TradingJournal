/**
 * Periods (1.5.0): date ranges of New York trading dates, presets (month, quarter, year…), the previous period of the
 * same length and the metrics of a period for comparisons (analytics and reports).
 */
import { DateTime } from 'luxon'
import { closedTrades, grosze, summaryOf, type AnalyzedTrade } from './analytics'
import type { PlnOf } from './analytics'

export interface DateRange {
  /** Inclusive YYYY-MM-DD. */
  from: string
  to: string
}

const MONTHS = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień']

const d = (iso: string) => DateTime.fromISO(iso, { zone: 'UTC' })
const iso = (x: DateTime) => x.toISODate()!

export const monthRange = (month: string): DateRange => {
  const m = d(`${month}-01`)
  return { from: iso(m), to: iso(m.endOf('month')) }
}
export const quarterRange = (year: number, q: number): DateRange => {
  const m = DateTime.fromObject({ year, month: (q - 1) * 3 + 1, day: 1 }, { zone: 'UTC' })
  return { from: iso(m), to: iso(m.plus({ months: 3 }).minus({ days: 1 })) }
}
export const yearRange = (year: number): DateRange => ({ from: `${year}-01-01`, to: `${year}-12-31` })

/** Whole calendar months (from the 1st to the last day)? Then the number of months, else null. */
function wholeMonths(r: DateRange): number | null {
  const a = d(r.from)
  const b = d(r.to)
  if (a.day !== 1 || b.day !== b.daysInMonth) return null
  return (b.year - a.year) * 12 + b.month - a.month + 1
}

/** The period just before: the same number of whole months (month → month, year → year), else the same number of days. */
export function previousRange(r: DateRange): DateRange {
  const months = wholeMonths(r)
  if (months) {
    const from = d(r.from).minus({ months })
    return { from: iso(from), to: iso(from.plus({ months }).minus({ days: 1 })) }
  }
  const days = Math.round(d(r.to).diff(d(r.from), 'days').days) + 1
  return { from: iso(d(r.from).minus({ days })), to: iso(d(r.from).minus({ days: 1 })) }
}

/** "marzec 2026", "I kw. 2026", "2026", else "2026-03-02 – 2026-03-20". */
export function rangeLabel(r: DateRange): string {
  const months = wholeMonths(r)
  const a = d(r.from)
  if (months === 1) return `${MONTHS[a.month - 1]} ${a.year}`
  if (months === 3 && (a.month - 1) % 3 === 0) return `${['I', 'II', 'III', 'IV'][(a.month - 1) / 3]} kw. ${a.year}`
  if (months === 12 && a.month === 1) return String(a.year)
  return `${r.from} – ${r.to}`
}

export const inRange = (date: string, r: DateRange) => date >= r.from && date <= r.to

export interface PeriodMetrics {
  range: DateRange
  trades: number
  wins: number
  losses: number
  winRate: number | null
  expectancy: number | null
  totalR: number
  profitFactor: number | null
  maxDrawdownR: number
  avgWinR: number | null
  avgLossR: number | null
  /** Share of rated closed trades without a broken rule. */
  compliance: number | null
  /** Σ PLN of trades with a PLN result (with `plnOf`), and how many have one. */
  pln: number | null
  plnTrades: number
}

export function periodMetrics(rows: readonly AnalyzedTrade[], range: DateRange, be: number, plnOf?: PlnOf): PeriodMetrics {
  const inside = rows.filter((r) => inRange(r.m.tradingDate, range))
  const s = summaryOf(inside, be)
  const closed = closedTrades(inside)
  const rated = closed.filter((r) => r.v.compliant != null)
  let pln = 0
  let plnTrades = 0
  for (const r of closed) {
    const v = plnOf?.get(r.trade.id)
    if (v != null) {
      pln += v
      plnTrades++
    }
  }
  return {
    range,
    trades: s.count,
    wins: s.wins,
    losses: s.losses,
    winRate: s.winRate,
    expectancy: s.expectancy,
    totalR: s.totalR,
    profitFactor: s.profitFactor,
    maxDrawdownR: s.maxDrawdownR,
    avgWinR: s.avgWinR,
    avgLossR: s.avgLossR,
    compliance: rated.length ? rated.filter((r) => r.v.compliant).length / rated.length : null,
    pln: plnTrades ? grosze(pln) : null,
    plnTrades
  }
}
