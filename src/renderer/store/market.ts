/**
 * Market data in the renderer (EODHD, 1.8.0): the connection status (never the key), bars through the main process
 * with a small in-session memo, and the background fill of closed trades' market summary (`trade.market`, empty MAE /
 * MFE). Without a key or with fetching switched off, bars already in the data folder (e.g. fetched on the other
 * computer) are still used.
 */
import { useEffect } from 'react'
import { create } from 'zustand'
import { marketStatsFor, needsMarketStats, tradeMarketKey, tradeMarketWindow, withMarketStats } from '@shared/calc/marketStats'
import { marketTicker, type Bar, type MarketBarsResult, type MarketStatus } from '@shared/market'
import type { Settings, Trade } from '@shared/schema'
import { api, errorMessage } from '../lib/api'
import { updateRecord, useJournal } from './journal'

interface MarketState {
  status: MarketStatus | null
  /** A fill run: done / total trades. */
  progress: { done: number; total: number } | null
  lastError: string | null
}

export const useMarket = create<MarketState>(() => ({ status: null, progress: null, lastError: null }))

export async function loadMarketStatus(): Promise<MarketStatus | null> {
  try {
    const status = await api.marketStatus()
    useMarket.setState({ status })
    return status
  } catch {
    return null
  }
}

export async function setMarketKey(key: string | null): Promise<MarketStatus> {
  const status = await api.marketSetKey(key)
  useMarket.setState({ status, lastError: null })
  memo.clear()
  return status
}

export async function setMarketEnabled(enabled: boolean): Promise<MarketStatus> {
  const status = await api.marketSetEnabled(enabled)
  useMarket.setState({ status })
  return status
}

/** Fetching may connect (switched on, a key, not "off"); otherwise only bars already in the folder. */
export function marketOnline(status: MarketStatus | null = useMarket.getState().status): boolean {
  return !!status && status.enabled && status.hasKey && status.source !== 'off'
}

/** Bars per request in this session (the main process has them on disk anyway). */
const memo = new Map<string, Promise<MarketBarsResult>>()
const MEMO_MAX = 40

/** M1 bars of [fromMs, toMs); cache only when not online. Results with missing days are not remembered. */
export function marketBars(ticker: string, fromMs: number, toMs: number): Promise<MarketBarsResult> {
  const offline = !marketOnline()
  const key = `${ticker}|${fromMs}|${toMs}|${offline}`
  const hit = memo.get(key)
  if (hit) return hit
  const p = api.marketBars(ticker, fromMs, toMs, { offline }).catch((e): MarketBarsResult => ({ ok: false, message: errorMessage(e), bars: [], missingDays: [] }))
  memo.set(key, p)
  void p.then((r) => {
    if (!r.ok || r.missingDays.length) memo.delete(key)
  })
  while (memo.size > MEMO_MAX) memo.delete(memo.keys().next().value!)
  return p
}

export function forgetMarketBars(): void {
  memo.clear()
  noData.clear()
}

export const tradeTicker = (t: Pick<Trade, 'pair'>, settings: Pick<Settings, 'pairs'>) => marketTicker(t.pair, settings.pairs)

/** The trade's market summary from the given M1 bars (pip size, margin from the settings). */
export function marketSummary(t: Trade, bars: readonly Bar[], settings: Settings, ticker: string) {
  const pip = settings.pairs.find((p) => p.symbol === t.pair)?.pipSize ?? 0.0001
  return marketStatsFor(t, bars, { ticker, pipSize: pip, marginPips: settings.market.touchMarginPips, now: new Date().toISOString() })
}

let running = false
let again = false
/** Trades without data in this session (offline, not fetched yet): skipped until the trade or the connection changes. */
const noData = new Map<string, string>()

/**
 * Compute the market summary of closed trades that have none (or an outdated one), newest first; `manual` = all of them
 * (the settings button), else at most 300 per run. A fetch error stops the run (shown in the settings).
 */
export async function fillMarketStats(manual = false): Promise<{ filled: number; total: number; error: string | null }> {
  if (running) {
    again = true
    return { filled: 0, total: 0, error: null }
  }
  const { journal, status, trades, drafts } = useJournal.getState()
  if (!journal || !status || status.readOnly || status.isSample) return { filled: 0, total: 0, error: null }
  if (!manual && !journal.settings.market.autoFill) return { filled: 0, total: 0, error: null }
  const online = marketOnline()
  const todo = Object.values(trades)
    .filter((e) => !e.readOnly && !drafts[e.record.id] && needsMarketStats(e.record) && tradeTicker(e.record, journal.settings))
    .filter((e) => manual || noData.get(e.record.id) !== `${tradeMarketKey(e.record)}|${online}`)
    .map((e) => e.record)
    .sort((a, b) => (a.entryTime < b.entryTime ? 1 : -1))
    .slice(0, manual ? undefined : 300)
  if (!todo.length) return { filled: 0, total: 0, error: null }
  running = true
  let filled = 0
  let error: string | null = null
  useMarket.setState({ progress: { done: 0, total: todo.length } })
  try {
    for (const [i, t] of todo.entries()) {
      const settings = useJournal.getState().journal?.settings
      const ticker = settings ? tradeTicker(t, settings) : null
      const win = tradeMarketWindow(t)
      if (!settings || !ticker || !win) continue
      const res = await marketBars(ticker, win.fromMs, win.toMs)
      useMarket.setState({ progress: { done: i + 1, total: todo.length } })
      if (!res.ok) {
        error = res.message
        break
      }
      // No data yet (offline, no key): try again later instead of writing "no bars".
      const key = tradeMarketKey(t)
      if (!res.bars.length && res.missingDays.length) {
        noData.set(t.id, `${key}|${online}`)
        continue
      }
      const summary = marketSummary(t, res.bars, settings, ticker)
      updateRecord('trades', t.id, (cur) => (tradeMarketKey(cur) === key ? withMarketStats(cur, summary) : cur))
      filled++
    }
  } catch (e) {
    error = errorMessage(e)
  } finally {
    running = false
    useMarket.setState({ progress: null, lastError: error })
  }
  if (again && !error) {
    again = false
    void fillMarketStats(false)
  }
  return { filled, total: todo.length, error }
}

/**
 * A while after a journal opens (25 s, ICTJ_MARKET_DELAY_MS in tests) and a few seconds after trades change: fill
 * closed trades' market summary. Status is loaded at start (the settings and the editor read it).
 */
export function useMarketAutoFill(): void {
  const dataDir = useJournal((s) => (s.phase === 'ready' ? (s.status?.dataDir ?? null) : null))
  const delay = useJournal((s) => s.appInfo?.marketDelayMs ?? null)
  useEffect(() => {
    void loadMarketStatus()
  }, [])
  useEffect(() => {
    if (!dataDir || delay == null) return
    forgetMarketBars()
    let ready = false
    let debounce: ReturnType<typeof setTimeout> | undefined
    const start = setTimeout(() => {
      ready = true
      void fillMarketStats(false)
    }, delay)
    const unsub = useJournal.subscribe((s, prev) => {
      if (!ready || s.trades === prev.trades) return
      clearTimeout(debounce)
      debounce = setTimeout(() => void fillMarketStats(false), 4000)
    })
    return () => {
      clearTimeout(start)
      clearTimeout(debounce)
      unsub()
    }
  }, [dataDir, delay])
}
