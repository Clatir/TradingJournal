/**
 * A closed trade measured on the market's M1 bars (EODHD, 1.8.0): MAE / MFE with the rules of `excursionsFromBars`
 * (the part of the entry bar beyond a level that did not close the trade was before the entry; a level that closed it
 * caps that side), when the extremes came, and which levels price reached before the exit. Market prices are another
 * feed than the broker's (0.1–0.6 pip apart on EURUSD), so a level within the touch margin is "near", not "yes".
 */
import type { Trade, TradeMarket } from '../schema'
import type { Bar } from './ohlc'
import { excursionsFromBars, tradeLevels } from './excursions'

const MIN_MS = 60_000

/** The trade's values its market summary depends on; another key = the summary is out of date. */
export function tradeMarketKey(t: Trade): string {
  const exits = t.exits.filter((e) => e.price != null).map((e) => [e.time, e.price, e.percent])
  return JSON.stringify([t.pair, t.direction, t.status, t.entryTime, t.prices.entry, t.prices.stopLoss, t.prices.takeProfit1, t.prices.takeProfit2, exits])
}

/** The minutes the trade lived (from the entry's minute to the final exit's minute, inclusive); null = not measurable. */
export function tradeMarketWindow(t: Trade): { fromMs: number; toMs: number } | null {
  if (t.status !== 'closed' || t.prices.entry == null) return null
  const lv = tradeLevels(t)
  if (!lv.exitTime) return null
  const from = Math.floor(Date.parse(t.entryTime) / MIN_MS) * MIN_MS
  const to = Math.floor(Date.parse(lv.exitTime) / MIN_MS) * MIN_MS + MIN_MS
  return Number.isFinite(from) && Number.isFinite(to) && to > from ? { fromMs: from, toMs: to } : null
}

/** A closed trade with an entry price and a timed exit whose summary is missing or out of date. */
export function needsMarketStats(t: Trade): boolean {
  return tradeMarketWindow(t) != null && (t.market == null || t.market.key !== tradeMarketKey(t))
}

export interface MarketStatsOptions {
  ticker: string
  pipSize: number
  /** A level counts as reached only beyond this many pips; within it: "near". */
  marginPips: number
  now: string
}

const round2 = (v: number) => Math.round(v * 100) / 100 + 0

type Touch = 'yes' | 'no' | 'near'

/** How far price went (≥ 0) against a distance to a level, with the margin. */
function touch(went: number, dist: number | null, margin: number): Touch | null {
  if (dist == null || !(dist > 0)) return null
  if (went >= dist + margin) return 'yes'
  if (went >= dist - margin) return 'near'
  return 'no'
}

/**
 * The summary (always with `key`): MAE / MFE null and a warning when the bars do not cover the trade (no data for the
 * period, a ticker without minute bars). `bars` are M1 of the trade's window (more is fine).
 */
