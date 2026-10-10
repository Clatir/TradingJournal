/**
 * EODHD forex WebSocket (main process). One connection, one subscribe message with the whole list after the server's
 * "Authorized"; subscriptions are not kept by the server, so every reconnect subscribes again. Reconnects with a growing
 * delay; a silent stream during market hours is reconnected too (with a growing silence threshold, so a quiet holiday
 * does not cause a reconnect every minute). A rejected key stops retrying; "Symbols limit reached" (the 50 symbols are
 * shared by all connections of the key, e.g. a second computer) retries after a few minutes.
 */
import { maskToken, parseWsMessage, subscribeMessage } from '@shared/scanner/eodhd'
import type { Tick } from '@shared/scanner/m1'
import { isMarketOpen } from '@shared/scanner/time'
import type { StreamState, StreamStatus } from '@shared/scanner/api'

export type { StreamState, StreamStatus }

export interface WsLike {
  send(data: string): void
  close(code?: number, reason?: string): void
  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (ev: { data?: unknown; message?: string }) => void): void
}

export interface StreamOptions {
  /** Stream address without the token, e.g. wss://ws.eodhistoricaldata.com/ws/forex. */
  url: string
  token: () => string | null
  onTick: (tick: Tick, nowMs: number) => void
  onStatus?: (status: StreamStatus) => void
  create?: (url: string) => WsLike
  now?: () => number
  marketOpen?: (sec: number) => boolean
  authTimeoutMs?: number
  /** Silence (no live tick) during market hours that triggers a reconnect; doubles after each such reconnect. */
  silenceMs?: number
  maxSilenceMs?: number
  backoffMs?: readonly number[]
  limitRetryMs?: number
  /** A connection live this long resets the backoff. */
  stableMs?: number
}

const DEFAULT_BACKOFF = [1000, 2000, 4000, 8000, 16000, 32000, 60000]
/** A tick older than this is the snapshot of the last quote, not a live price. */
const LIVE_TICK_AGE_MS = 120_000

export class FxStream {
  private ws: WsLike | null = null
  private symbols: string[] = []
  private wanted = false
  private attempt = 0
  private silenceStrikes = 0
  private timers = new Set<ReturnType<typeof setTimeout>>()
  private authTimer: ReturnType<typeof setTimeout> | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private st: StreamStatus

  constructor(private readonly o: StreamOptions) {
    this.st = {
      state: 'off',
      since: this.now(),
      connectedAt: null,
      lastMessageAt: null,
      lastLiveTickAt: null,
      reconnects: 0,
      symbols: [],
      message: null,
      nextRetryAt: null
    }
  }

  private now(): number {
    return (this.o.now ?? Date.now)()
  }

  status(): StreamStatus {
    return { ...this.st, symbols: [...this.symbols] }
  }

  private set(patch: Partial<StreamStatus>): void {
    if (patch.state && patch.state !== this.st.state) patch.since = this.now()
    this.st = { ...this.st, ...patch }
    this.o.onStatus?.(this.status())
  }

  private mask(text: string): string {
    const token = this.o.token()
    return maskToken(maskToken(text, token), token ? encodeURIComponent(token) : null)
  }

  start(symbols: readonly string[]): void {
    this.symbols = [...symbols]
    this.wanted = true
    this.attempt = 0
    this.connect()
  }

  /** New symbol list: reconnects only when it changed. */
  setSymbols(symbols: readonly string[]): void {
    const same = symbols.length === this.symbols.length && symbols.every((s, i) => s === this.symbols[i])
    this.symbols = [...symbols]
    if (!same && this.wanted) this.reconnectNow('zmiana listy symboli')
  }

  stop(): void {
    this.wanted = false
    this.clearTimers()
    this.dropSocket()
    this.set({ state: 'off', nextRetryAt: null, message: null })
  }

  /** E.g. after the computer wakes up or the key changes. */
  reconnectNow(reason: string): void {
    if (!this.wanted) return
    this.clearTimers()
    this.dropSocket()
    this.attempt = 0
    this.set({ message: reason })
    this.connect()
  }

  /** Call every few seconds: reconnects a stream that went silent during market hours. */
  checkHealth(): void {
    if (this.st.state !== 'live') return
    const now = this.now()
    if (!(this.o.marketOpen ?? isMarketOpen)(Math.floor(now / 1000))) return
    const base = this.o.silenceMs ?? 90_000
    const limit = Math.min(base * 2 ** this.silenceStrikes, this.o.maxSilenceMs ?? 30 * 60_000)
    const last = Math.max(this.st.lastLiveTickAt ?? 0, this.st.connectedAt ?? 0)
    if (now - last > limit) {
      this.silenceStrikes++
      this.reconnectNow('cisza na strumieniu w godzinach rynku')
    }
  }

