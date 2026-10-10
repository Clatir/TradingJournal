/**
 * Scanner data service (main process): stream → M1 → candle store, REST backfill of gaps, coverage from a healthy
 * stream, status and live updates for the window. The renderer sends the configuration (journal settings.scanner and
 * the account currency); nothing here reads the journal folder.
 */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { writeFileAtomic } from '../datastore/atomic'
import type { FetchLike } from '../update/download'
import { M1Builder, type ClosedM1, type Tick } from '@shared/scanner/m1'
import { subscriptionPlan, type SubscriptionPlan } from '@shared/scanner/subscription'
import { tvCsvCandles } from '@shared/scanner/csv'
import { isMarketOpen } from '@shared/scanner/time'
import type { EodhdUser, ExchangeSymbol } from '@shared/scanner/eodhd'
import type { Candle, Interval, Range, SeriesCandle } from '@shared/scanner/types'
import type {
  CsvImportResult,
  KeyState,
  KeyTestResult,
  LiveUpdate,
  ScannerConfig,
  ScannerEvent,
  ScannerStatus,
  ScannerSymbolStatus,
  SymbolUsage
} from '@shared/scanner/api'
import { CandleStore } from './store'
import { EodhdError, EodhdRest, UsageCounter } from './eodhd/rest'
import { FxStream, type WsLike } from './eodhd/ws'
import { Backfill, type BackfillTarget } from './backfill'
import { ApiKeyStore, type KeyCrypto } from './apiKey'

export interface ScannerNetwork {
  /** REST base, e.g. https://eodhd.com/api. */
  restBase: string
  /** Forex stream address, e.g. wss://ws.eodhistoricaldata.com/ws/forex. */
  wsUrl: string
}

export interface ScannerDeps {
  /** userData/scanner */
  root: string
  fetch: FetchLike
  /** null = never connect (tests). */
  network: ScannerNetwork | null
  crypto: KeyCrypto
  envToken?: string
  log: (level: 'info' | 'warn' | 'error', message: string) => void
  emit: (event: ScannerEvent) => void
  now?: () => number
  createSocket?: (url: string) => WsLike
  /** Timer periods (tests shorten them). */
  tickMs?: number
  backfillEveryMs?: number
}

/** EODHD defaults (production). */
export const EODHD_NETWORK: ScannerNetwork = { restBase: 'https://eodhd.com/api', wsUrl: 'wss://ws.eodhistoricaldata.com/ws/forex' }

/** ICTJ_EODHD_URL: unset = EODHD, "off" = no network, else a local test server (http://host:port). */
export function scannerNetwork(env: string | undefined): ScannerNetwork | null {
  const v = env?.trim()
  if (!v) return EODHD_NETWORK
  if (v.toLowerCase() === 'off') return null
  const base = v.replace(/\/+$/, '')
  return { restBase: `${base}/api`, wsUrl: `${base.replace(/^http/i, 'ws')}/ws/forex` }
}

const STREAMING_WINDOW_MS = 30 * 60_000
const SYMBOLS_CACHE_DAYS = 7

export class ScannerService {
  readonly store: CandleStore
  private readonly usage: UsageCounter
  private readonly keys: ApiKeyStore
  private readonly rest: EodhdRest
  private readonly stream: FxStream | null
  private readonly m1 = new M1Builder('bid')
  private readonly backfill: Backfill
  private config: ScannerConfig | null = null
  private configKey = ''
  private plan: SubscriptionPlan = { symbols: [], reasons: {}, limit: 50, over: false }
  private user: EodhdUser | null = null
  private streamStarted = false
  private readonly live = new Map<string, LiveUpdate>()
  private lastLiveEmit = 0
  private lastStatusEmit = 0
  private statusQueued = false
  /** Stream coverage is confirmed up to this second. */
  private coveredTo = 0
  private timers: Array<ReturnType<typeof setInterval>> = []
  private ticks = 0

