/**
 * Local stand-in for EODHD: REST (/api/intraday, /api/internal-user, /api/exchange-symbol-list) and the forex
 * WebSocket (/ws/forex) with EODHD's quirks: auth failure as {"status":403} after the handshake, "Authorized" ack,
 * one subscribe message with a comma-separated list, "Symbols limit reached" over the limit, silent unknown symbols.
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { WebSocketServer, type WebSocket } from 'ws'

export interface FakeBar {
  timestamp: number
  open: number | null
  high: number | null
  low: number | null
  close: number | null
}

export interface FakeEodhd {
  /** REST base (…/api) and WebSocket base (…/ws). */
  restBase: string
  wsBase: string
  token: string
  bars: Map<string, FakeBar[]>
  /** Status codes forced for REST paths starting with a prefix, e.g. ['/api/intraday/BAD.FOREX', 500]. */
  failures: Map<string, number>
  requests: string[]
  subscriptions: string[]
  symbolLimit: number
  /** Sends a tick to sockets subscribed to `symbol`. */
  tick(symbol: string, bid: number, ask: number, t: number): void
  /** Closes all stream connections (as a network drop would). */
  dropConnections(): void
  connections(): number
  close(): Promise<void>
}

export async function startFakeEodhd(token = 'test-token-123'): Promise<FakeEodhd> {
  const bars = new Map<string, FakeBar[]>()
  const failures = new Map<string, number>()
  const requests: string[] = []
  const subscriptions: string[] = []
  const subscribed = new Map<WebSocket, Set<string>>()
  const fake = { symbolLimit: 50 } as FakeEodhd

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    requests.push(`${url.pathname}${url.search.replace(token, '***')}`)
    for (const [prefix, status] of failures) {
      if (url.pathname.startsWith(prefix)) {
        res.writeHead(status).end('error')
        return
      }
    }
    if (url.searchParams.get('api_token') !== token) {
      res.writeHead(401).end('Unauthenticated')
      return
    }
    const json = (body: unknown) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    const intraday = /^\/api\/intraday\/([^/]+)$/.exec(url.pathname)
    if (intraday) {
      const list = bars.get(decodeURIComponent(intraday[1]!))
      if (!list) {
        res.writeHead(404).end('Ticker Not Found.')
        return
      }
      const from = Number(url.searchParams.get('from'))
      const to = Number(url.searchParams.get('to'))
      json(list.filter((b) => b.timestamp >= from && b.timestamp <= to).map((b) => ({ ...b, gmtoffset: 0, volume: 100 })))
      return
    }
    if (url.pathname === '/api/internal-user') {
      json({ name: 'Test User', email: 'user@example.com', subscriptionType: 'monthly', subscriptionMode: 'paid', apiRequests: 42, apiRequestsDate: '2026-10-11', dailyRateLimit: 100000, extraLimit: 500, availableDataFeeds: ['Intraday Data API', 'Real-time Data via WebSockets'] })
      return
    }
    if (url.pathname === '/api/exchange-symbol-list/FOREX') {
      json([
        { Code: 'EURUSD', Name: 'EUR/USD', Type: 'Currency' },
        { Code: 'XAUUSD', Name: 'Gold Spot US Dollar', Type: 'Currency' },
        { Code: 'GBPUSD', Name: 'UK Pound Sterling/US Dollar FX Spot Rate', Type: 'Currency' }
      ])
      return
    }
    res.writeHead(404).end('not found')
  })

  const wss = new WebSocketServer({ server, path: '/ws/forex' })
  wss.on('connection', (socket, req) => {
    const url = new URL(req.url ?? '/', 'http://x')
    if (url.searchParams.get('api_token') !== token) {
      socket.send(JSON.stringify({ status: 403, message: 'Server error' }))
      return
    }
    socket.send(JSON.stringify({ status_code: 200, message: 'Authorized' }))
    subscribed.set(socket, new Set())
    socket.on('message', (data) => {
      const text = String(data)
      subscriptions.push(text)
      let msg: { action?: unknown; symbols?: unknown }
      try {
        msg = JSON.parse(text) as typeof msg
      } catch {
        return
      }
      if (typeof msg.action !== 'string' || typeof msg.symbols !== 'string') {
        socket.send(JSON.stringify({ status_code: 422, message: 'Action and symbols should be string' }))
        return
      }
      const list = msg.symbols.split(',').filter(Boolean)
      const total = [...subscribed.values()].reduce((n, s) => n + s.size, 0)
      if (msg.action === 'subscribe' && total + list.length > fake.symbolLimit) {
        socket.send(JSON.stringify({ status_code: 422, message: 'Symbols limit reached' }))
        return
      }
      const set = subscribed.get(socket)!
      for (const s of list) {
        if (msg.action === 'subscribe') set.add(s)
        else set.delete(s)
      }
    })
    socket.on('close', () => subscribed.delete(socket))
  })

  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port
  Object.assign(fake, {
    restBase: `http://127.0.0.1:${port}/api`,
    wsBase: `ws://127.0.0.1:${port}/ws`,
    token,
    bars,
    failures,
    requests,
    subscriptions,
    tick(symbol: string, bid: number, ask: number, t: number) {
      for (const [socket, set] of subscribed) if (set.has(symbol)) socket.send(JSON.stringify({ s: symbol, a: ask, b: bid, dc: '0.1', dd: '0.001', ppms: false, t }))
    },
    dropConnections() {
      for (const socket of wss.clients) socket.terminate()
    },
    connections() {
      return [...wss.clients].filter((c) => c.readyState === c.OPEN).length
    },
    close() {
      for (const socket of wss.clients) socket.terminate()
      return new Promise<void>((r) => wss.close(() => server.close(() => r())))
    }
  })
  return fake
}