export function marketStatsFor(t: Trade, bars: readonly Bar[], opts: MarketStatsOptions): TradeMarket {
  const empty = (warning: string): TradeMarket => ({
    source: 'eodhd',
    ticker: opts.ticker,
    key: tradeMarketKey(t),
    computedAt: opts.now,
    maePips: null,
    mfePips: null,
    maeR: null,
    mfeR: null,
    maeAt: null,
    mfeAt: null,
    maeMinutes: null,
    mfeMinutes: null,
    reached1R: null,
    reached2R: null,
    reachedTp1: null,
    reachedTp2: null,
    stopTouched: null,
    warnings: [warning]
  })
  const win = tradeMarketWindow(t)
  const lv = tradeLevels(t)
  if (!win || lv.entry == null || !lv.exitTime) return empty('Transakcja bez ceny wejścia albo czasu wyjścia.')
  const inside = bars.filter((b) => b.t >= win.fromMs && b.t < win.toMs)
  const minutes = Math.round((win.toMs - win.fromMs) / MIN_MS)
  const hasEntry = inside.some((b) => b.t === win.fromMs)
  const hasExit = inside.some((b) => b.t === win.toMs - MIN_MS)
  if (!inside.length || (!hasEntry && !hasExit)) return empty('Brak świec M1 z czasu transakcji w danych rynkowych.')
  // excursionsFromBars learns the step from neighbouring bars: a copy of the last bar one minute later (after the
  // exit, never measured) makes a one-bar trade measurable too.
  const last = inside[inside.length - 1]!
  const ex = excursionsFromBars([...inside, { ...last, t: last.t + MIN_MS }], {
    direction: t.direction,
    entry: lv.entry,
    stopLoss: lv.stopLoss,
    takeProfit: lv.takeProfit,
    exitPrice: lv.exitPrice,
    entryTime: t.entryTime,
    exitTime: lv.exitTime,
    pipSize: opts.pipSize
  })
  if ('error' in ex) return empty(`Nie da się zmierzyć: ${ex.error.replace(/ w pliku CSV| pliku CSV/g, '')}`)
  const pip = opts.pipSize
  const margin = opts.marginPips * pip
  const adverse = -ex.maePips * pip
  const favourable = ex.mfePips * pip
  const risk = lv.stopLoss != null ? Math.abs(lv.entry - lv.stopLoss) : null
  const dist = (p: number | null) => (p == null ? null : Math.abs(p - lv.entry!))
  const entryMs = Date.parse(t.entryTime)
  const at = (ms: number | null) => (ms == null ? null : new Date(ms).toISOString())
  const after = (ms: number | null) => (ms == null ? null : Math.max(0, Math.round((ms - entryMs) / MIN_MS)))
  const tp1 = t.prices.takeProfit1
  const tp2 = t.prices.takeProfit2
  // The level that closed the trade was reached, whatever the other feed says.
  const exitTarget = ex.exit === 'target' ? lv.takeProfit : null
  const warnings = ex.warnings.filter((w) => !/CSV/.test(w))
  const coverage = inside.length / Math.max(1, minutes)
  if (coverage < 0.8) warnings.push(`Dane rynkowe mają luki: ${Math.round(coverage * 100)}% minut transakcji.`)
  return {
    source: 'eodhd',
    ticker: opts.ticker,
    key: tradeMarketKey(t),
    computedAt: opts.now,
    maePips: ex.maePips,
    mfePips: ex.mfePips,
    maeR: risk ? round2(-adverse / risk) : null,
    mfeR: risk ? round2(favourable / risk) : null,
    maeAt: at(ex.maeAt),
    mfeAt: at(ex.mfeAt),
    maeMinutes: after(ex.maeAt),
    mfeMinutes: after(ex.mfeAt),
    reached1R: touch(favourable, risk, margin),
    reached2R: touch(favourable, risk != null ? 2 * risk : null, margin),
    reachedTp1: exitTarget != null && exitTarget === tp1 ? 'yes' : touch(favourable, dist(tp1), margin),
    reachedTp2: exitTarget != null && exitTarget === tp2 ? 'yes' : touch(favourable, dist(tp2), margin),
    stopTouched: ex.exit === 'stop' ? 'yes' : touch(adverse, risk, margin),
    warnings
  }
}

/** The trade with its market summary; MAE / MFE only where empty (typed, TradingView and CSV values stay). */
export function withMarketStats(t: Trade, m: TradeMarket): Trade {
  return { ...t, market: m, maePips: t.maePips ?? m.maePips, mfePips: t.mfePips ?? m.mfePips }
}

/** MAE / MFE of the trade differ from the market's by more than the margin (for "Użyj danych rynkowych"). */
export function marketDiffers(t: Trade, marginPips: number): boolean {
  const m = t.market
  if (!m || m.maePips == null || m.mfePips == null) return false
  const off = (a: number | null, b: number) => a == null || Math.abs(a - b) > marginPips
  return off(t.maePips, m.maePips) || off(t.mfePips, m.mfePips)
}
