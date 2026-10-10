/**
 * Live M1 candles from stream ticks. A minute closes when a tick of a later minute arrives or when the clock passes
 * the minute end plus a grace period. Ignored: ticks outside FX market hours (EODHD quotes weekends), stale ticks
 * (the snapshot sent right after subscribing carries the last old quote) and late ticks of an already closed minute.
 */
import { isMarketOpen } from './time'
import type { Candle, PriceMode } from './types'

export interface Tick {
  symbol: string
  bid: number
  ask: number
  /** Milliseconds since epoch. */
  t: number
}

export interface SymbolTickStats {
  /** Last accepted tick (ms). */
  lastTick: number | null
  /** Last ask − bid. */
  spread: number | null
  accepted: number
  stale: number
  late: number
  closed: number
}

export interface ClosedM1 {
  symbol: string
  candle: Candle
}

interface Building {
  candle: Candle
  end: number
}

export class M1Builder {
  private readonly building = new Map<string, Building>()
  private readonly lastClosed = new Map<string, number>()
  readonly stats = new Map<string, SymbolTickStats>()

  constructor(
    private mode: PriceMode,
    /** Ticks older than this (relative to now) are snapshots or replays, not live prices. */
    private readonly maxDelayMs = 120_000
  ) {}

  setMode(mode: PriceMode): void {
    this.mode = mode
  }

  private statsOf(symbol: string): SymbolTickStats {
    let s = this.stats.get(symbol)
    if (!s) {
      s = { lastTick: null, spread: null, accepted: 0, stale: 0, late: 0, closed: 0 }
      this.stats.set(symbol, s)
    }
    return s
  }

  /** Adds a tick; returns the minute it closed, if any. */
  tick(tick: Tick, nowMs: number): ClosedM1[] {
    const st = this.statsOf(tick.symbol)
    if (tick.t < nowMs - this.maxDelayMs || !isMarketOpen(Math.floor(tick.t / 1000))) {
      st.stale++
      return []
    }
    const minute = Math.floor(tick.t / 60000) * 60
    if (minute < (this.lastClosed.get(tick.symbol) ?? -Infinity)) {
      st.late++
      return []
    }
    const price = this.mode === 'mid' ? (tick.bid + tick.ask) / 2 : tick.bid
    st.accepted++
    st.lastTick = Math.max(st.lastTick ?? 0, tick.t)
    st.spread = tick.ask - tick.bid
    const out: ClosedM1[] = []
    const cur = this.building.get(tick.symbol)
    if (cur && minute === cur.candle.t) {
      const c = cur.candle
      if (price > c.h) c.h = price
      if (price < c.l) c.l = price
      c.c = price
      return out
    }
    if (cur && minute < cur.candle.t) {
      st.late++
      return out
    }
    if (cur) out.push(this.close(tick.symbol, cur))
    this.building.set(tick.symbol, { candle: { t: minute, o: price, h: price, l: price, c: price }, end: minute + 60 })
    return out
  }

  /** Closes minutes whose end + grace has passed (call about once a second). */
  flush(nowMs: number, graceMs = 2000): ClosedM1[] {
    const out: ClosedM1[] = []
    for (const [symbol, cur] of this.building) {
      if (cur.end * 1000 + graceMs <= nowMs) out.push(this.close(symbol, cur))
    }
    return out
  }

  /** The minute still being built (for charts). */
  forming(symbol: string): Candle | null {
    const cur = this.building.get(symbol)
    return cur ? { ...cur.candle } : null
  }

  private close(symbol: string, cur: Building): ClosedM1 {
    this.building.delete(symbol)
    this.lastClosed.set(symbol, cur.end)
    this.statsOf(symbol).closed++
    return { symbol, candle: cur.candle }
  }
}
