import type { Killzone, PairConfig, Settings } from '../schema/journal'
import type { Trade } from '../schema/trade'
import { rateFor } from '../fx'
import { historicalRate, transactionDate } from '../fxHistory'
import { killzonesAt, primaryKillzone, tradingDateNy } from './time'

export const DEFAULT_PIP_SIZE = 0.0001

const EPS = 1e-9

export function round(value: number, decimals: number): number {
  const f = 10 ** decimals
  return Math.round((value + Math.sign(value) * EPS) * f) / f
}

export function pipSizeFor(pair: string, pairs: readonly PairConfig[]): number {
  return pairs.find((p) => p.symbol === pair)?.pipSize ?? DEFAULT_PIP_SIZE
}

/** Signed price distance expressed in pips. */
export function pipsBetween(from: number, to: number, pipSize: number): number {
  return (to - from) / pipSize
}

export function directionSign(direction: Trade['direction']): 1 | -1 {
  return direction === 'long' ? 1 : -1
}

/** Reward-to-risk ratio for a target, using absolute distances. null if risk is zero/undefined. */
export function riskReward(entry: number | null, stop: number | null, target: number | null): number | null {
  if (entry == null || stop == null || target == null) return null
  const risk = Math.abs(entry - stop)
  if (risk < EPS) return null
  return Math.abs(target - entry) / risk
}

/** R multiple of a single exit price. */
export function exitR(direction: Trade['direction'], entry: number, stop: number, exitPrice: number): number | null {
  const risk = Math.abs(entry - stop)
  if (risk < EPS) return null
  return (directionSign(direction) * (exitPrice - entry)) / risk
}

export type Outcome = 'win' | 'loss' | 'breakeven'

export function classifyOutcome(r: number, breakevenThresholdR: number): Outcome {
  if (Math.abs(r) <= breakevenThresholdR + EPS) return 'breakeven'
  return r > 0 ? 'win' : 'loss'
}

export interface TradeMetrics {
  pipSize: number
  tradingDate: string
  riskPips: number | null
  rrTp1: number | null
  rrTp2: number | null
  /** Sum of exit percentages that have a price. */
  closedPercent: number
  /** Percentages do not sum to 100 on a closed trade (result normalized to the closed part). */
  percentMismatch: boolean
  /** Final R (closed trades), hypothetical R (missed trades with an outcome), otherwise realized-so-far or null. */
  resultR: number | null
  resultPips: number | null
  /** true when resultR counts toward performance statistics (closed trade with a result). */
  countsInStats: boolean
  outcome: Outcome | null
  maeR: number | null
  mfeR: number | null
  killzoneIds: string[]
  killzoneNames: string[]
  /** Last exit time, if any. */
  exitTime: string | null
  /** Amount in account currency (override or R x riskAmount, converted from `amountCurrency` when it differs). */
  pnlAmount: number | null
  /** The same amount in the trade's own currency (as typed). */
  pnlAmountOwn: number | null
  /** Currency of the trade's amounts (risk, override); null without amounts or without the conversion context. */
  amountCurrency: string | null
  /** NBP table date used to convert `pnlAmountOwn` to the account currency; null = today's rate (or no conversion). */
  amountRateDate: string | null
}

export interface MetricsContext {
  pairs: readonly PairConfig[]
  killzones: readonly Killzone[]
  breakevenThresholdR: number
  /** Without it amounts are not converted (they are taken as in the account currency). */
  amounts?: {
    accountCurrency: string
    /** Currency of amounts saved without one (risk.legacyAmountCurrency, else the account currency). */
    defaultCurrency: string
    /**
     * Units of the account currency per 1 unit of `from` for a transaction on `date` (Warsaw calendar): the NBP table
     * of the day before when stored (`tableDate`), else today's rate (hand-entered or NBP); null when unknown.
     */
    rate: (from: string, date: string) => { rate: number; tableDate: string | null } | null
  }
}

export function metricsContext(settings: Settings): MetricsContext {
  const account = settings.risk.accountCurrency
  return {
    pairs: settings.pairs,
    killzones: settings.killzones,
    breakevenThresholdR: settings.stats.breakevenThresholdR,
    amounts: {
      accountCurrency: account,
      defaultCurrency: settings.risk.legacyAmountCurrency ?? account,
      rate: (from, date) => {
        const historical = historicalRate(from, account, date, settings)
        if (historical) return historical
        const today = rateFor(from, account, settings)
        return today ? { rate: today.rate, tableDate: null } : null
      }
    }
  }
}

