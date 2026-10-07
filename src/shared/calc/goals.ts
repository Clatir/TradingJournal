/**
 * Goals and alerts (1.5.0): today's limits (loss in R, number of trades, loss in % of the account = Σ R × risk %),
 * this week's loss limit in R and the targets in R for the ISO week and the calendar month (New York trading dates).
 * Pure; the top bar shows the progress and a new trade asks for confirmation while a limit is broken.
 */
import { DateTime } from 'luxon'
import type { Settings, Trade } from '../schema'
import { dailyLimitState, type DailyLimitState } from './validator'

export interface GoalEntry {
  status: Trade['status']
  tradingDate: string
  resultR: number | null
  riskPercent: number | null
}

export interface GoalState {
  daily: DailyLimitState
  /** Today's result in % of the account (Σ R × risk %; trades without a risk % count with the default one). */
  dailyPercent: number
  dailyLossPercent: number | null
  dailyPercentHit: boolean
  week: { from: string; to: string; totalR: number; lossLimitR: number | null; lossLimitHit: boolean; targetR: number | null; targetReached: boolean }
  month: { from: string; to: string; totalR: number; targetR: number | null; targetReached: boolean }
  /** Broken limits, worded for the reminder (empty = nothing to ask about). */
  alerts: string[]
}

const EPS = 1e-9

export function goalState(date: string, entries: readonly GoalEntry[], settings: Settings): GoalState {
  const daily = dailyLimitState(date, [...entries], settings)
  const g = settings.goals
  const closed = entries.filter((e) => e.status === 'closed' && e.resultR != null)
  const sumR = (from: string, to: string) => closed.filter((e) => e.tradingDate >= from && e.tradingDate <= to).reduce((s, e) => s + (e.resultR as number), 0)

  const dailyPercent = closed
    .filter((e) => e.tradingDate === date)
    .reduce((s, e) => s + (e.resultR as number) * (e.riskPercent ?? settings.risk.defaultRiskPercent), 0)
  const dailyPercentHit = g.dailyLossPercent != null && dailyPercent <= -g.dailyLossPercent + EPS

  const d = DateTime.fromISO(date, { zone: 'UTC' })
  const weekFrom = d.startOf('week').toISODate()!
  const weekTo = d.endOf('week').toISODate()!
  const monthFrom = d.startOf('month').toISODate()!
  const monthTo = d.endOf('month').toISODate()!
  const weekR = sumR(weekFrom, weekTo)
  const monthR = sumR(monthFrom, monthTo)
  const weekLossHit = g.weeklyLossLimitR != null && weekR <= -g.weeklyLossLimitR + EPS

  const alerts: string[] = []
  if (daily.lossLimitHit) alerts.push(`Dzienny limit straty: ${daily.totalR.toFixed(2)}R (limit −${daily.lossLimitR}R).`)
  if (dailyPercentHit) alerts.push(`Dzienny limit straty w % konta: ${dailyPercent.toFixed(2)}% (limit −${g.dailyLossPercent}%).`)
  if (daily.maxTradesHit) alerts.push(`Limit transakcji na dziś: ${daily.trades} z ${daily.maxTrades}.`)
  if (weekLossHit) alerts.push(`Tygodniowy limit straty: ${weekR.toFixed(2)}R (limit −${g.weeklyLossLimitR}R).`)

  return {
    daily,
    dailyPercent,
    dailyLossPercent: g.dailyLossPercent,
    dailyPercentHit,
    week: {
      from: weekFrom,
      to: weekTo,
      totalR: weekR,
      lossLimitR: g.weeklyLossLimitR,
      lossLimitHit: weekLossHit,
      targetR: g.weeklyTargetR,
      targetReached: g.weeklyTargetR != null && weekR >= g.weeklyTargetR - EPS
    },
    month: { from: monthFrom, to: monthTo, totalR: monthR, targetR: g.monthlyTargetR, targetReached: g.monthlyTargetR != null && monthR >= g.monthlyTargetR - EPS },
    alerts
  }
}
