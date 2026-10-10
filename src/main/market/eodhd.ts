/**
 * EODHD client (main process only, Electron's net.fetch like NBP and updates). The key goes only into the request
 * URL – never into logs or messages. ICTJ_MARKET_URL points to a local test server (plain http allowed) or is "off".
 */
import { EODHD_API, parseEodhdIntraday, type Bar, type MarketTestResult } from '@shared/market'
import { HttpError, fetchJson, type FetchLike } from '../update/download'

const TIMEOUT_MS = 30_000

const NETWORK_ERROR =
  /net::ERR_|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|fetch failed|failed to fetch|terminated|other side closed|socket hang up|aborted/i

export interface MarketSource {
  /** Base address; null = never connects. */
  base: string | null
  allowInsecure: boolean
  kind: 'eodhd' | 'test' | 'off'
}

export function marketSource(env: string | undefined): MarketSource {
  const value = env?.trim()
  if (!value) return { base: EODHD_API, allowInsecure: false, kind: 'eodhd' }
  if (value.toLowerCase() === 'off') return { base: null, allowInsecure: false, kind: 'off' }
  return { base: value.replace(/\/+$/, ''), allowInsecure: true, kind: 'test' }
}

/** A Polish message without the URL (it holds the key). */
export function describeMarketError(e: unknown): string {
  if (e instanceof HttpError) {
    if (e.status === 401) return 'EODHD odrzucił klucz API (nieprawidłowy albo wygasły)'
    if (e.status === 402 || e.status === 403) return 'plan EODHD nie obejmuje tych danych albo wyczerpano dzienny limit'
    if (e.status === 404) return 'EODHD nie zna tego symbolu'
    if (e.status === 429) return 'za dużo zapytań do EODHD – spróbuj za chwilę'
    return `serwer EODHD odpowiedział błędem ${e.status}`
  }
  const err = e instanceof Error ? e : new Error(String(e))
  const text = `${err.name} ${err.message} ${(err.cause as { code?: string } | undefined)?.code ?? ''} ${(err.cause as Error | undefined)?.message ?? ''}`
  if (NETWORK_ERROR.test(text) || err.name === 'AbortError') return 'brak połączenia z internetem albo serwer EODHD nie odpowiada'
  return 'nieoczekiwana odpowiedź serwera EODHD'
}

function url(source: MarketSource, path: string, key: string, params: Record<string, string>): string | null {
  if (!source.base) return null
  const u = new URL(`${source.base}/api/${path}`)
  for (const [k, v] of Object.entries({ ...params, api_token: key, fmt: 'json' })) u.searchParams.set(k, v)
  if (!source.allowInsecure && u.protocol !== 'https:') return null
  return u.toString()
}

/** The account (plan, today's requests) – "Sprawdź połączenie". */
export async function fetchMarketUser(fetchFn: FetchLike, source: MarketSource, key: string): Promise<MarketTestResult> {
  const address = url(source, 'user', key, {})
  if (!address) return { ok: false, message: source.base ? 'dozwolone są tylko adresy https://' : 'połączenie z EODHD jest wyłączone' }
  try {
    const raw = (await fetchJson(fetchFn, address, { Accept: 'application/json' }, TIMEOUT_MS)) as Record<string, unknown> | null
    if (!raw || typeof raw !== 'object') return { ok: false, message: 'nieoczekiwana odpowiedź serwera EODHD' }
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
    return { ok: true, requests: num(raw.apiRequests), dailyLimit: num(raw.dailyRateLimit), plan: typeof raw.subscriptionType === 'string' ? raw.subscriptionType : null }
  } catch (e) {
    return { ok: false, message: describeMarketError(e) }
  }
}

/** 1-minute bars of `ticker` for [fromMs, toMs) (EODHD: at most 120 days per request). */
export async function fetchIntraday(
  fetchFn: FetchLike,
  source: MarketSource,
  key: string,
  ticker: string,
  fromMs: number,
  toMs: number
): Promise<{ ok: true; bars: Bar[] } | { ok: false; message: string; status: number | null }> {
  const address = url(source, `intraday/${encodeURIComponent(ticker)}`, key, {
    interval: '1m',
    from: String(Math.floor(fromMs / 1000)),
    to: String(Math.floor((toMs - 1) / 1000))
  })
  if (!address) return { ok: false, message: source.base ? 'dozwolone są tylko adresy https://' : 'połączenie z EODHD jest wyłączone', status: null }
  try {
    const bars = parseEodhdIntraday(await fetchJson(fetchFn, address, { Accept: 'application/json' }, TIMEOUT_MS))
    if (!bars) return { ok: false, message: 'nieoczekiwana odpowiedź serwera EODHD', status: null }
    return { ok: true, bars: bars.filter((b) => b.t >= fromMs && b.t < toMs) }
  } catch (e) {
    return { ok: false, message: describeMarketError(e), status: e instanceof HttpError ? e.status : null }
  }
}
