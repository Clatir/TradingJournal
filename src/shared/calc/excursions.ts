/**
 * MAE / MFE from OHLC bars (TradingView "Export chart data" CSV) – the exact check of the screenshot reading: from the
 * bar holding the entry to the bar holding the final exit. Those two bars hold price from before the entry and after
 * the exit; their parts beyond a level that did not close the trade are left out, and a level that closed it caps the
 * excursion on its side (as on the screenshot). A lower timeframe (M1) leaves less doubt.
 */
import type { Trade } from '../schema/trade'
import type { Bar } from './ohlc'

export interface BarExcursionInput {
  direction: 'long' | 'short'
  entry: number
  stopLoss: number | null
  takeProfit: number | null
  /** Final exit price (decides whether the stop or the target closed the trade). */
  exitPrice: number | null
  /** UTC ISO. */
  entryTime: string
  /** UTC ISO of the final exit; null = to the last bar (open trade). */
  exitTime: string | null
  pipSize: number
  /** Leave out the bar holding the entry. */
  skipEntryCandle?: boolean
}

export interface BarExcursion {
  /** Negative pips (journal convention). */
  maePips: number
  mfePips: number
  exit: 'stop' | 'target' | 'end'
  /** Bars used, their length in minutes and the time span (UTC ms of the first bar's open, the last bar's close). */
  bars: number
  barMinutes: number
  from: number
  to: number
  /** Where the extremes are (UTC ms of the bar's open), null without one. */
  maeAt: number | null
  mfeAt: number | null
  warnings: string[]
}

const round1 = (v: number) => Math.round(v * 10) / 10 + 0

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  return s[s.length >> 1] ?? 0
}

