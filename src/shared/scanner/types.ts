/**
 * Shared types of the ICT scanner (docs/skaner). Times are Unix seconds (UTC); a candle's `t` is its open time.
 */

/** Candle intervals built by the scanner. Everything is aggregated from M1 (EODHD 5m/1h bars are not used). */
export const INTERVALS = ['M1', 'M5', 'M15', 'H1', 'H4', 'D', 'W'] as const
export type Interval = (typeof INTERVALS)[number]

/** Length of fixed-size intervals in seconds (H4, D and W follow New York time, see time.ts). */
export const INTERVAL_SECONDS: Record<Interval, number> = {
  M1: 60,
  M5: 300,
  M15: 900,
  H1: 3600,
  H4: 4 * 3600,
  D: 86400,
  W: 5 * 86400
}

export interface Candle {
  /** Open time, Unix seconds UTC. */
  t: number
  o: number
  h: number
  l: number
  c: number
}

/** An aggregated candle: [t, end) in seconds, `incomplete` when its window overlaps missing data. */
export interface SeriesCandle extends Candle {
  end: number
  incomplete?: boolean
}

/** Half-open time range [from, to) in Unix seconds. */
export interface Range {
  from: number
  to: number
}

/** Which price a candle is built from (stream ticks); REST history and TradingView exports are bid. */
export type PriceMode = 'bid' | 'mid'
