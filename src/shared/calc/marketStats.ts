/**
 * A trade measured on the market's M1 bars (EODHD). Closed trades (1.8.0): MAE / MFE with the rules of
 * `excursionsFromBars` (the part of the entry bar beyond a level that did not close the trade was before the entry; a
 * level that closed it caps that side), when the extremes came, which levels price reached before the exit; liquidity
 * taken before the entry (1.9.0). Missed trades (1.9.0): what price reached first after the entry until 17:00 NY.
 * Market prices are another feed than the broker's (0.1–0.6 pip apart on EURUSD), so a level within the touch margin
 * is "near", not "yes".
 */
import type { Trade, TradeMarket } from '../schema'
import type { Bar } from './ohlc'
import { excursionsFromBars, tradeLevels } from './excursions'
import { liquidityTakenBefore, sessionDateOf, type MarketLevel } from './marketLevels'
import { nyWallToMs } from './sessionSpans'
import { volatilityFor, whatIfFor, whatIfHorizon } from './whatIf'

const MIN_MS = 60_000
/** Version of the summary; an older one is computed again (2 = 1.9.0 liquidity, missed; 3 = 1.10.0 what-if, volatility). */
export const MARKET_STATS_VERSION = 3

/** The trade's values its market summary depends on; another key = the summary is out of date. */
export function tradeMarketKey(t: Trade): string {
  const exits = t.exits.filter((e) => e.price != null).map((e) => [e.time, e.price, e.percent])
  return JSON.stringify([t.pair, t.direction, t.status, t.entryTime, t.prices.entry, t.prices.stopLoss, t.prices.takeProfit1, t.prices.takeProfit2, exits])
}

export { sessionDateOf }

/** A missed trade is followed until 17:00 NY of its trading day (at least an hour). */
export function missedHorizon(t: Trade): number | null {
  const entry = Date.parse(t.entryTime)
  if (!Number.isFinite(entry)) return null
  return Math.max(nyWallToMs(sessionDateOf(t.entryTime), '17:00'), entry + 60 * MIN_MS)
}

/**
 * The minutes to measure: a closed trade from the entry's minute to the final exit's minute (inclusive); a missed one
 * from the entry's minute to its horizon. null = not measurable (no entry price, no timed exit, no SL / TP).
 */
export function tradeMarketWindow(t: Trade): { fromMs: number; toMs: number } | null {
  if (t.prices.entry == null) return null
  const from = Math.floor(Date.parse(t.entryTime) / MIN_MS) * MIN_MS
  if (!Number.isFinite(from)) return null
  if (t.status === 'missed') {
    if (t.prices.stopLoss == null && t.prices.takeProfit1 == null && t.prices.takeProfit2 == null) return null
    const to = missedHorizon(t)
    return to != null && to > from ? { fromMs: from, toMs: to } : null
  }
  if (t.status !== 'closed') return null
  const lv = tradeLevels(t)
  if (!lv.exitTime) return null
  const to = Math.floor(Date.parse(lv.exitTime) / MIN_MS) * MIN_MS + MIN_MS
  return Number.isFinite(to) && to > from ? { fromMs: from, toMs: to } : null
}

/** Measurable, and the summary is missing, out of date or of an older version; a missed trade once its horizon passed. */
export function needsMarketStats(t: Trade, nowMs = Date.now()): boolean {
  const win = tradeMarketWindow(t)
  if (!win) return false
  if (t.status === 'missed' && nowMs < win.toMs) return false
  if (t.market == null || t.market.key !== tradeMarketKey(t) || (t.market.v ?? 1) !== MARKET_STATS_VERSION) return true
  // "Co by było, gdyby" waits for the end of the trading day.
  return t.market.whatIfAfter != null && nowMs >= Date.parse(t.market.whatIfAfter)
}