export function excursionsFromBars(bars: readonly Bar[], input: BarExcursionInput): BarExcursion | { error: string } {
  if (bars.length < 2) return { error: 'Za mało świec w pliku CSV.' }
  const sorted = [...bars].sort((a, b) => a.t - b.t)
  const step = median(sorted.slice(1).map((b, i) => b.t - sorted[i]!.t).filter((d) => d > 0))
  if (!(step > 0)) return { error: 'Nie da się ustalić interwału świec w pliku CSV.' }
  const entryMs = Date.parse(input.entryTime)
  const exitMs = input.exitTime ? Date.parse(input.exitTime) : null
  const first = sorted[0]!
  const last = sorted[sorted.length - 1]!
  if (!Number.isFinite(entryMs) || entryMs < first.t || entryMs >= last.t + step)
    return { error: 'Plik CSV nie obejmuje czasu wejścia – wyeksportuj wykres z widocznym dniem transakcji.' }
  if (exitMs != null && exitMs < entryMs) return { error: 'Czas wyjścia jest przed czasem wejścia.' }
  const warnings: string[] = []
  if (exitMs != null && exitMs >= last.t + step) warnings.push('Plik CSV kończy się przed wyjściem z transakcji – policzono do ostatniej świecy.')

  const pip = input.pipSize
  const long = input.direction === 'long'
  const near = (a: number | null, b: number | null) => a != null && b != null && Math.abs(a - b) / pip <= 1.5
  const tradeExit = input.exitPrice == null ? null : near(input.exitPrice, input.stopLoss) ? 'stop' : near(input.exitPrice, input.takeProfit) ? 'target' : 'other'
  const stopDist = input.stopLoss != null ? Math.abs(input.entry - input.stopLoss) : null
  const targetDist = input.takeProfit != null ? Math.abs(input.takeProfit - input.entry) : null

  const used = sorted.filter((b) => b.t + step > entryMs && (exitMs == null || b.t <= exitMs))
  let adverse = 0
  let favourable = 0
  let maeAt: number | null = null
  let mfeAt: number | null = null
  // Where each extreme came from: the entry bar (part of it before the entry) or the exit bar (part after the exit).
  let mae = { entry: false, exit: false }
  let mfe = { entry: false, exit: false }
  let preSide = false
  let n = 0
  for (const b of used) {
    const isEntry = b.t <= entryMs
    const isExit = exitMs != null && b.t + step > exitMs
    if (isEntry && input.skipEntryCandle) continue
    n++
    let adv = long ? input.entry - b.low : b.high - input.entry
    let fav = long ? b.high - input.entry : input.entry - b.low
    if (isEntry) {
      // Beyond a level that did not close the trade: that side of the bar was before the entry.
      if (tradeExit !== 'stop' && tradeExit != null && stopDist != null && adv >= stopDist) {
        adv = 0
        preSide = true
      }
      if (tradeExit !== 'target' && tradeExit != null && targetDist != null && fav >= targetDist) {
        fav = 0
        preSide = true
      }
    }
    if (adv > adverse) {
      adverse = adv
      maeAt = b.t
      mae = { entry: isEntry, exit: isExit }
    }
    if (fav > favourable) {
      favourable = fav
      mfeAt = b.t
      mfe = { entry: isEntry, exit: isExit }
    }
  }
  if (n === 0) return { error: 'Brak świec między wejściem a wyjściem.' }
  if (tradeExit === 'stop' && stopDist != null) adverse = Math.min(adverse, stopDist)
  if (tradeExit === 'target' && targetDist != null) favourable = Math.min(favourable, targetDist)

  const minutes = Math.round(step / 60_000)
  if (preSide) warnings.push('Świeca wejścia sięga poziomu, który nie zamknął transakcji – ta jej część była przed wejściem i nie jest liczona.')
  const precise = minutes <= 1
  const which = (a: boolean, b: boolean) => (a && b ? 'MAE i MFE' : a ? 'MAE' : 'MFE')
  if ((mae.entry || mfe.entry) && !precise)
    warnings.push(`${which(mae.entry, mfe.entry)} ze świecy wejścia (${minutes} min) – jej część mogła być przed wejściem; dokładniej z CSV M1 albo z pominięciem świecy wejścia.`)
  // The exit bar matters only when no level caps that side.
  const maeExit = mae.exit && tradeExit !== 'stop'
  const mfeExit = mfe.exit && tradeExit !== 'target'
  if ((maeExit || mfeExit) && !precise)
    warnings.push(`${which(maeExit, mfeExit)} ze świecy wyjścia (${minutes} min) – jej część mogła być po wyjściu; dokładniej z CSV M1.`)
  const exit = tradeExit === 'stop' ? 'stop' : tradeExit === 'target' ? 'target' : 'end'
  const span = used.filter((b) => !(input.skipEntryCandle && b.t <= entryMs))
  return {
    maePips: -round1(adverse / pip),
    mfePips: round1(favourable / pip),
    exit,
    bars: n,
    barMinutes: minutes,
    from: span[0]!.t,
    to: span[span.length - 1]!.t + step,
    maeAt: adverse > 0 ? maeAt : null,
    mfeAt: favourable > 0 ? mfeAt : null,
    warnings
  }
}

/** The trade's levels for measuring: the first target set, the final exit (the latest one with a time, else the last). */
export function tradeLevels(trade: Trade): {
  direction: 'long' | 'short'
  entry: number | null
  stopLoss: number | null
  takeProfit: number | null
  exitPrice: number | null
  exitTime: string | null
} {
  const exits = trade.exits.filter((e) => e.price != null)
  const timed = exits.filter((e) => e.time).sort((a, b) => (a.time! < b.time! ? -1 : 1))
  const final = timed[timed.length - 1] ?? exits[exits.length - 1] ?? null
  return {
    direction: trade.direction,
    entry: trade.prices.entry,
    stopLoss: trade.prices.stopLoss,
    takeProfit: trade.prices.takeProfit1 ?? trade.prices.takeProfit2,
    exitPrice: trade.status === 'closed' ? (final?.price ?? null) : null,
    exitTime: trade.status === 'closed' ? (final?.time ?? null) : null
  }
}
