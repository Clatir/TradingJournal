/**
 * "Co by było, gdyby" (EODHD, 1.10.0): the same entry and stop managed differently, replayed on M1 bars after the
 * entry's minute until the horizon (17:00 NY of the trading day, or the real exit when later). A bar reaching the stop
 * and the target cannot be ordered: counted as the stop and marked uncertain, as is a level reached by less than the
 * touch margin (another feed than the broker's). Unresolved at the horizon = closed at the last close.
 * Volatility of the trade's day: ATR of 14 trading days (forex daily candles 17:00–17:00 NY) before it.
 */
import type { Trade } from '../schema'
import type { Bar } from './ohlc'
import { daySession, previousTradingDay, sessionDateOf } from './marketLevels'
import { tradeLevels } from './excursions'

const MIN_MS = 60_000

export const WHAT_IF = [
  { id: 'tp1', label: 'Trzymanie do TP1', hint: 'cała pozycja do TP1 albo SL' },
  { id: 'tp2', label: 'Trzymanie do TP2', hint: 'cała pozycja do TP2 albo SL' },
  { id: 'be1R_tp2', label: 'TP2, SL na BE po 1R', hint: 'po dojściu do 1R stop na cenę wejścia' },
  { id: 'r2', label: 'Stały cel 2R', hint: 'cel 2 × ryzyko' },
  { id: 'r3', label: 'Stały cel 3R', hint: 'cel 3 × ryzyko' },
  { id: 'half1R_tp2', label: '50% na 1R, reszta TP2 z BE', hint: 'połowa zamknięta na 1R, reszta do TP2 ze stopem na BE' }
] as const
export type WhatIfId = (typeof WHAT_IF)[number]['id']

export interface WhatIfOutcome {
  r: number
  uncertain: boolean
}

/** The horizon of the replay: 17:00 NY of the entry's trading day, the real final exit when later. */
export function whatIfHorizon(t: Trade): number | null {
  const lv = tradeLevels(t)
  if (t.status !== 'closed' || !lv.exitTime) return null
  const end = daySession(sessionDateOf(t.entryTime)).to
  return Math.max(end, Math.floor(Date.parse(lv.exitTime) / MIN_MS) * MIN_MS + MIN_MS)
}

interface Plan {
  /** Price levels as distances in R from the entry (+ = in favour). */
  target: number | null
  /** The stop moves to the entry once price reached this many R. */
  beAfter: number | null
  /** Part closed at this many R (the rest follows target / stop). */
  partial: { atR: number; share: number } | null
}

/**
 * One plan replayed: `fav(b)` / `adv(b)` = how far the bar went in R in favour / against. Within the margin of a
 * decisive level the result is marked uncertain.
 */
function replay(bars: readonly Bar[], fav: (b: Bar) => number, adv: (b: Bar) => number, closeR: (b: Bar) => number, plan: Plan, marginR: number): WhatIfOutcome | null {
  if (!bars.length) return null
  let stop = -1 // in R
  let open = 1 // share still open
  let banked = 0 // R from closed parts
  let uncertain = false
  let partialDone = false
  for (const b of bars) {
    const f = fav(b)
    const a = adv(b)
    const stopHit = -a <= stop
    const targetHit = plan.target != null && f >= plan.target
    const partialHit = !!plan.partial && !partialDone && f >= plan.partial.atR
    if (stopHit && (targetHit || partialHit)) {
      // The same minute: the stop counts (the order is unknown).
      return { r: banked + open * stop, uncertain: true }
    }
    if (stopHit) {
      if (Math.abs(-a - stop) < marginR) uncertain = true
      return { r: banked + open * stop, uncertain }
    }
    if (partialHit) {
      banked += plan.partial!.share * plan.partial!.atR
      open -= plan.partial!.share
      partialDone = true
      if (f - plan.partial!.atR < marginR) uncertain = true
    }
    if (targetHit) {
      if (f - plan.target! < marginR) uncertain = true
      return { r: banked + open * plan.target!, uncertain }
    }
    // The stop moves after this bar (inside it the order of the reach and a pullback is unknown).
    if (plan.beAfter != null && f >= plan.beAfter && stop < 0) stop = 0
  }
  return { r: banked + open * closeR(bars[bars.length - 1]!), uncertain }
}

const round2 = (v: number) => Math.round(v * 100) / 100 + 0

