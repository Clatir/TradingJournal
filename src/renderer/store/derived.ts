import { useMemo } from 'react'
import type { RecordEntry } from '@shared/api'
import { metricsContext, tradeMetrics, type TradeMetrics } from '@shared/calc/trade'
import { dailyLimitState, validateTrade, type DailyLimitState, type ValidationResult } from '@shared/calc/validator'
import { goalState, type GoalEntry, type GoalState } from '@shared/calc/goals'
import { continuationCheck, type ContinuationCheck } from '@shared/calc/continuation'
import { tradingDateNy } from '@shared/calc/time'
import type { DayPlan, DictionaryKey, DictItem, JournalFile, Settings, Trade } from '@shared/schema'
import { useJournal } from './journal'

export interface TradeRow {
  trade: Trade
  relPath: string
  readOnly: boolean
  m: TradeMetrics
  v: ValidationResult
  /** A valid continuation of an earlier closed trade (re-opened the same NY trading day). */
  continuation: boolean
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

let validationCache = new WeakMap<Trade, { day: DayPlan | null; chain: readonly Trade[]; v: ValidationResult }>()
let validationSettings: Settings | null = null

export function validationFor(trade: Trade, m: TradeMetrics, settings: Settings, day: DayPlan | null, continuation: ContinuationCheck | null = null): ValidationResult {
  if (settings !== validationSettings) {
    validationCache = new WeakMap()
    validationSettings = settings
  }
  // A re-opened trade depends on the trades it continues as well.
  const chain = continuation?.chain ?? []
  const hit = validationCache.get(trade)
  if (hit && hit.day === day && hit.chain.length === chain.length && hit.chain.every((t, i) => t === chain[i])) return hit.v
  const v = validateTrade(trade, m, settings, day, continuation)
  validationCache.set(trade, { day, chain, v })
  return v
}

/** Continuation check of a trade against the journal's trades (by id). */
export function continuationFor(trade: Trade, trades: Record<string, RecordEntry<Trade>>, settings: Settings): ContinuationCheck | null {
  return trade.continuationOf ? continuationCheck(trade, (id) => trades[id]?.record, settings.killzones) : null
}

/** Rows as entries for limits and goals. */
export function goalEntries(rows: readonly TradeRow[]): GoalEntry[] {
  return rows.map((r) => ({ status: r.trade.status, tradingDate: r.m.tradingDate, resultR: r.m.resultR, riskPercent: r.trade.riskPercent, continuation: r.continuation }))
}

let dayIndexCache: { days: unknown; index: Map<string, DayPlan> } | null = null

export function dayIndex(days: Record<string, RecordEntry<DayPlan>>): Map<string, DayPlan> {
  if (dayIndexCache && dayIndexCache.days === days) return dayIndexCache.index
  const index = new Map<string, DayPlan>()
  for (const e of Object.values(days)) index.set(e.record.date, e.record)
  dayIndexCache = { days, index }
  return index
}

let rowsCache: { trades: unknown; days: unknown; settings: unknown; rows: TradeRow[] } | null = null

export function computeRows(trades: Record<string, RecordEntry<Trade>>, days: Record<string, RecordEntry<DayPlan>>, settings: Settings): TradeRow[] {
  if (rowsCache && rowsCache.trades === trades && rowsCache.days === days && rowsCache.settings === settings) return rowsCache.rows
  const index = dayIndex(days)
  const rows = Object.values(trades)
    .map((e) => {
      const m = metricsFor(e.record, settings)
      const c = continuationFor(e.record, trades, settings)
      return { trade: e.record, relPath: e.relPath, readOnly: e.readOnly, m, v: validationFor(e.record, m, settings, index.get(m.tradingDate) ?? null, c), continuation: !!c?.ok }
    })
    .sort((a, b) => (a.trade.entryTime < b.trade.entryTime ? 1 : a.trade.entryTime > b.trade.entryTime ? -1 : 0))
  rowsCache = { trades, days, settings, rows }
  return rows
}

export function useSettings(): Settings | null {
  return useJournal((s) => s.journal?.settings ?? null)
}

export function useTradeRows(): TradeRow[] {
  const trades = useJournal((s) => s.trades)
  const days = useJournal((s) => s.days)
  const settings = useSettings()
  return useMemo(() => (settings ? computeRows(trades, days, settings) : []), [trades, days, settings])
}

export function useDayPlan(date: string | null): RecordEntry<DayPlan> | null {
  const days = useJournal((s) => s.days)
  return useMemo(() => (date ? (Object.values(days).find((e) => e.record.date === date) ?? null) : null), [days, date])
}

/** Today's limits, this week's and this month's goals (New York trading dates). */
export function useGoals(nowIso: string): GoalState | null {
  const rows = useTradeRows()
  const settings = useSettings()
  const date = tradingDateNy(nowIso)
  return useMemo(
    () =>
      settings
        ? goalState(date, goalEntries(rows), settings)
        : null,
    [rows, settings, date]
  )
}

/** Today's (New York trading date) totals against the daily limits. */
export function useDailyLimits(nowIso: string): DailyLimitState | null {
  const rows = useTradeRows()
  const settings = useSettings()
  const date = tradingDateNy(nowIso)
  return useMemo(
    () => (settings ? dailyLimitState(date, goalEntries(rows), settings) : null),
    [rows, settings, date]
  )
}

export function dictName(journal: JournalFile | null, key: DictionaryKey, id: string | null | undefined): string {
  if (!id || !journal) return ''
  return journal.dictionaries[key].find((d) => d.id === id)?.name ?? '?'
}

export function activeItems(items: DictItem[], keep: Array<string | null | undefined> = []): DictItem[] {
  return items.filter((d) => !d.archived || keep.includes(d.id))
}