  private clearTimers(): void {
    for (const t of this.timers) clearTimeout(t)
    this.timers.clear()
    this.authTimer = null
    this.retryTimer = null
  }

  private timer(ms: number, fn: () => void): ReturnType<typeof setTimeout> {
    const t = setTimeout(() => {
      this.timers.delete(t)
      fn()
    }, ms)
    this.timers.add(t)
    return t
  }

  private dropSocket(): void {
    const ws = this.ws
    this.ws = null
    if (ws) {
      try {
        ws.close()
      } catch {
        // Already closed.
      }
    }
  }

  private connect(): void {
    if (!this.wanted) return
    const token = this.o.token()
    if (!token) {
      this.set({ state: 'no-key', message: 'Brak klucza API EODHD (Ustawienia → Skaner).', nextRetryAt: null })
      return
    }
    this.set({ state: this.attempt > 0 ? 'reconnecting' : 'connecting', nextRetryAt: null })
    let ws: WsLike
    try {
      const create = this.o.create ?? ((url: string) => new WebSocket(url) as unknown as WsLike)
      ws = create(`${this.o.url}?api_token=${encodeURIComponent(token)}`)
    } catch (e) {
      this.scheduleRetry(`nie udało się otworzyć połączenia: ${this.mask(e instanceof Error ? e.message : String(e))}`)
      return
    }
    this.ws = ws
    this.authTimer = this.timer(this.o.authTimeoutMs ?? 10_000, () => {
      if (this.ws !== ws) return
      this.dropSocket()
      this.scheduleRetry('serwer nie potwierdził autoryzacji')
    })
    ws.addEventListener('message', (ev) => {
      if (this.ws !== ws) return
      this.onMessage(ws, typeof ev.data === 'string' ? ev.data : String(ev.data ?? ''))
    })
    ws.addEventListener('error', (ev) => {
      if (this.ws !== ws) return
      this.set({ message: this.mask(`błąd połączenia${ev.message ? `: ${ev.message}` : ''}`) })
    })
    ws.addEventListener('close', () => {
      if (this.ws !== ws) return // closed on purpose
      this.ws = null
      this.scheduleRetry(this.st.message && this.st.state !== 'live' ? this.st.message : 'połączenie zerwane')
    })
  }

  private onMessage(ws: WsLike, text: string): void {
    const now = this.now()
    this.st.lastMessageAt = now
    const m = parseWsMessage(text)
    switch (m.kind) {
      case 'tick': {
        if (m.t >= now - LIVE_TICK_AGE_MS) {
          this.st.lastLiveTickAt = now
          this.silenceStrikes = 0
        }
        this.o.onTick({ symbol: m.symbol, bid: m.bid, ask: m.ask, t: m.t }, now)
        return
      }
      case 'authorized': {
        if (this.authTimer) {
          clearTimeout(this.authTimer)
          this.timers.delete(this.authTimer)
          this.authTimer = null
        }
        if (this.symbols.length) ws.send(subscribeMessage(this.symbols))
        this.set({ state: 'live', connectedAt: now, message: null })
        const stableFrom = this.attempt
        this.timer(this.o.stableMs ?? 60_000, () => {
          if (this.ws === ws && this.attempt === stableFrom) this.attempt = 0
        })
        return
      }
      case 'auth-failed':
        this.clearTimers()
        this.dropSocket()
        this.set({ state: 'auth-failed', message: 'EODHD odrzucił klucz API. Sprawdź klucz w Ustawienia → Skaner.', nextRetryAt: null })
        return
      case 'symbol-limit': {
        this.clearTimers()
        this.dropSocket()
        const wait = this.o.limitRetryMs ?? 5 * 60_000
        this.set({
          state: 'symbol-limit',
          message: 'Limit 50 symboli na klucz API wyczerpany – zwykle skaner działa na drugim komputerze. Ponowię za kilka minut.',
          nextRetryAt: now + wait
        })
        this.retryTimer = this.timer(wait, () => {
          this.retryTimer = null
          this.connect()
        })
        return
      }
      case 'error':
        this.set({ message: this.mask(`EODHD: ${m.message || `błąd ${m.code}`}`) })
        return
      default:
        return
    }
  }

  private scheduleRetry(reason: string): void {
    if (!this.wanted || this.retryTimer) return
    const backoff = this.o.backoffMs ?? DEFAULT_BACKOFF
    const delay = backoff[Math.min(this.attempt, backoff.length - 1)]!
    this.attempt++
    this.set({ state: 'reconnecting', message: reason, nextRetryAt: this.now() + delay, reconnects: this.st.reconnects + 1 })
    this.retryTimer = this.timer(delay, () => {
      this.retryTimer = null
      this.connect()
    })
  }
}
