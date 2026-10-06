/**
 * Sleep, energy and stress of the morning check (day plan) against the results of that trading day: groups of days
 * with the trades' win rate, average R, ΣR and how many trades had a mistake tag. Pure.
 */
import type { DayPlan, Trade } from '../schema'
import type { TradeMetrics } from './trade'

export interface WellbeingGroup {
  label: string
  days: number
  trades: number
  winRate: number | null
  avgR: number | null
  totalR: number
  /** Share of the trades with a mistake tag. */
  mistakes: number | null
}

export interface WellbeingStats {
  /** Days with at least one value filled in. */
  daysFilled: number
  sleep: WellbeingGroup[]
  energy: WellbeingGroup[]
  stress: WellbeingGroup[]
}

const SLEEP: Array<{ label: string; test: (h: number) => boolean }> = [
  { label: '< 6 h', test: (h) => h < 6 },
  { label: '6–7 h', test: (h) => h >= 6 && h < 7 },
  { label: '7–8 h', test: (h) => h >= 7 && h < 8 },
  { label: '≥ 8 h', test: (h) => h >= 8 }
]
const LEVEL: Array<{ label: string; test: (v: number) => boolean }> = [
  { label: 'niska (1–2)', test: (v) => v <= 2 },
  { label: 'średnia (3)', test: (v) => v === 3 },
  { label: 'wysoka (4–5)', test: (v) => v >= 4 }
]

export function hasWellbeing(day: Pick<DayPlan, 'wellbeing'>): boolean {
  const w = day.wellbeing
  return w.sleepHours != null || w.energy != null || w.stress != null
}

export function wellbeingStats(
  days: readonly DayPlan[],
  rows: ReadonlyArray<{ trade: Trade; m: TradeMetrics }>,
  opts: { from?: string | null; to?: string | null; breakeven?: number } = {}
): WellbeingStats {
  const inRange = (d: string) => (!opts.from || d >= opts.from) && (!opts.to || d <= opts.to)
  const filled = days.filter((d) => inRange(d.date) && hasWellbeing(d))
  const byDate = new Map<string, Array<{ trade: Trade; m: TradeMetrics }>>()
  for (const r of rows) {
    if (!r.m.countsInStats || r.m.resultR == null) continue
    const list = byDate.get(r.m.tradingDate) ?? []
    list.push(r)
    byDate.set(r.m.tradingDate, list)
  }
  const group = <T extends { label: string; test: (v: number) => boolean }>(defs: T[], value: (d: DayPlan) => number | null): WellbeingGroup[] =>
    defs.map((def) => {
      const ds = filled.filter((d) => {
        const v = value(d)
        return v != null && def.test(v)
      })
      const trades = ds.flatMap((d) => byDate.get(d.date) ?? [])
      const wins = trades.filter((t) => t.m.outcome === 'win').length
      const losses = trades.filter((t) => t.m.outcome === 'loss').length
      const totalR = trades.reduce((a, t) => a + (t.m.resultR as number), 0)
      return {
        label: def.label,
        days: ds.length,
        trades: trades.length,
        winRate: wins + losses ? wins / (wins + losses) : null,
        avgR: trades.length ? totalR / trades.length : null,
        totalR,
        mistakes: trades.length ? trades.filter((t) => t.trade.psychology.mistakeTagIds.length > 0).length / trades.length : null
      }
    })
  return {
    daysFilled: filled.length,
    sleep: group(SLEEP, (d) => d.wellbeing.sleepHours),
    energy: group(LEVEL, (d) => d.wellbeing.energy),
    stress: group(LEVEL, (d) => d.wellbeing.stress)
  }
}
