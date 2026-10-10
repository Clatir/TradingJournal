/**
 * A local stand-in for EODHD (tests only, synthetic prices – never real EODHD data in the repository): `/api/user`
 * and `/api/intraday/<ticker>?interval=1m&from&to&api_token` with deterministic minute bars, so cached and fetched
 * bars agree and expected values can be computed from the same function.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

const BASE: Record<string, number> = { 'EURUSD.FOREX': 1.15, 'GBPUSD.FOREX': 1.34, 'XAUUSD.FOREX': 4300 }

/** Price at a minute (UTC seconds): slow and fast waves around the ticker's base. */
export function syntheticPrice(ticker: string, sec: number): number {
  const base = BASE[ticker] ?? 1
  const m = sec / 60
  const v = base * (1 + 0.002 * Math.sin(m / 97) + 0.0006 * Math.sin(m / 13) + 0.0002 * Math.sin(m / 3.1))
  return Math.round(v * 1e5) / 1e5
}

export interface SyntheticBar {
  timestamp: number
  gmtoffset: 0
  datetime: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

/** EODHD-shaped 1-minute bars for [fromSec, toSec]. */
export function syntheticBars(ticker: string, fromSec: number, toSec: number): SyntheticBar[] {
  const out: SyntheticBar[] = []
  for (let s = Math.ceil(fromSec / 60) * 60; s <= toSec; s += 60) {
    const open = syntheticPrice(ticker, s)
    const close = syntheticPrice(ticker, s + 60)
    const wick = (BASE[ticker] ?? 1) * 0.00004
    out.push({
      timestamp: s,
      gmtoffset: 0,
      datetime: new Date(s * 1000).toISOString().slice(0, 19).replace('T', ' '),
      open,
      high: Math.round((Math.max(open, close) + wick) * 1e5) / 1e5,
      low: Math.round((Math.min(open, close) - wick) * 1e5) / 1e5,
      close,
      volume: 10
    })
  }
  return out
}

export interface MarketServer {
  url: string
  /** Requests seen: path and query without the key. */
  requests: Array<{ path: string; from: number | null; to: number | null }>
  close(): Promise<void>
}

export async function startMarketServer(opts: { key: string; tickers?: string[] }): Promise<MarketServer> {
  const requests: MarketServer['requests'] = []
  const known = new Set(opts.tickers ?? Object.keys(BASE))
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const u = new URL(req.url ?? '/', 'http://localhost')
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(typeof body === 'string' ? body : JSON.stringify(body))
    }
    const from = u.searchParams.get('from')
    const to = u.searchParams.get('to')
    requests.push({ path: u.pathname, from: from ? Number(from) : null, to: to ? Number(to) : null })
    if (u.searchParams.get('api_token') !== opts.key) return send(401, 'Unauthenticated')
    if (u.pathname === '/api/user') return send(200, { name: 'Test', subscriptionType: 'monthly', apiRequests: requests.length, dailyRateLimit: 100000 })
    const m = /^\/api\/intraday\/(.+)$/.exec(u.pathname)
    if (m) {
      const ticker = decodeURIComponent(m[1]!)
      if (!known.has(ticker)) return send(404, 'Ticker Not Found.')
      return send(200, syntheticBars(ticker, Number(from), Number(to)))
    }
    send(404, 'Not found')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return { url: `http://127.0.0.1:${port}`, requests, close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
}
