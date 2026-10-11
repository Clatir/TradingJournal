/**
 * Analytics from the market summaries of trades (EODHD, 1.10.0): other ways to manage the same trades compared with
 * what was done (on exactly the same trades), results by the day's volatility (ATR percentiles per pair – pips of
 * EURUSD and gold are not comparable), the stop in ATR, and when the extremes came.
 */
import type { AnalyzedTrade } from './analytics'
import { closedTrades } from './analytics'
import { summarize } from './stats'
import { WHAT_IF, type WhatIfId } from './whatIf'

const closeTime = (r: AnalyzedTrade) => r.m.exitTime ?? r.trade.entryTime

export interface WhatIfLine {
  id: WhatIfId | 'actual'
  label: string
  hint: string
  count: number
  totalR: number
  expectancy: number | null
  winRate: number | null
  maxDrawdownR: number
  /** Σ R of the plan − Σ R actually made on the same trades. */
  deltaR: number
  /** Trades whose replay was uncertain (a stop and a target in the same minute, a level within the margin). */
  uncertain: number
}

/** The plans next to the real result; each plan on the trades where it applies (TP2 plans need a TP2). */
export function whatIfSummary(rows: readonly AnalyzedTrade[], be: number): { trades: number; lines: WhatIfLine[] } {
  const with_ = closedTrades(rows).filter((r) => r.trade.market?.whatIf)
  const actual = summarize(with_.map((r) => ({ r: r.m.resultR!, time: closeTime(r) })), be)
  const lines: WhatIfLine[] = [
    {
      id: 'actual',
      label: 'Rzeczywiście',
      hint: 'jak zarządzałeś',
      count: actual.count,
      totalR: actual.totalR,
      expectancy: actual.expectancy,
      winRate: actual.winRate,
      maxDrawdownR: actual.maxDrawdownR,
      deltaR: 0,
      uncertain: 0
    }
  ]
  for (const plan of WHAT_IF) {
    const used = with_.filter((r) => r.trade.market!.whatIf!.results[plan.id] != null)
    const s = summarize(used.map((r) => ({ r: r.trade.market!.whatIf!.results[plan.id]!.r, time: closeTime(r) })), be)
    const real = used.reduce((sum, r) => sum + r.m.resultR!, 0)
    lines.push({
      id: plan.id,
      label: plan.label,
      hint: plan.hint,
      count: s.count,
      totalR: s.totalR,
      expectancy: s.expectancy,
      winRate: s.winRate,
      maxDrawdownR: s.maxDrawdownR,
      deltaR: s.totalR - real,
      uncertain: used.filter((r) => r.trade.market!.whatIf!.results[plan.id]!.uncertain).length
    })
  }
  return { trades: with_.length, lines }
}

export type Regime = 'calm' | 'normal' | 'hot'
export const REGIME_LABELS: Record<Regime, string> = { calm: 'spokojny (dolne 25%)', normal: 'normalny', hot: 'gorący (górne 25%)' }

export interface GroupLine {
  id: string
  label: string
  count: number
  totalR: number
  expectancy: number | null
  winRate: number | null
}

function quantile(sorted: readonly number[], q: number): number {
  if (!sorted.length) return NaN
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo)
}

/** Each trade's regime: its ATR against the 25th / 75th percentile of its pair's trades (at least 4 per pair). */
export function regimes(rows: readonly AnalyzedTrade[]): Map<string, Regime> {
  const byPair = new Map<string, number[]>()
  for (const r of rows) {
    const atr = r.trade.market?.vol?.atrPips
    if (atr != null) byPair.set(r.trade.pair, [...(byPair.get(r.trade.pair) ?? []), atr])
  }
  const cut = new Map([...byPair].filter(([, xs]) => xs.length >= 4).map(([p, xs]) => {
    const s = [...xs].sort((a, b) => a - b)
    return [p, { p25: quantile(s, 0.25), p75: quantile(s, 0.75) }] as const
  }))
  const out = new Map<string, Regime>()
  for (const r of rows) {
    const atr = r.trade.market?.vol?.atrPips
    const c = cut.get(r.trade.pair)
    if (atr == null || !c) continue
    out.set(r.trade.id, atr <= c.p25 ? 'calm' : atr >= c.p75 ? 'hot' : 'normal')
  }
  return out
}

function group(id: string, label: string, rows: readonly AnalyzedTrade[], be: number): GroupLine {
  const s = summarize(rows.map((r) => ({ r: r.m.resultR!, time: closeTime(r) })), be)
  return { id, label, count: s.count, totalR: s.totalR, expectancy: s.expectancy, winRate: s.winRate }
}

const SL_BUCKETS: Array<{ id: string; label: string; max: number }> = [
  { id: 'sl1', label: 'SL ≤ 0,10 ATR', max: 0.1 },
  { id: 'sl2', label: '0,10–0,20 ATR', max: 0.2 },
  { id: 'sl3', label: '0,20–0,35 ATR', max: 0.35 },
  { id: 'sl4', label: '> 0,35 ATR', max: Infinity }
]

/** Results by volatility regime and by the stop's size in ATR. */
export function volatilityBreakdown(rows: readonly AnalyzedTrade[], be: number): { regimes: GroupLine[]; stops: GroupLine[]; measured: number } {
  const closed = closedTrades(rows)
  const reg = regimes(closed)
  const regimeLines = (['calm', 'normal', 'hot'] as const).map((g) => group(g, REGIME_LABELS[g], closed.filter((r) => reg.get(r.trade.id) === g), be))
  const withStop = closed.filter((r) => r.trade.market?.vol?.slAtr != null)
  let low = 0
  const stops = SL_BUCKETS.map((b) => {
    const line = group(b.id, b.label, withStop.filter((r) => r.trade.market!.vol!.slAtr! > low && r.trade.market!.vol!.slAtr! <= b.max), be)
    low = b.max
    return line
  })
  // A stop of exactly 0 (no SL) is not in any bucket.
  return { regimes: regimeLines, stops, measured: closed.filter((r) => r.trade.market?.vol?.atrPips != null).length }
}

export interface ExcursionTiming {
  measured: number
  /** Share of measured trades whose price reached 1R / 2R before the exit (a sure touch). */
  reached1R: number | null
  reached2R: number | null
  /** Median minutes from the entry to the MFE of winners and to the MAE of losers. */
  mfeMinutesWinners: number | null
  maeMinutesLosers: number | null
  /** The stop level was touched by market prices although the trade was not stopped (another feed, a moved stop…). */
  stopTouchedSurvived: number
}

function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

export function excursionTiming(rows: readonly AnalyzedTrade[], be: number): ExcursionTiming {
  const measured = closedTrades(rows).filter((r) => r.trade.market?.maePips != null)
  const share = (f: (r: AnalyzedTrade) => boolean) => (measured.length ? measured.filter(f).length / measured.length : null)
  return {
    measured: measured.length,
    reached1R: share((r) => r.trade.market!.reached1R === 'yes'),
    reached2R: share((r) => r.trade.market!.reached2R === 'yes'),
    mfeMinutesWinners: median(measured.filter((r) => r.m.resultR! > be && r.trade.market!.mfeMinutes != null).map((r) => r.trade.market!.mfeMinutes!)),
    maeMinutesLosers: median(measured.filter((r) => r.m.resultR! < -be && r.trade.market!.maeMinutes != null).map((r) => r.trade.market!.maeMinutes!)),
    stopTouchedSurvived: measured.filter((r) => r.trade.market!.stopTouched === 'yes' && r.m.resultR! > -0.9).length
  }
}