export interface MarketStatsOptions {
  ticker: string
  pipSize: number
  /** A level counts as reached only beyond this many pips; within it: "near". */
  marginPips: number
  now: string
  /** Levels of the trading day and the bars from the previous week to the entry (liquidity taken before the entry). */
  levels?: { levels: readonly MarketLevel[]; bars: readonly Bar[] }
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

function emptySummary(t: Trade, opts: MarketStatsOptions, warning: string | null): TradeMarket {
  return {
    v: MARKET_STATS_VERSION,
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
    liquidity: [],
    missed: null,
    whatIf: null,
    whatIfAfter: null,
    vol: null,
    warnings: warning ? [warning] : []
  }
}

function liquidity(t: Trade, opts: MarketStatsOptions): TradeMarket['liquidity'] {
  if (!opts.levels) return []
  const entry = Date.parse(t.entryTime)
  return liquidityTakenBefore(opts.levels.levels, opts.levels.bars, entry, opts.marginPips * opts.pipSize).map((l) => ({ id: l.id, label: l.label, touch: l.touch, at: new Date(l.at).toISOString() }))
}

/**
 * The summary (always with `key` and `v`): values null and a warning when the bars do not cover the trade (no data for
 * the period, a ticker without minute bars). `bars` are M1 of the trade's window (more is fine).
 */
export function marketStatsFor(t: Trade, bars: readonly Bar[], opts: MarketStatsOptions): TradeMarket {
  if (t.status === 'missed') return missedStatsFor(t, bars, opts)
  const win = tradeMarketWindow(t)
  const lv = tradeLevels(t)
  if (!win || lv.entry == null || !lv.exitTime) return emptySummary(t, opts, 'Transakcja bez ceny wejścia albo czasu wyjścia.')
  const inside = bars.filter((b) => b.t >= win.fromMs && b.t < win.toMs)
  const minutes = Math.round((win.toMs - win.fromMs) / MIN_MS)
  const hasEntry = inside.some((b) => b.t === win.fromMs)
  const hasExit = inside.some((b) => b.t === win.toMs - MIN_MS)
  if (!inside.length || (!hasEntry && !hasExit)) return { ...emptySummary(t, opts, 'Brak świec M1 z czasu transakcji w danych rynkowych.'), liquidity: liquidity(t, opts) }
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
  if ('error' in ex) return emptySummary(t, opts, `Nie da się zmierzyć: ${ex.error.replace(/ w pliku CSV| pliku CSV/g, '')}`)
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
    ...emptySummary(t, opts, null),
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
    liquidity: liquidity(t, opts),
    ...whatIfAndVolatility(t, bars, opts),
    warnings
  }
}

/** The plans replayed once the trading day has ended, and the day's volatility (with the context bars). */
function whatIfAndVolatility(t: Trade, bars: readonly Bar[], opts: MarketStatsOptions): Pick<TradeMarket, 'whatIf' | 'whatIfAfter' | 'vol'> {
  const context = opts.levels?.bars ?? bars
  const asiaH = opts.levels?.levels.find((l) => l.id === 'asiaH')
  const asiaL = opts.levels?.levels.find((l) => l.id === 'asiaL')
  const vol = volatilityFor(t, context, opts.pipSize, asiaH && asiaL ? asiaH.price - asiaL.price : null)
  const horizon = whatIfHorizon(t)
  if (horizon == null) return { whatIf: null, whatIfAfter: null, vol }
  const now = Date.parse(opts.now)
  if (Number.isFinite(now) && now < horizon) return { whatIf: null, whatIfAfter: new Date(horizon).toISOString(), vol }
  const results = whatIfFor(t, context, horizon, opts.marginPips * opts.pipSize)
  return { whatIf: results ? { horizon: new Date(horizon).toISOString(), results } : null, whatIfAfter: null, vol }
}

export interface MissedOutcome {
  outcome: 'tp1' | 'tp2' | 'sl' | 'none'
  /** No touch within the margin before the decisive one, and not two levels in the same minute. */
  certain: boolean
  /** UTC ms of the minute that decided (null for "none"). */
  at: number | null
}

/**
 * What price reached first after a missed entry (bars after the entry's minute up to `until`): TP1 (then TP2 before
 * SL = tp2), SL, or nothing. The same minute reaching the stop and a target cannot be ordered: uncertain.
 */