/** All plans for a closed trade with an entry and a stop; null per plan without its target (TP1 / TP2). */
export function whatIfFor(t: Trade, bars: readonly Bar[], until: number, margin: number): Record<WhatIfId, WhatIfOutcome | null> | null {
  const entry = t.prices.entry
  const sl = t.prices.stopLoss
  if (entry == null || sl == null || entry === sl) return null
  const risk = Math.abs(entry - sl)
  const dir = t.direction === 'long' ? 1 : -1
  const from = Math.floor(Date.parse(t.entryTime) / MIN_MS) * MIN_MS + MIN_MS
  const after = bars.filter((b) => b.t >= from && b.t < until)
  if (!after.length) return null
  const fav = (b: Bar) => ((dir > 0 ? b.high : b.low) - entry) * dir / risk
  const adv = (b: Bar) => (entry - (dir > 0 ? b.low : b.high)) * dir / risk
  const closeR = (b: Bar) => ((b.close - entry) * dir) / risk
  const toR = (p: number | null) => (p == null ? null : ((p - entry) * dir) / risk)
  const tp1 = toR(t.prices.takeProfit1)
  const tp2 = toR(t.prices.takeProfit2)
  const marginR = margin / risk
  const run = (plan: Plan) => {
    const o = replay(after, fav, adv, closeR, plan, marginR)
    return o ? { r: round2(o.r), uncertain: o.uncertain } : null
  }
  const valid = (r: number | null) => (r != null && r > 0 ? r : null)
  return {
    tp1: valid(tp1) != null ? run({ target: tp1, beAfter: null, partial: null }) : null,
    tp2: valid(tp2) != null ? run({ target: tp2, beAfter: null, partial: null }) : null,
    be1R_tp2: valid(tp2) != null ? run({ target: tp2, beAfter: 1, partial: null }) : null,
    r2: run({ target: 2, beAfter: null, partial: null }),
    r3: run({ target: 3, beAfter: null, partial: null }),
    half1R_tp2: valid(tp2) != null && tp2! > 1 ? run({ target: tp2, beAfter: 1, partial: { atR: 1, share: 0.5 } }) : null
  }
}

export interface Volatility {
  /** ATR(14) of the trading days before the entry's day, in pips. */
  atrPips: number | null
  /** The stop as a multiple of that ATR. */
  slAtr: number | null
  /** Range of the Asia session before the entry (pips). */
  asiaRangePips: number | null
}

/** Bars needed for the ATR: 15 trading days before the entry's day (21 calendar days back is enough). */
export function volatilityWindowFrom(t: Trade): number {
  let d = sessionDateOf(t.entryTime)
  for (let i = 0; i < 15; i++) d = previousTradingDay(d)
  return daySession(d).from
}

/** ATR(14) (true range of daily candles 17:00–17:00 NY) before the trade's day; null with fewer than 10 days. */
export function atrBefore(t: Trade, bars: readonly Bar[]): number | null {
  const days: Array<{ high: number; low: number; close: number }> = []
  let d = sessionDateOf(t.entryTime)
  const dates: string[] = []
  for (let i = 0; i < 15; i++) {
    d = previousTradingDay(d)
    dates.unshift(d)
  }
  for (const date of dates) {
    const s = daySession(date)
    let high = -Infinity
    let low = Infinity
    let close: number | null = null
    for (const b of bars) {
      if (b.t < s.from || b.t >= s.to) continue
      if (b.high > high) high = b.high
      if (b.low < low) low = b.low
      close = b.close
    }
    if (close != null) days.push({ high, low, close })
  }
  if (days.length < 11) return null
  const trs: number[] = []
  for (let i = 1; i < days.length; i++) {
    const p = days[i - 1]!.close
    const x = days[i]!
    trs.push(Math.max(x.high - x.low, Math.abs(x.high - p), Math.abs(x.low - p)))
  }
  const last = trs.slice(-14)
  return last.reduce((s, v) => s + v, 0) / last.length
}

export function volatilityFor(t: Trade, bars: readonly Bar[], pipSize: number, asiaRange: number | null): Volatility {
  const atr = atrBefore(t, bars)
  const sl = t.prices.entry != null && t.prices.stopLoss != null ? Math.abs(t.prices.entry - t.prices.stopLoss) : null
  return {
    atrPips: atr != null ? Math.round((atr / pipSize) * 10) / 10 : null,
    slAtr: atr && sl != null ? round2(sl / atr) : null,
    asiaRangePips: asiaRange != null ? Math.round((asiaRange / pipSize) * 10) / 10 : null
  }
}
