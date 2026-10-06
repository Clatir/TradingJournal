/**
 * Weekday × hour of entry (New York) of closed trades (1.4.0): count, ΣR, average R, win rate (BE excluded) and how
 * many trades had a mistake (a mistake tag or a broken rule). Pure.
 */
import { zoned } from './time'
import type { AnalyzedTrade } from './analytics'

export type HeatMetric = 'totalR' | 'avgR' | 'winRate' | 'count' | 'mistakes'

export interface HeatCell {
  weekday: number
  hour: number
  count: number
  totalR: number
  wins: number
  losses: number
  mistakes: number
}

export const HEAT_METRICS: Array<{ value: HeatMetric; label: string }> = [
  { value: 'totalR', label: 'Σ R' },
  { value: 'avgR', label: 'Śr. R' },
  { value: 'winRate', label: 'Win rate' },
  { value: 'count', label: 'Liczba' },
  { value: 'mistakes', label: 'Błędy' }
]

/** Cells keyed "weekday:hour" (weekday 1 = Monday … 7 = Sunday). */
export function weekdayHourCells(rows: readonly AnalyzedTrade[]): Map<string, HeatCell> {
  const out = new Map<string, HeatCell>()
  for (const r of rows) {
    if (!r.m.countsInStats || r.m.resultR == null) continue
    const t = zoned(r.trade.entryTime, 'NY')
    const key = `${t.weekday}:${t.hour}`
    const c = out.get(key) ?? { weekday: t.weekday, hour: t.hour, count: 0, totalR: 0, wins: 0, losses: 0, mistakes: 0 }
    c.count++
    c.totalR += r.m.resultR
    if (r.m.outcome === 'win') c.wins++
    if (r.m.outcome === 'loss') c.losses++
    if (r.trade.psychology.mistakeTagIds.length > 0 || r.v.broken.length > 0) c.mistakes++
    out.set(key, c)
  }
  return out
}

export function cellValue(c: HeatCell, metric: HeatMetric): number | null {
  switch (metric) {
    case 'totalR':
      return c.totalR
    case 'avgR':
      return c.count ? c.totalR / c.count : null
    case 'winRate':
      return c.wins + c.losses ? c.wins / (c.wins + c.losses) : null
    case 'count':
      return c.count
    case 'mistakes':
      return c.mistakes
  }
}

/** Hours to show: from the first to the last hour with a trade (at least 6 hours wide), else the trading day 0–23. */
export function hourRange(cells: ReadonlyMap<string, HeatCell>): [number, number] {
  const hours = [...cells.values()].map((c) => c.hour)
  if (!hours.length) return [0, 23]
  let lo = Math.min(...hours)
  let hi = Math.max(...hours)
  while (hi - lo < 5) {
    if (lo > 0) lo--
    if (hi - lo < 5 && hi < 23) hi++
  }
  return [lo, hi]
}