  constructor(private readonly d: ScannerDeps) {
    this.store = new CandleStore(join(d.root, 'candles'))
    this.usage = new UsageCounter(join(d.root, 'usage.json'), () => this.now())
    this.keys = new ApiKeyStore(join(d.root, 'key.bin'), d.crypto, d.envToken)
    this.rest = new EodhdRest({ fetch: d.fetch, base: d.network?.restBase ?? 'http://127.0.0.1:9', token: () => this.keys.get(), usage: this.usage, now: () => this.now() })
    this.stream = d.network
      ? new FxStream({
          url: d.network.wsUrl,
          token: () => this.keys.get(),
          onTick: (t, now) => this.onTick(t, now),
          onStatus: () => this.queueStatus(),
          create: d.createSocket,
          now: () => this.now()
        })
      : null
    this.backfill = new Backfill({
      store: this.store,
      rest: this.rest,
      now: () => this.now(),
      onProgress: () => this.queueStatus(),
      log: (m) => d.log('warn', m)
    })
  }

  private now(): number {
    return (this.d.now ?? Date.now)()
  }

  async init(): Promise<void> {
    await this.keys.load()
    await this.usage.load()
    this.timers.push(setInterval(() => this.everySecond(), this.d.tickMs ?? 1000))
    this.timers.push(setInterval(() => void this.runBackfill(), this.d.backfillEveryMs ?? 15 * 60_000))
  }

  async stop(): Promise<void> {
    for (const t of this.timers) clearInterval(t)
    this.timers = []
    this.stream?.stop()
    this.backfill.cancel()
    for (const c of this.m1.flush(Number.MAX_SAFE_INTEGER)) await this.persist(c)
    await this.store.flush()
  }

  // ---- configuration --------------------------------------------------------------------------------------------

  async configure(config: ScannerConfig): Promise<ScannerStatus> {
    const key = JSON.stringify(config)
    if (key !== this.configKey) {
      const before = this.plan.symbols.join(',')
      this.config = config
      this.configKey = key
      this.plan = subscriptionPlan(config.scanner, config.accountCurrency)
      this.m1.setMode(config.scanner.price)
      const symbols = this.plan.over ? this.plan.symbols.slice(0, this.plan.limit) : this.plan.symbols
      if (this.stream) {
        // Without a key the stream reports "no-key" until one is entered.
        if (!this.streamStarted) {
          this.stream.start(symbols)
          this.streamStarted = true
        } else if (before !== this.plan.symbols.join(',')) this.stream.setSymbols(symbols)
      }
      void this.runBackfill()
    }
    return this.status()
  }

  private targets(): BackfillTarget[] {
    const c = this.config
    if (!c) return []
    const instruments = new Map(c.scanner.instruments.filter((i) => i.enabled).map((i) => [i.symbol, i]))
    return this.plan.symbols.map((symbol) => {
      const inst = instruments.get(symbol)
      return inst
        ? { symbol, rest: inst.rest, depthDays: c.scanner.depthDays }
        : { symbol, rest: `${symbol}.FOREX`, depthDays: c.scanner.componentDepthDays }
    })
  }

