import { createTrade } from '@shared/defaults'
import type { Trade } from '@shared/schema'
import { addRecord, useJournal } from '../../store/journal'
import { navigate, toast } from '../../store/ui'

function nowMinuteIso(): string {
  const d = new Date()
  d.setUTCSeconds(0, 0)
  return d.toISOString()
}

/** Create a new trade with sensible defaults (last used pair, direction and model) and open it. */
export function newTrade(kind: 'trade' | 'missed' = 'trade'): string | null {
  const { journal, trades, status } = useJournal.getState()
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
  const trade: Trade = createTrade({
    pair,
    direction: recent?.direction ?? 'long',
    entryTime: nowMinuteIso(),
    status: kind === 'missed' ? 'missed' : 'closed',
    entryModelId: recent?.entryModelId ?? null,
    riskPercent: journal.settings.risk.defaultRiskPercent
  })
  addRecord('trades', trade, { draft: true })
  navigate({ page: 'trade', id: trade.id })
  return trade.id
}
