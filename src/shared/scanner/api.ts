/**
 * IPC contract of the scanner (window.journal.scanner). The renderer owns the journal settings and sends the scanner
 * configuration; the main process connects to EODHD, stores candles and reports status.
 */
import type { ExchangeSymbol, EodhdUser } from './eodhd'
import type { ScannerSettings } from './settings'
import type { SubscriptionPlan, SubscriptionReason } from './subscription'
import type { Candle, Interval, PriceMode, Range, SeriesCandle } from './types'

export type StreamState = 'off' | 'no-key' | 'connecting' | 'live' | 'reconnecting' | 'auth-failed' | 'symbol-limit'

export interface StreamStatus {
  state: StreamState
  /** Since when the state holds (ms). */
  since: number
  connectedAt: number | null
  lastMessageAt: number | null
  /** Last tick with a current exchange time (not the snapshot sent after subscribing). */
  lastLiveTickAt: number | null
  reconnects: number
  symbols: string[]
  /** Polish text of the last problem (masked). */
  message: string | null
  nextRetryAt: number | null
}

export type KeySource = 'env' | 'stored' | 'session'

export interface KeyState {
  present: boolean
  source: KeySource | null
  /** First and last characters only, e.g. "65f8…5678". */
  masked: string | null
  /** False when the key could not be stored encrypted (kept until the app closes). */
  persisted: boolean
}

export interface BackfillProgress {
  running: boolean
  stage: number
  stages: number
  symbol: string | null
  /** Requests done / planned in the current stage. */
  done: number
  total: number
  /** Symbols whose last attempt failed, with a masked reason. */
  errors: Record<string, string>
  finishedAt: number | null
}

export interface RestUsage {
  /** GMT day the counter belongs to. */
  date: string
  /** API calls (intraday = 5 per request) counted by this computer today. */
  calls: number
  requests: number
}

export type EodhdErrorKind = 'no-key' | 'auth' | 'forbidden' | 'daily-limit' | 'rate' | 'network' | 'http' | 'bad-response'

export interface SymbolUsage {
  symbol: string
  bytes: number
  /** First / last covered second of M1 data, null when empty. */
  from: number | null
  to: number | null
}

/** Settings the renderer sends (journal settings.scanner + account currency). */
export interface ScannerConfig {
  scanner: ScannerSettings
  accountCurrency: string
}

export interface ScannerSymbolStatus {
  symbol: string
  reasons: SubscriptionReason[]
  /** EODHD has REST history for it. */
  rest: boolean
  /** Last live tick (ms), its spread. */
  lastTick: number | null
  spread: number | null
  /** A live tick within the last 30 minutes. */
  streaming: boolean
  coverageFrom: number | null
  coverageTo: number | null
  /** Seconds of market time without data in the last 24 hours. */
  gapSeconds24h: number
}

export interface ScannerStatus {
  /** False when the network is switched off (ICTJ_EODHD_URL=off in tests). */
  network: boolean
  configured: boolean
  now: number
  marketOpen: boolean
  price: PriceMode
  stream: StreamStatus
  key: KeyState
  usage: RestUsage
  /** Daily limit reported by EODHD (null until the key was tested). */
  dailyLimit: number | null
  /** After a 402 no REST requests until this time (ms). */
  blockedUntil: number | null
  restError: { kind: EodhdErrorKind; message: string; at: number } | null
  plan: SubscriptionPlan
  backfill: BackfillProgress
  symbols: ScannerSymbolStatus[]
}

export interface LiveUpdate {
  symbol: string
  bid: number
  ask: number
  /** Tick time (ms). */
  t: number
  /** M1 being built. */
  forming: Candle | null
  /** M1 closed since the last update. */
  closed: Candle[]
}

export type ScannerEvent = { type: 'status'; status: ScannerStatus } | { type: 'live'; updates: LiveUpdate[] }

export interface CsvImportResult {
  symbol: string
  interval: 'M1' | 'H1'
  count: number
  from: number
  to: number
  /** Weekend rows skipped, unreadable rows. */
  weekend: number
  skipped: number
}

export interface KeyTestResult {
  ok: boolean
  user?: EodhdUser
  message?: string
}

export interface ScannerApi {
  configure(config: ScannerConfig): Promise<ScannerStatus>
  status(): Promise<ScannerStatus>
  series(symbol: string, interval: Interval, from: number, to: number): Promise<SeriesCandle[]>
  gaps(symbol: string, from: number, to: number): Promise<Range[]>
  setApiKey(key: string): Promise<KeyState>
  clearApiKey(): Promise<KeyState>
  testApiKey(): Promise<KeyTestResult>
  /** EODHD forex symbol list (cached for a week). */
  symbols(): Promise<ExchangeSymbol[]>
  /** Asks for a TradingView CSV and imports it for `symbol`; null when cancelled. */
  importCsv(symbol: string): Promise<CsvImportResult | null>
  cacheUsage(): Promise<SymbolUsage[]>
  clearCache(symbol?: string): Promise<void>
  /** Reconnect and fill gaps now. */
  refresh(): Promise<void>
  onEvent(cb: (event: ScannerEvent) => void): () => void
}
