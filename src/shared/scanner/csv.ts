/**
 * TradingView „Export chart data” CSV → candles for the scanner store (history of WTI and anything EODHD lacks).
 * Accepted: 1-minute (stored as M1) and 1-hour (stored as H1, enough for H1/H4/D/W). Times are UTC.
 */
import { parseTradingViewCsv } from '../calc/ohlc'
import { isMarketOpen } from './time'
import type { Candle } from './types'

export interface CsvCandles {
  interval: 'M1' | 'H1'
  candles: Candle[]
  /** Unreadable rows. */
  skipped: number
  /** Rows outside FX market hours (weekend). */
  weekend: number
}

function medianStep(times: readonly number[]): number {
  const d: number[] = []
  for (let i = 1; i < times.length; i++) {
    const x = times[i]! - times[i - 1]!
    if (x > 0) d.push(x)
  }
  d.sort((a, b) => a - b)
  return d[Math.floor(d.length / 2)] ?? 0
}

export function tvCsvCandles(text: string): CsvCandles {
  const { bars, skipped } = parseTradingViewCsv(text)
  if (bars.length < 2) throw new Error('Za mało świec w pliku.')
  const all: Candle[] = bars.map((b) => ({
    t: Math.round(b.t / 1000),
    o: b.open,
    h: Math.max(b.high, b.open, b.close),
    l: Math.min(b.low, b.open, b.close),
    c: b.close
  }))
  const step = medianStep(all.map((c) => c.t))
  const interval = step === 60 ? 'M1' : step === 3600 ? 'H1' : null
  if (!interval) {
    const what = step >= 3600 ? `${Math.round(step / 3600)} h` : `${Math.round(step / 60)} min`
    throw new Error(`Plik ma świece co ${what}. Wyeksportuj z TradingView interwał 1 minuta albo 1 godzina.`)
  }
  const candles: Candle[] = []
  let weekend = 0
  let last = -Infinity
  for (const c of all) {
    if (!isMarketOpen(c.t)) {
      weekend++
      continue
    }
    if (c.t === last) continue
    candles.push(c)
    last = c.t
  }
  return { interval, candles, skipped, weekend }
}
