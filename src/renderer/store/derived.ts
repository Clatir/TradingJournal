import { useMemo } from 'react'
import type { RecordEntry } from '@shared/api'
import { metricsContext, tradeMetrics, type TradeMetrics } from '@shared/calc/trade'
import type { DictionaryKey, DictItem, JournalFile, Settings, Trade } from '@shared/schema'
import { useJournal } from './journal'

export interface TradeRow {
  trade: Trade
  relPath: string
  readOnly: boolean
  m: TradeMetrics
}

let metricsCache = new WeakMap<Trade, TradeMetrics>()
let metricsSettings: Settings | null = null

export function metricsFor(trade: Trade, settings: Settings): TradeMetrics {
  if (settings !== metricsSettings) {
    metricsCache = new WeakMap()
    metricsSettings = settings
  }
  let m = metricsCache.get(trade)
  if (!m) {
    m = tradeMetrics(trade, metricsContext(settings))
    metricsCache.set(trade, m)
  }
  return m
}

let rowsCache: { trades: unknown; settings: unknown; rows: TradeRow[] } | null = null

export function computeRows(trades: Record<string, RecordEntry<Trade>>, settings: Settings): TradeRow[] {
  if (rowsCache && rowsCache.trades === trades && rowsCache.settings === settings) return rowsCache.rows
  const rows = Object.values(trades)
    .map((e) => ({ trade: e.record, relPath: e.relPath, readOnly: e.readOnly, m: metricsFor(e.record, settings) }))
    .sort((a, b) => (a.trade.entryTime < b.trade.entryTime ? 1 : a.trade.entryTime > b.trade.entryTime ? -1 : 0))
  rowsCache = { trades, settings, rows }
  return rows
}

export function useSettings(): Settings | null {
  return useJournal((s) => s.journal?.settings ?? null)
}

export function useTradeRows(): TradeRow[] {
  const trades = useJournal((s) => s.trades)
  const settings = useSettings()
  return useMemo(() => (settings ? computeRows(trades, settings) : []), [trades, settings])
}

export function dictName(journal: JournalFile | null, key: DictionaryKey, id: string | null | undefined): string {
  if (!id || !journal) return ''
  return journal.dictionaries[key].find((d) => d.id === id)?.name ?? '?'
}

export function activeItems(items: DictItem[], keep: Array<string | null | undefined> = []): DictItem[] {
  return items.filter((d) => !d.archived || keep.includes(d.id))
}