  async runBackfill(): Promise<void> {
    if (!this.d.network || !this.keys.get() || !this.config) return
    try {
      await this.backfill.run(this.targets())
    } catch (e) {
      this.d.log('warn', `backfill: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  /** After waking up or on request: reconnect and fill gaps. */
  async refresh(): Promise<void> {
    if (this.stream && this.streamStarted) this.stream.reconnectNow('odświeżenie')
    await this.runBackfill()
  }

  // ---- live data ------------------------------------------------------------------------------------------------

  private onTick(tick: Tick, now: number): void {
    const closed = this.m1.tick(tick, now)
    for (const c of closed) void this.persist(c)
    const st = this.m1.stats.get(tick.symbol)
    if (!st || st.lastTick !== tick.t) return // stale snapshot or ignored tick
    const u = this.live.get(tick.symbol) ?? { symbol: tick.symbol, bid: tick.bid, ask: tick.ask, t: tick.t, forming: null, closed: [] }
    u.bid = tick.bid
    u.ask = tick.ask
    u.t = tick.t
    u.forming = this.m1.forming(tick.symbol)
    this.live.set(tick.symbol, u)
  }

  private async persist(c: ClosedM1): Promise<void> {
    const u = this.live.get(c.symbol)
    if (u) u.closed.push(c.candle)
    else this.live.set(c.symbol, { symbol: c.symbol, bid: c.candle.c, ask: c.candle.c, t: c.candle.t * 1000, forming: null, closed: [c.candle] })
    try {
      await this.store.appendLive(c.symbol, c.candle)
    } catch (e) {
      this.d.log('error', `zapis świecy ${c.symbol}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  private everySecond(): void {
    const now = this.now()
    for (const c of this.m1.flush(now)) void this.persist(c)
    if (++this.ticks % 5 === 0) this.stream?.checkHealth()
    void this.extendStreamCoverage(now)
    if (this.live.size && now - this.lastLiveEmit >= 250) {
      const updates = [...this.live.values()].map((u) => ({ ...u, forming: this.m1.forming(u.symbol) }))
      this.live.clear()
      this.lastLiveEmit = now
      this.d.emit({ type: 'live', updates })
    }
    if (now - this.lastStatusEmit >= 5000) this.queueStatus()
  }

  /** Minutes in which the stream was alive count as covered for symbols that are streaming. */
  private async extendStreamCoverage(now: number): Promise<void> {
    const target = Math.floor((now - 2000) / 60_000) * 60
    if (target <= this.coveredTo) return
    const st = this.stream?.status()
    const healthy = st?.state === 'live' && st.connectedAt !== null && (st.lastLiveTickAt ?? 0) >= now - 90_000
    if (healthy && st.connectedAt !== null) {
      const from = Math.max(this.coveredTo, Math.ceil(st.connectedAt / 60_000) * 60)
      if (target > from) {
        for (const symbol of this.plan.symbols) {
          const lastTick = this.m1.stats.get(symbol)?.lastTick ?? null
          if (lastTick !== null && lastTick >= now - STREAMING_WINDOW_MS) await this.store.addCoverage(symbol, 'M1', { from, to: target })
        }
      }
    }
    this.coveredTo = target
  }

  // ---- status ---------------------------------------------------------------------------------------------------

  private queueStatus(): void {
    if (this.statusQueued) return
    this.statusQueued = true
    setTimeout(() => {
      this.statusQueued = false
      this.lastStatusEmit = this.now()
      this.status().then(
        (status) => this.d.emit({ type: 'status', status }),
        (e) => this.d.log('warn', `status: ${e instanceof Error ? e.message : String(e)}`)
      )
    }, 200)
  }

  async status(): Promise<ScannerStatus> {
    const now = this.now()
    const nowSec = Math.floor(now / 1000)
    const instruments = new Map((this.config?.scanner.instruments ?? []).map((i) => [i.symbol, i]))
    const symbols: ScannerSymbolStatus[] = []
    for (const symbol of this.plan.symbols) {
      const st = this.m1.stats.get(symbol)
      const cov = await this.store.coverage(symbol)
      const gaps = await this.store.gaps(symbol, nowSec - 86400, Math.floor(nowSec / 60) * 60)
      symbols.push({
        symbol,
        reasons: this.plan.reasons[symbol] ?? [],
        rest: instruments.get(symbol)?.rest !== null,
        lastTick: st?.lastTick ?? null,
        spread: st?.spread ?? null,
        streaming: (st?.lastTick ?? 0) >= now - STREAMING_WINDOW_MS,
        coverageFrom: cov[0]?.from ?? null,
        coverageTo: cov.at(-1)?.to ?? null,
        gapSeconds24h: gaps.reduce((s, g) => s + (g.to - g.from), 0)
      })
    }
    const offStream = { state: 'off' as const, since: now, connectedAt: null, lastMessageAt: null, lastLiveTickAt: null, reconnects: 0, symbols: [], message: null, nextRetryAt: null }
    return {
      network: !!this.d.network,
      configured: !!this.config,
      now,
      marketOpen: isMarketOpen(nowSec),
      price: this.config?.scanner.price ?? 'bid',
      stream: this.stream?.status() ?? offStream,
      key: this.keys.state(),
      usage: this.usage.get(),
      dailyLimit: this.user?.dailyRateLimit ?? null,
      blockedUntil: this.rest.blocked(),
      restError: this.rest.error(),
      plan: this.plan,
      backfill: this.backfill.state(),
      symbols
    }
  }

  // ---- key ------------------------------------------------------------------------------------------------------

  async setApiKey(key: string): Promise<KeyState> {
    const state = await this.keys.set(key)
    this.user = null
    if (this.stream && this.config) {
      if (this.streamStarted) {
        this.stream.stop()
        this.stream.start(this.plan.symbols.slice(0, this.plan.limit))
      } else {
        this.stream.start(this.plan.symbols.slice(0, this.plan.limit))
        this.streamStarted = true
      }
    }
    void this.runBackfill()
    this.queueStatus()
    return state
  }

  async clearApiKey(): Promise<KeyState> {
    const state = await this.keys.clear()
    this.stream?.stop()
    // Restarted without a key: the status says "no key" instead of "off".
    if (this.stream && this.config) this.stream.start(this.plan.symbols.slice(0, this.plan.limit))
    this.streamStarted = !!(this.stream && this.config)
    this.user = null
    this.queueStatus()
    return state
  }

  async testApiKey(): Promise<KeyTestResult> {
    if (!this.d.network) return { ok: false, message: 'Łączenie z EODHD jest wyłączone.' }
    try {
      this.user = await this.rest.user()
      this.queueStatus()
      return { ok: true, user: this.user }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  }

  // ---- data access ----------------------------------------------------------------------------------------------

  series(symbol: string, interval: Interval, from: number, to: number): Promise<SeriesCandle[]> {
    return this.store.series(symbol, interval, from, to)
  }

  gaps(symbol: string, from: number, to: number): Promise<Range[]> {
    return this.store.gaps(symbol, from, to, true)
  }

  async symbols(): Promise<ExchangeSymbol[]> {
    const path = join(this.d.root, 'symbols-FOREX.json')
    type Cache = { fetchedAt: number; symbols: ExchangeSymbol[] }
    let cached: Cache | null = null
    try {
      cached = JSON.parse(await fs.readFile(path, 'utf8')) as Cache
    } catch {
      // No cache yet.
    }
    const fresh = cached && this.now() - cached.fetchedAt < SYMBOLS_CACHE_DAYS * 86_400_000
    if (fresh || !this.d.network || !this.keys.get()) return cached?.symbols ?? []
    try {
      const symbols = await this.rest.symbols('FOREX')
      if (symbols.length) await writeFileAtomic(path, `${JSON.stringify({ fetchedAt: this.now(), symbols })}\n`)
      return symbols
    } catch (e) {
      if (cached) return cached.symbols
      throw e instanceof EodhdError ? new Error(e.message) : e
    }
  }

  /** TradingView CSV (1 min → M1, 1 h → H1 import); stored bars of this computer's own sources win on equal times. */
  async importCsv(symbol: string, text: string): Promise<CsvImportResult> {
    const parsed = tvCsvCandles(text)
    if (!parsed.candles.length) throw new Error('W pliku nie ma świec z godzin otwarcia rynku.')
    const base = parsed.interval
    const step = base === 'M1' ? 60 : 3600
    await this.store.write(symbol, base, parsed.candles, base === 'H1')
    const first = parsed.candles[0]!
    const last = parsed.candles.at(-1)!
    await this.store.addCoverage(symbol, base, { from: first.t, to: last.t + step })
    await this.store.flush()
    this.d.log('info', `import CSV ${symbol} ${base}: ${parsed.candles.length} świec`)
    return { symbol, interval: base, count: parsed.candles.length, from: first.t, to: last.t + step, weekend: parsed.weekend, skipped: parsed.skipped }
  }

  cacheUsage(): Promise<SymbolUsage[]> {
    return this.store.usage()
  }

  async clearCache(symbol?: string): Promise<void> {
    await this.store.clear(symbol)
    this.queueStatus()
    void this.runBackfill()
  }

  /** Bars still being built, per symbol (for charts opened later). */
  forming(symbol: string): Candle | null {
    return this.m1.forming(symbol)
  }
}
