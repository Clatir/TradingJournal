import { createTrade } from '@shared/defaults'
import { goalState } from '@shared/calc/goals'
import { tradingDateNy } from '@shared/calc/time'
import type { Trade } from '@shared/schema'
import { computeRows } from '../../store/derived'
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
    const goals = goalState(
      today,
      rows.map((r) => ({ status: r.trade.status, tradingDate: r.m.tradingDate, resultR: r.m.resultR, riskPercent: r.trade.riskPercent })),
      journal.settings
    )
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
