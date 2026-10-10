/**
 * Market data (EODHD, 1.8.0): M1 bars of the journal's pairs, fetched by the main process and kept in the data folder
 * (`.market/`, hidden: no scan, no watcher, no ZIP backups) so they work offline and on the other computer. Pure parts:
 * tickers, UTC days, the compact day file, parsing EODHD's answer, aggregating to larger timeframes.
 */
import type { Bar } from './calc/ohlc'
import type { PairConfig } from './schema'

/** Folder of the bar cache in the data folder (a leading dot: never scanned, watched or backed up). */
export const MARKET_DIR = '.market'
export const EODHD_API = 'https://eodhd.com'
export const DAY_MS = 86_400_000
const MIN_MS = 60_000
/**
 * A day is final this long after it ends (UTC): EODHD's minute bars come with some delay; until then the day is
 * fetched again when asked for.
 */
export const DAY_SETTLE_MS = 3 * 3_600_000
/** A day still forming is fetched again at most this often. */
export const OPEN_DAY_REFETCH_MS = 2 * MIN_MS
/** EODHD gives up to 120 days of 1-minute bars per request; a few days less leaves room for the day borders. */
export const MAX_DAYS_PER_REQUEST = 100

export type { Bar }

/** Symbols of the journal → EODHD tickers when the pair says nothing (6 letters = a currency pair or a metal). */
const KNOWN: Record<string, string> = {
  DXY: 'DXY.INDX',
  US500: 'GSPC.INDX',
  SPX: 'GSPC.INDX',
  SPX500: 'GSPC.INDX',
  BRENT: 'XBRUSD.FOREX',
  UKOIL: 'XBRUSD.FOREX',
  XBRUSD: 'XBRUSD.FOREX'
}

/** EODHD ticker of a journal symbol by default; null = not available (e.g. WTI). */
export function defaultMarketTicker(symbol: string): string | null {
  const s = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (KNOWN[s]) return KNOWN[s]
  if (/^(WTI|USOIL|XTIUSD|OIL|CL)/.test(s)) return null
  return /^[A-Z]{6}$/.test(s) ? `${s}.FOREX` : null
}

/** Valid own ticker: "EURUSD.FOREX", "DXY.INDX", "AAPL.US". */
export const TICKER_RE = /^[A-Z0-9][A-Z0-9_-]{0,23}\.[A-Z0-9]{1,10}$/

/** The pair's EODHD ticker: its own (`marketSymbol`; "" = none), else the default. */
export function marketTicker(symbol: string, pairs: readonly Pick<PairConfig, 'symbol' | 'marketSymbol'>[]): string | null {
  const own = pairs.find((p) => p.symbol === symbol)?.marketSymbol
  if (own === '') return null
  if (own && TICKER_RE.test(own)) return own
  return defaultMarketTicker(symbol)
}

const pad = (n: number) => String(n).padStart(2, '0')