export function missedOutcomeFor(t: Trade, bars: readonly Bar[], until: number, margin: number): MissedOutcome {
  const entry = t.prices.entry!
  const long = t.direction === 'long'
  const first = t.prices.takeProfit1 ?? t.prices.takeProfit2
  const second = t.prices.takeProfit1 != null ? t.prices.takeProfit2 : null
  const sl = t.prices.stopLoss
  const fromMs = Math.floor(Date.parse(t.entryTime) / MIN_MS) * MIN_MS + MIN_MS
  // How far beyond a level the bar went (> margin = reached, > −margin = near).
  const beyondTarget = (b: Bar, level: number) => (long ? b.high - level : level - b.low)
  const beyondStop = (b: Bar, level: number) => (long ? level - b.low : b.high - level)
  let near = false
  let reachedFirst: number | null = null
  for (const b of bars) {
    if (b.t < fromMs || b.t >= until) continue
    const slHit = sl != null && beyondStop(b, sl) > margin
    const slNear = sl != null && beyondStop(b, sl) > -margin
    if (reachedFirst == null) {
      const t1 = first != null && beyondTarget(b, first) > margin
      const t1Near = first != null && beyondTarget(b, first) > -margin
      if (slHit && t1) return { outcome: 'sl', certain: false, at: b.t }
      if (slHit) return { outcome: 'sl', certain: !near, at: b.t }
      if (t1) {
        reachedFirst = b.t
        if (second == null) return { outcome: 'tp1', certain: !near, at: b.t }
        if (beyondTarget(b, second) > margin) return { outcome: 'tp2', certain: !near, at: b.t }
        continue
      }
      if (slNear || t1Near) near = true
    } else {
      const t2 = beyondTarget(b, second!) > margin
      if (slHit && t2) return { outcome: 'tp1', certain: false, at: reachedFirst }
      if (t2) return { outcome: 'tp2', certain: !near, at: b.t }
      if (slHit) return { outcome: 'tp1', certain: !near, at: reachedFirst }
      if (slNear || beyondTarget(b, second!) > -margin) near = true
    }
  }
  if (reachedFirst != null) return { outcome: 'tp1', certain: !near, at: reachedFirst }
  return { outcome: 'none', certain: !near, at: null }
}

function missedStatsFor(t: Trade, bars: readonly Bar[], opts: MarketStatsOptions): TradeMarket {
  const win = tradeMarketWindow(t)
  if (!win || t.prices.entry == null) return emptySummary(t, opts, 'Missed bez ceny wejścia albo poziomów.')
  const after = bars.filter((b) => b.t > win.fromMs && b.t < win.toMs)
  if (!after.length) return { ...emptySummary(t, opts, 'Brak świec M1 po wejściu w danych rynkowych.'), liquidity: liquidity(t, opts) }
  const o = missedOutcomeFor(t, bars, win.toMs, opts.marginPips * opts.pipSize)
  return {
    ...emptySummary(t, opts, null),
    liquidity: liquidity(t, opts),
    missed: { outcome: o.outcome, certain: o.certain, at: o.at != null ? new Date(o.at).toISOString() : null, until: new Date(win.toMs).toISOString() }
  }
}

/**
 * The trade with its market summary. Closed: MAE / MFE only where empty (typed, TradingView and CSV values stay).
 * Missed: the outcome only when none was chosen and the answer is certain.
 */
export function withMarketStats(t: Trade, m: TradeMarket): Trade {
  const next: Trade = { ...t, market: m, maePips: t.maePips ?? m.maePips, mfePips: t.mfePips ?? m.mfePips }
  if (t.status === 'missed' && m.missed?.certain && t.missed.hypotheticalOutcome == null) next.missed = { ...t.missed, hypotheticalOutcome: m.missed.outcome }
  return next
}

/** MAE / MFE of the trade differ from the market's by more than the margin (for "Użyj danych rynkowych"). */
export function marketDiffers(t: Trade, marginPips: number): boolean {
  const m = t.market
  if (!m || m.maePips == null || m.mfePips == null) return false
  const off = (a: number | null, b: number) => a == null || Math.abs(a - b) > marginPips
  return off(t.maePips, m.maePips) || off(t.mfePips, m.mfePips)
}
