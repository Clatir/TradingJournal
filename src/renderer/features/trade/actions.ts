import { createTrade } from '@shared/defaults'
import { goalState } from '@shared/calc/goals'
import { tradingDateNy } from '@shared/calc/time'
import type { Trade } from '@shared/schema'
import { continuationFields } from '@shared/calc/continuation'
import { computeRows, goalEntries } from '../../store/derived'
import { addRecord, useJournal } from '../../store/journal'
import { navigate, toast } from '../../store/ui'
import { askBeyondLimits } from '../goals/LimitPrompt'

function nowMinuteIso(): string {
  const d = new Date()
  d.setUTCSeconds(0, 0)
  return d.toISOString()
}

/**
 * Create a new trade with sensible defaults (last used pair, direction and model) and open it. While a limit is broken
 * (daily loss / % / trades, weekly loss) it first asks for confirmation (unless switched off in the goals).
 */
export function newTrade(kind: 'trade' | 'missed' = 'trade', opts: { confirmed?: boolean } = {}): string | null {
  const { journal, trades, days, status } = useJournal.getState()
  if (!journal) return null
  if (status?.readOnly) {
    toast(status.readOnlyReason ?? 'Folder tylko do odczytu', 'error')
    return null
  }
  const recent = Object.values(trades)
    .map((e) => e.record)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0]
  const pairs = journal.settings.pairs.filter((p) => !p.archived)
  const pair = recent && pairs.some((p) => p.symbol === recent.pair) ? recent.pair : (pairs.find((p) => p.symbol === 'EURUSD') ?? pairs[0])?.symbol ?? 'EURUSD'
  const entryTime = nowMinuteIso()
  const today = tradingDateNy(entryTime)
  // Direction defaults to today's HTF bias for the pair (from the day plan).
  const plan = Object.values(days).find((e) => e.record.date === today)?.record
  const bias = plan?.pairs.find((p) => p.pair === pair)?.bias[journal.settings.rules.htfBias.timeframe].direction
  const direction: Trade['direction'] = bias === 'bullish' ? 'long' : bias === 'bearish' ? 'short' : (recent?.direction ?? 'long')
  if (kind === 'trade' && !opts.confirmed) {
    const rows = computeRows(trades, days, journal.settings)
    const goals = goalState(today, goalEntries(rows), journal.settings)
    if (goals.alerts.length) {
      if (journal.settings.goals.ask) {
        askBeyondLimits(goals.alerts, () => newTrade(kind, { confirmed: true }))
        return null
      }
      toast(`${goals.alerts[0]} Zapis działa, ale rozważ koniec handlu na dziś.`, 'error', 6000)
    }
  }
  const trade: Trade = createTrade({
    pair,
    direction,
    entryTime,
    status: kind === 'missed' ? 'missed' : 'closed',
    entryModelId: recent?.entryModelId ?? null,
    riskPercent: journal.settings.risk.defaultRiskPercent
  })
  addRecord('trades', trade, { draft: true })
  navigate({ page: 'trade', id: trade.id })
  return trade.id
}

/**
 * Re-open a closed trade (the close was a mistake): a new entry continuing it – the same pair, direction, ICT context,
 * SL and targets, entered now. Within the New York trading day of the close the killzone rule follows the first entry
 * and the re-entry is not another trade for the daily limit. Loss limits still ask first.
 */
export function reopenTrade(parentId: string, opts: { confirmed?: boolean } = {}): string | null {
  const { journal, trades, days, status } = useJournal.getState()
  const parent = trades[parentId]?.record
  if (!journal || !parent) return null
  if (status?.readOnly) {
    toast(status.readOnlyReason ?? 'Folder tylko do odczytu', 'error')
    return null
  }
  const entryTime = nowMinuteIso()
  if (!opts.confirmed) {
    const goals = goalState(tradingDateNy(entryTime), goalEntries(computeRows(trades, days, journal.settings)), journal.settings, { reopening: true })
    if (goals.alerts.length) {
      if (journal.settings.goals.ask) {
        askBeyondLimits(goals.alerts, () => reopenTrade(parentId, { confirmed: true }))
        return null
      }
      toast(`${goals.alerts[0]} Zapis działa, ale rozważ koniec handlu na dziś.`, 'error', 6000)
    }
  }
  const trade: Trade = createTrade({
    ...continuationFields(parent),
    entryTime,
    status: 'closed',
    prices: { entry: null, stopLoss: parent.prices.stopLoss, takeProfit1: parent.prices.takeProfit1, takeProfit2: parent.prices.takeProfit2 },
    lots: parent.lots
  })
  addRecord('trades', trade, { draft: true })
  navigate({ page: 'trade', id: trade.id })
  return trade.id
}