/** "YYYY-MM-DD" of a UTC moment. */
export function utcDay(ms: number): string {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

export const dayStart = (day: string): number => Date.parse(`${day}T00:00:00Z`)

/** UTC days touching [fromMs, toMs). */
export function daysBetween(fromMs: number, toMs: number): string[] {
  const out: string[] = []
  if (!(toMs > fromMs)) return out
  for (let t = dayStart(utcDay(fromMs)); t < toMs; t += DAY_MS) out.push(utcDay(t))
  return out
}

/** The day has ended (and settled): its bars no longer change. */
export const dayIsFinal = (day: string, nowMs: number): boolean => nowMs >= dayStart(day) + DAY_MS + DAY_SETTLE_MS

/** Consecutive days grouped into requests of at most `max` days. */
export function dayRanges(days: readonly string[], max = MAX_DAYS_PER_REQUEST): Array<{ first: string; last: string }> {
  const sorted = [...new Set(days)].sort()
  const out: Array<{ first: string; last: string }> = []
  for (const d of sorted) {
    const cur = out[out.length - 1]
    if (cur && dayStart(d) - dayStart(cur.last) === DAY_MS && (dayStart(d) - dayStart(cur.first)) / DAY_MS < max) cur.last = d
    else out.push({ first: d, last: d })
  }
  return out
}

/**
 * EODHD intraday answer → bars (open time in UTC ms, sorted, one per minute). Flat bars that only repeat the last
 * close without volume are fillers of a quiet market and are left out. null = not an EODHD answer.
 */
export function parseEodhdIntraday(raw: unknown): Bar[] | null {
  if (!Array.isArray(raw)) return null
  const byTime = new Map<number, Bar>()
  let lastClose: number | null = null
  const rows = raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map((r) => ({ t: Number(r.timestamp) * 1000, open: Number(r.open), high: Number(r.high), low: Number(r.low), close: Number(r.close), volume: Number(r.volume) }))
    .filter((r) => Number.isFinite(r.t) && [r.open, r.high, r.low, r.close].every((v) => Number.isFinite(v) && v > 0))
    .sort((a, b) => a.t - b.t)
  for (const r of rows) {
    const filler = r.open === r.high && r.high === r.low && r.low === r.close && r.close === lastClose && !(r.volume > 0)
    lastClose = r.close
    if (filler) continue
    byTime.set(r.t, { t: r.t, open: r.open, high: Math.max(r.high, r.open, r.close), low: Math.min(r.low, r.open, r.close), close: r.close })
  }
  return [...byTime.values()]
}

/** One cached day of a ticker. */
export interface MarketDay {
  ticker: string
  day: string
  /** The day had ended (and settled) when fetched: never fetched again. */
  final: boolean
  fetchedAt: string
  bars: Bar[]
}

const decimalsOf = (v: number) => {
  const s = String(v)
  if (s.includes('e')) return 8
  return (s.split('.')[1] ?? '').length
}

/**
 * The day as compact JSON: prices as integers (× 10^decimals), each bar relative to the previous close, times as
 * minutes from midnight – small numbers that gzip well (a full forex day ≈ 10–20 KB).
 */
export function encodeMarketDay(d: MarketDay): string {
  const dec = Math.min(8, d.bars.reduce((m, b) => Math.max(m, decimalsOf(b.open), decimalsOf(b.high), decimalsOf(b.low), decimalsOf(b.close)), 0))
  const k = 10 ** dec
  const q = (v: number) => Math.round(v * k)
  const base = dayStart(d.day)
  const m: number[] = []
  const o: number[] = []
  const h: number[] = []
  const l: number[] = []
  const c: number[] = []
  let prev = d.bars.length ? q(d.bars[0]!.open) : 0
  const first = prev
  for (const b of d.bars) {
    const [O, H, L, C] = [q(b.open), q(b.high), q(b.low), q(b.close)]
    m.push(Math.round((b.t - base) / MIN_MS))
    o.push(O - prev)
    h.push(H - Math.max(O, C))
    l.push(Math.min(O, C) - L)
    c.push(C - O)
    prev = C
  }
  return JSON.stringify({ v: 1, ticker: d.ticker, day: d.day, final: d.final, fetchedAt: d.fetchedAt, dec, first, m, o, h, l, c })
}

/** null = not a day file (or another version). */
export function decodeMarketDay(json: string): MarketDay | null {
  try {
    const x = JSON.parse(json) as Record<string, unknown>
    if (x.v !== 1 || typeof x.ticker !== 'string' || typeof x.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x.day)) return null
    const arr = (k: string) => (Array.isArray(x[k]) ? (x[k] as number[]) : [])
    const [m, o, h, l, c] = ['m', 'o', 'h', 'l', 'c'].map(arr) as [number[], number[], number[], number[], number[]]
    const n = m.length
    if (![o, h, l, c].every((a) => a.length === n)) return null
    const dec = Number(x.dec)
    const k = 10 ** (Number.isInteger(dec) && dec >= 0 && dec <= 8 ? dec : 5)
    const base = dayStart(x.day)
    const bars: Bar[] = []
    let prev = Number(x.first) || 0
    for (let i = 0; i < n; i++) {
      const O = prev + o[i]!
      const C = O + c[i]!
      const H = Math.max(O, C) + h[i]!
      const L = Math.min(O, C) - l[i]!
      bars.push({ t: base + m[i]! * MIN_MS, open: O / k, high: H / k, low: L / k, close: C / k })
      prev = C
    }
    return { ticker: x.ticker, day: x.day, final: x.final === true, fetchedAt: typeof x.fetchedAt === 'string' ? x.fetchedAt : '', bars }
  } catch {
    return null
  }
}

/** Bars split into UTC days (only the given days, each possibly empty: a closed market). */
export function splitByDay(bars: readonly Bar[], days: readonly string[]): Map<string, Bar[]> {
  const out = new Map<string, Bar[]>(days.map((d) => [d, []]))
  for (const b of bars) out.get(utcDay(b.t))?.push(b)
  return out
}

/**
 * Bars aggregated to `minutes` (aligned to UTC: M5 at :00, :05…, H1 at full hours). M1 bars in, larger ones out.
 */
export function resampleBars(bars: readonly Bar[], minutes: number): Bar[] {
  if (minutes <= 1) return [...bars]
  const size = minutes * MIN_MS
  const out: Bar[] = []
  for (const b of bars) {
    const t = Math.floor(b.t / size) * size
    const cur = out[out.length - 1]
    if (cur && cur.t === t) {
      cur.high = Math.max(cur.high, b.high)
      cur.low = Math.min(cur.low, b.low)
      cur.close = b.close
    } else out.push({ t, open: b.open, high: b.high, low: b.low, close: b.close })
  }
  return out
}

/** Answer of `marketBars`: the bars of the range (as far as known) and what is missing. */
export type MarketBarsResult =
  | { ok: true; bars: Bar[]; /** Days without data (not fetched: off / no key / offline). */ missingDays: string[]; fetchedDays: number }
  | { ok: false; message: string; bars: Bar[]; missingDays: string[] }

/** What the renderer may know about the market data connection (never the key itself). */
export interface MarketStatus {
  /** Fetching switched on (on this computer). */
  enabled: boolean
  hasKey: boolean
  /** Last 4 characters of the key, to recognise it. */
  keyHint: string | null
  /** The key is encrypted with the system's protection (DPAPI on Windows). */
  encrypted: boolean
  /** eodhd = eodhd.com, test = a local server (ICTJ_MARKET_URL), off = never connects (ICTJ_MARKET_URL=off). */
  source: 'eodhd' | 'test' | 'off'
}

export type MarketTestResult = { ok: true; requests: number | null; dailyLimit: number | null; plan: string | null } | { ok: false; message: string }

export interface MarketCacheStats {
  bytes: number
  days: number
  tickers: string[]
}
