import { createTrade } from '@shared/defaults'
import { dailyLimitState } from '@shared/calc/validator'
import { tradingDateNy } from '@shared/calc/time'
import type { Trade } from '@shared/schema'
import { computeRows } from '../../store/derived'
import { addRecord, useJournal } from '../../store/journal'
import { navigate, toast } from '../../store/ui'

function nowMinuteIso(): string {
  const d = new Date()
  d.setUTCSeconds(0, 0)
  return d.toISOString()
}

/** Create a new trade with sensible defaults (last used pair, direction and model) and open it. */
export function newTrade(kind: 'trade' | 'missed' = 'trade'): string | null {
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
  if (kind === 'trade') {
    const rows = computeRows(trades, days, journal.settings)
    const limits = dailyLimitState(today, rows.map((r) => ({ status: r.trade.status, tradingDate: r.m.tradingDate, resultR: r.m.resultR })), journal.settings)
    if (limits.lossLimitHit) toast(`Dzienny limit straty osiągnięty (${limits.totalR.toFixed(2)}R). Zapis działa, ale rozważ koniec handlu na dziś.`, 'error', 6000)
    else if (limits.maxTradesHit) toast(`Limit transakcji na dziś (${limits.maxTrades}) osiągnięty.`, 'error', 6000)
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
