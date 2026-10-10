/**
 * M1 → M5 / M15 / H1 / H4 / D / W. Batch (`aggregate`) and incremental (`Aggregator`) give identical candles; the
 * incremental one closes a bucket when the first bar of a later bucket arrives or when the data watermark (the time up
 * to which M1 is final) passes the bucket end. Bars outside FX market hours are ignored (EODHD quotes weekends).
 */
import { bucketEnd, bucketStart, isMarketOpen } from './time'
import type { Candle, Interval, Range, SeriesCandle } from './types'

function openCandle(bar: Candle, start: number, end: number): SeriesCandle {
  return { t: start, o: bar.o, h: bar.h, l: bar.l, c: bar.c, end }
}

function extend(c: SeriesCandle, bar: Candle): void {
  if (bar.h > c.h) c.h = bar.h
  if (bar.l < c.l) c.l = bar.l
  c.c = bar.c
}

/** Aggregates sorted bars (any base interval ≤ target, aligned to it) into `interval` candles. */
export function aggregate(bars: readonly Candle[], interval: Interval): SeriesCandle[] {
  const out: SeriesCandle[] = []
  let cur: SeriesCandle | null = null
  for (const bar of bars) {
    if (!isMarketOpen(bar.t)) continue
    if (cur && bar.t >= cur.t && bar.t < cur.end) {
      extend(cur, bar)
      continue
    }
    const start = bucketStart(bar.t, interval)
    cur = openCandle(bar, start, bucketEnd(start, interval))
    out.push(cur)
  }
  return out
}

/** Marks candles whose window overlaps a gap (missing data inside market hours). Gaps must be sorted. */
export function markIncomplete<T extends SeriesCandle>(candles: T[], gaps: readonly Range[]): T[] {
  let g = 0
  for (const c of candles) {
    while (g < gaps.length && gaps[g]!.to <= c.t) g++
    const gap = gaps[g]
    if (gap && gap.from < c.end) c.incomplete = true
  }
  return candles
}

export interface ClosedCandle {
  interval: Interval
  candle: SeriesCandle
}

/** Incremental aggregation of M1 bars into several intervals. */
export class Aggregator {
  private readonly current = new Map<Interval, SeriesCandle>()
  /** End of the last closed bucket per interval: bars before it are late and ignored. */
  private readonly closedUntil = new Map<Interval, number>()

  constructor(readonly intervals: readonly Interval[]) {}

  /** Adds a closed M1 bar (in time order); returns candles closed by it, shortest interval first. */
  push(bar: Candle): ClosedCandle[] {
    if (!isMarketOpen(bar.t)) return []
    const closed: ClosedCandle[] = []
    for (const interval of this.intervals) {
      if (bar.t < (this.closedUntil.get(interval) ?? -Infinity)) continue
      const cur = this.current.get(interval)
      if (cur && bar.t >= cur.t && bar.t < cur.end) {
        extend(cur, bar)
        continue
      }
      if (cur) this.close(interval, cur, closed)
      const start = bucketStart(bar.t, interval)
      this.current.set(interval, openCandle(bar, start, bucketEnd(start, interval)))
    }
    return closed
  }

  /** Closes buckets that end at or before `watermark` (M1 data is final up to this instant). */
  advance(watermark: number): ClosedCandle[] {
    const closed: ClosedCandle[] = []
    for (const interval of this.intervals) {
      const cur = this.current.get(interval)
      if (cur && cur.end <= watermark) this.close(interval, cur, closed)
    }
    return closed
  }

  private close(interval: Interval, candle: SeriesCandle, out: ClosedCandle[]): void {
    out.push({ interval, candle })
    this.current.delete(interval)
    this.closedUntil.set(interval, candle.end)
  }

  /** The candle still being built (visible on charts, never given to detectors). */
  forming(interval: Interval): SeriesCandle | null {
    const cur = this.current.get(interval)
    return cur ? { ...cur } : null
  }
}
