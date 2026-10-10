/**
 * EODHD protocol: WebSocket messages, REST paths and response parsing (docs/skaner/rozpoznanie.md). Pure functions;
 * the API token is added by the main process and never passes through here.
 */
import type { Candle, Range } from './types'

export const EODHD_REST_BASE = 'https://eodhd.com/api'
export const EODHD_WS_BASE = 'wss://ws.eodhistoricaldata.com/ws'
/** Symbols per API key, counted over all open connections (also a second computer). */
export const WS_SYMBOL_LIMIT = 50
/** EODHD allows 120 days of 1m bars per request; we ask for less to stay clear of the edge. */
export const INTRADAY_1M_MAX_SECONDS = 100 * 86400
/** API calls charged per intraday request. */
export const INTRADAY_CALL_COST = 5

export type WsMessage =
  | { kind: 'tick'; symbol: string; bid: number; ask: number; t: number }
  | { kind: 'authorized' }
  | { kind: 'auth-failed'; message: string }
  | { kind: 'symbol-limit'; message: string }
  | { kind: 'error'; code: number; message: string }
  | { kind: 'unknown' }

function num(v: unknown): number {
  return typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
}

/**
 * One WebSocket frame. Auth failures arrive after a successful handshake as {"status":403,…} (key `status`), everything
 * else uses `status_code`; an unknown symbol is accepted silently and never ticks.
 */
export function parseWsMessage(text: string): WsMessage {
  let m: unknown
  try {
    m = JSON.parse(text)
  } catch {
    return { kind: 'unknown' }
  }
  if (!m || typeof m !== 'object') return { kind: 'unknown' }
  const o = m as Record<string, unknown>
  if (typeof o.s === 'string') {
    // Forex: a (ask), b (bid); crypto: p (price).
    let bid = num(o.b)
    let ask = num(o.a)
    if (!Number.isFinite(bid) && !Number.isFinite(ask)) bid = ask = num(o.p)
    if (!Number.isFinite(bid)) bid = ask
    if (!Number.isFinite(ask)) ask = bid
    const t = num(o.t)
    if (!(bid > 0) || !(ask > 0) || !Number.isFinite(t)) return { kind: 'unknown' }
    return { kind: 'tick', symbol: o.s, bid: Math.min(bid, ask), ask: Math.max(bid, ask), t }
  }
  const message = typeof o.message === 'string' ? o.message : ''
  if (o.status !== undefined && o.status_code === undefined) {
    const code = num(o.status)
    if (code === 401 || code === 403) return { kind: 'auth-failed', message }
    return { kind: 'error', code, message }
  }
  const code = num(o.status_code)
  if (code === 200) return { kind: 'authorized' }
  if (/symbols? limit/i.test(message)) return { kind: 'symbol-limit', message }
  if (code === 401 || code === 403) return { kind: 'auth-failed', message }
  if (Number.isFinite(code)) return { kind: 'error', code, message }
  return { kind: 'unknown' }
}

export function subscribeMessage(symbols: readonly string[]): string {
  // One message with the whole list as a comma-separated string (a JSON array is rejected with 422).
  return JSON.stringify({ action: 'subscribe', symbols: symbols.join(',') })
}

/** REST path (no token) of 1m bars of [from, to] (Unix seconds). */
export function intradayPath(code: string, from: number, to: number): string {
  return `/intraday/${encodeURIComponent(code)}?interval=1m&from=${Math.floor(from)}&to=${Math.floor(to)}&fmt=json`
}

/** Splits [from, to) into request-sized pieces. */
export function splitRange(r: Range, max = INTRADAY_1M_MAX_SECONDS): Range[] {
  const out: Range[] = []
  for (let a = r.from; a < r.to; a += max) out.push({ from: a, to: Math.min(r.to, a + max) })
  return out
}

export interface ParsedBars {
  candles: Candle[]
  /** Rows dropped: empty fields, non-positive prices, high < low, obvious bad ticks. */
  rejected: number
}

/**
 * Intraday response (array of {timestamp, open, high, low, close}). Rows with nulls or nonsense prices are dropped
 * (EODHD 1h/5m had such rows; 1m is the source we keep), OHLC is made consistent, duplicates removed, sorted.
 */
export function parseIntraday(json: unknown): ParsedBars {
  if (!Array.isArray(json)) return { candles: [], rejected: 0 }
  const byTime = new Map<number, Candle>()
  let rejected = 0
  for (const row of json) {
    const r = row as Record<string, unknown>
    const t = num(r.timestamp)
    const o = num(r.open)
    const c = num(r.close)
    let h = num(r.high)
    let l = num(r.low)
    if (![t, o, h, l, c].every(Number.isFinite) || o <= 0 || c <= 0 || h <= 0 || l <= 0 || h < l) {
      rejected++
      continue
    }
    // A bad tick (low ~0 or a huge spike) is far outside open/close.
    const mid = (o + c) / 2
    if (l < mid * 0.8 || h > mid * 1.25) {
      rejected++
      continue
    }
    h = Math.max(h, o, c)
    l = Math.min(l, o, c)
    byTime.set(t, { t, o, h, l, c })
  }
  const candles = [...byTime.values()].sort((a, b) => a.t - b.t)
  return { candles, rejected }
}

export interface EodhdUser {
  subscriptionType: string | null
  subscriptionMode: string | null
  apiRequests: number | null
  apiRequestsDate: string | null
  dailyRateLimit: number | null
  extraLimit: number | null
  feeds: string[]
}

/** /internal-user without personal data (the response also carries name and e-mail; they are never kept). */
export function parseUser(json: unknown): EodhdUser {
  const o = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>
  const s = (v: unknown) => (typeof v === 'string' ? v : null)
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  return {
    subscriptionType: s(o.subscriptionType),
    subscriptionMode: s(o.subscriptionMode),
    apiRequests: n(o.apiRequests),
    apiRequestsDate: s(o.apiRequestsDate),
    dailyRateLimit: n(o.dailyRateLimit),
    extraLimit: n(o.extraLimit),
    feeds: Array.isArray(o.availableDataFeeds) ? o.availableDataFeeds.filter((f): f is string => typeof f === 'string') : []
  }
}

export interface ExchangeSymbol {
  code: string
  name: string
  type: string
}

export function parseSymbolList(json: unknown): ExchangeSymbol[] {
  if (!Array.isArray(json)) return []
  const out: ExchangeSymbol[] = []
  for (const row of json) {
    const r = row as Record<string, unknown>
    if (typeof r.Code !== 'string' || !r.Code) continue
    out.push({ code: r.Code, name: typeof r.Name === 'string' ? r.Name : '', type: typeof r.Type === 'string' ? r.Type : '' })
  }
  return out
}

/** Replaces every occurrence of the token (logs, error texts). */
export function maskToken(text: string, token: string | null | undefined): string {
  return token ? text.split(token).join('***') : text
}