export function resolveKillzones(trade: Trade, killzones: readonly Killzone[]): Killzone[] {
  if (trade.killzoneOverride === 'none') return []
  if (trade.killzoneOverride) {
    const kz = killzones.find((k) => k.id === trade.killzoneOverride)
    return kz ? [kz] : []
  }
  return killzonesAt(trade.entryTime, killzones)
}

export function tradeMetrics(trade: Trade, ctx: MetricsContext): TradeMetrics {
  const pipSize = pipSizeFor(trade.pair, ctx.pairs)
  const { entry, stopLoss, takeProfit1, takeProfit2 } = trade.prices
  const riskDistance = entry != null && stopLoss != null ? Math.abs(entry - stopLoss) : null
  const riskPips = riskDistance != null ? riskDistance / pipSize : null
  const hasRisk = riskDistance != null && riskDistance > EPS

  const priced = trade.exits.filter((x) => x.price != null && x.percent > 0)
  const closedPercent = priced.reduce((s, x) => s + x.percent, 0)

  let resultR: number | null = null
  let resultPips: number | null = null
  let percentMismatch = false

  if (trade.status === 'missed') {
    const o = trade.missed.hypotheticalOutcome
    if (o === 'sl') resultR = hasRisk ? -1 : null
    else if (o === 'none') resultR = 0
    else if (o === 'tp1') resultR = riskReward(entry, stopLoss, takeProfit1)
    else if (o === 'tp2') resultR = riskReward(entry, stopLoss, takeProfit2)
    if (resultR != null && riskPips != null) resultPips = resultR * riskPips
  } else if (entry != null && closedPercent > 0) {
    const weight = trade.status === 'closed' ? closedPercent : 100
    percentMismatch = trade.status === 'closed' && Math.abs(closedPercent - 100) > 0.01
    let pips = 0
    let r = 0
    for (const x of priced) {
      const share = x.percent / weight
      pips += share * directionSign(trade.direction) * pipsBetween(entry, x.price as number, pipSize)
      if (hasRisk) r += share * (exitR(trade.direction, entry, stopLoss as number, x.price as number) ?? 0)
    }
    resultPips = pips
    resultR = hasRisk ? r : null
  }

  const countsInStats = trade.status === 'closed' && resultR != null
  const outcome = resultR != null && trade.status !== 'open' ? classifyOutcome(resultR, ctx.breakevenThresholdR) : null
  const kzs = resolveKillzones(trade, ctx.killzones)
  const exitTimes = trade.exits.map((x) => x.time).filter((t): t is string => !!t).sort()
  const pnlAmountOwn =
    trade.pnlAmountOverride ?? (resultR != null && trade.riskAmount != null && countsInStats ? resultR * trade.riskAmount : null)
  // Amounts typed in another account currency (before a currency change) are converted at today's rate.
  const hasAmounts = trade.riskAmount != null || trade.pnlAmountOverride != null
  const amountCurrency = trade.amountCurrency ?? (hasAmounts ? (ctx.amounts?.defaultCurrency ?? null) : null)
  let pnlAmount = pnlAmountOwn
  let amountRateDate: string | null = null
  if (pnlAmountOwn != null && ctx.amounts && amountCurrency && amountCurrency !== ctx.amounts.accountCurrency) {
    // At the NBP table of the day before the closing when it is stored, otherwise at today's rate.
    const rate = ctx.amounts.rate(amountCurrency, transactionDate(trade))
    pnlAmount = rate != null ? pnlAmountOwn * rate.rate : null
    amountRateDate = rate?.tableDate ?? null
  }

  return {
    pipSize,
    tradingDate: tradingDateNy(trade.entryTime),
    riskPips,
    rrTp1: riskReward(entry, stopLoss, takeProfit1),
    rrTp2: riskReward(entry, stopLoss, takeProfit2),
    closedPercent,
    percentMismatch,
    resultR,
    resultPips,
    countsInStats,
    outcome,
    maeR: hasRisk && trade.maePips != null && riskPips ? trade.maePips / riskPips : null,
    mfeR: hasRisk && trade.mfePips != null && riskPips ? trade.mfePips / riskPips : null,
    killzoneIds: kzs.map((k) => k.id),
    killzoneNames: kzs.map((k) => k.name),
    exitTime: exitTimes.at(-1) ?? null,
    pnlAmount,
    pnlAmountOwn,
    amountCurrency,
    amountRateDate
  }
}

export { primaryKillzone }
