/**
 * EODHD REST client of the scanner (main process only). Requests go through a queue (spacing and concurrency limit),
 * every call is counted against the daily limit (reset at midnight GMT), and every error text is masked: request URLs
 * carry the API token and must never reach logs or the UI.
 */
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { HttpError, fetchJson, type FetchLike } from '../../update/download'
import { writeFileAtomic } from '../../datastore/atomic'
import {
  INTRADAY_CALL_COST,
  intradayPath,
  maskToken,
  parseIntraday,
  parseSymbolList,
  parseUser,
  splitRange,
  type EodhdUser,
  type ExchangeSymbol
} from '@shared/scanner/eodhd'
import type { Candle, Range } from '@shared/scanner/types'
import type { EodhdErrorKind, RestUsage } from '@shared/scanner/api'

export type { EodhdErrorKind, RestUsage }

export class EodhdError extends Error {
  constructor(
    readonly kind: EodhdErrorKind,
    message: string
  ) {
    super(message)
    this.name = 'EodhdError'
  }
}

const NETWORK_ERROR =
  /net::ERR_|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|fetch failed|failed to fetch|terminated|other side closed|socket hang up|aborted|limit czasu/i

/** Midnight GMT after `now` (ms). */
function nextGmtMidnight(now: number): number {
  const d = new Date(now)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)
}

/** Daily call counter persisted in userData/scanner/usage.json. */
export class UsageCounter {
  private usage: RestUsage
  private saving: Promise<void> = Promise.resolve()

  constructor(
    private readonly path: string | null,
    private readonly now: () => number = Date.now
  ) {
    this.usage = { date: this.today(), calls: 0, requests: 0 }
  }

  private today(): string {
    return new Date(this.now()).toISOString().slice(0, 10)
  }

  async load(): Promise<void> {
    if (!this.path) return
    try {
      const raw = JSON.parse(await fs.readFile(this.path, 'utf8')) as Partial<RestUsage>
      if (raw.date === this.today() && typeof raw.calls === 'number') {
        this.usage = { date: raw.date, calls: raw.calls, requests: typeof raw.requests === 'number' ? raw.requests : 0 }
      }
    } catch {
      // No file yet.
    }
  }

  get(): RestUsage {
    if (this.usage.date !== this.today()) this.usage = { date: this.today(), calls: 0, requests: 0 }
    return { ...this.usage }
  }

  /** Resolves once every `add` so far has been written to disk (writes never reject). */
  flush(): Promise<void> {
    return this.saving
  }

  add(calls: number): void {
    const u = this.get()
    this.usage = { ...u, calls: u.calls + calls, requests: u.requests + 1 }
    const path = this.path
    if (path) {
      const snapshot = `${JSON.stringify(this.usage)}\n`
      this.saving = this.saving
        .then(() => fs.mkdir(dirname(path), { recursive: true }))
        .then(() => writeFileAtomic(path, snapshot))
        .catch(() => undefined)
    }
  }
}

export interface RestOptions {
  fetch: FetchLike
  /** API base, e.g. https://eodhd.com/api (or a local test server). */
  base: string
  token: () => string | null
  usage: UsageCounter
  /** Minimum spacing between request starts (EODHD allows 1000 requests per minute). */
  minIntervalMs?: number
  maxConcurrent?: number
  timeoutMs?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

export interface IntradayResult {
  candles: Candle[]
  rejected: number
}

export class EodhdRest {
  private active = 0
  private lastStart = 0
  private readonly waiting: Array<() => void> = []
  /** After a 402 (daily limit used up) no requests until this time (ms). */
  private blockedUntil = 0
  private lastError: { kind: EodhdErrorKind; message: string; at: number } | null = null

  constructor(private readonly o: RestOptions) {}

  private get now(): number {
    return (this.o.now ?? Date.now)()
  }

  private sleep(ms: number): Promise<void> {
    return (this.o.sleep ?? ((x) => new Promise((r) => setTimeout(r, x))))(ms)
  }

  error(): { kind: EodhdErrorKind; message: string; at: number } | null {
    return this.lastError
  }

  blocked(): number | null {
    return this.blockedUntil > this.now ? this.blockedUntil : null
  }

  private async slot(): Promise<void> {
    const max = this.o.maxConcurrent ?? 2
    while (this.active >= max) await new Promise<void>((r) => this.waiting.push(r))
    this.active++
    const wait = this.lastStart + (this.o.minIntervalMs ?? 250) - this.now
    this.lastStart = Math.max(this.now, this.lastStart + (this.o.minIntervalMs ?? 250))
    if (wait > 0) await this.sleep(wait)
  }

  private release(): void {
    this.active--
    this.waiting.shift()?.()
  }

  private fail(kind: EodhdErrorKind, message: string): never {
    const token = this.o.token()
    const masked = maskToken(maskToken(message, token), token ? encodeURIComponent(token) : null)
    this.lastError = { kind, message: masked, at: this.now }
    throw new EodhdError(kind, masked)
  }

  /** GET `path` (with query, without token); `cost` = API calls charged. 404 → null. */
  async get(path: string, cost: number): Promise<unknown> {
    const token = this.o.token()
    if (!token) this.fail('no-key', 'Brak klucza API EODHD (Ustawienia → Skaner).')
    if (this.blockedUntil > this.now) this.fail('daily-limit', 'Wyczerpany dzienny limit wywołań EODHD – wznowienie po północy GMT.')
    const url = `${this.o.base.replace(/\/+$/, '')}${path}${path.includes('?') ? '&' : '?'}api_token=${encodeURIComponent(token)}`
    for (let attempt = 0; ; attempt++) {
      await this.slot()
      try {
        const json = await fetchJson(this.o.fetch, url, { Accept: 'application/json' }, this.o.timeoutMs ?? 30_000)
        this.o.usage.add(cost)
        this.lastError = null
        return json
      } catch (e) {
        if (e instanceof HttpError) {
          if (e.status !== 429) this.o.usage.add(cost)
          if (e.status === 404) return null
          if (e.status === 401) this.fail('auth', 'EODHD odrzucił klucz API (401). Sprawdź klucz w Ustawienia → Skaner.')
          if (e.status === 402) {
            this.blockedUntil = nextGmtMidnight(this.now)
            this.fail('daily-limit', 'Wyczerpany dzienny limit wywołań EODHD (402) – wznowienie po północy GMT.')
          }
          if (e.status === 403) this.fail('forbidden', 'Brak dostępu do tych danych w planie EODHD (403).')
          if (e.status === 429 && attempt < 2) {
            await this.sleep(60_000)
            continue
          }
          if (e.status === 429) this.fail('rate', 'Za dużo zapytań do EODHD (429) – spróbuję później.')
          this.fail('http', `EODHD odpowiedział błędem ${e.status}.`)
        }
        const err = e instanceof Error ? e : new Error(String(e))
        const text = `${err.name} ${err.message} ${(err.cause as Error | undefined)?.message ?? ''}`
        if (NETWORK_ERROR.test(text) || err.name === 'AbortError') this.fail('network', 'Brak połączenia z EODHD (internet albo serwer).')
        this.fail('bad-response', `Nieoczekiwana odpowiedź EODHD: ${err.message}`)
      } finally {
        this.release()
      }
    }
  }

  /** 1m bars of [from, to) for a REST code (EURUSD.FOREX), split into ≤ 100-day requests. Unknown symbol → []. */
  async intraday(code: string, range: Range): Promise<IntradayResult> {
    const candles: Candle[] = []
    let rejected = 0
    for (const part of splitRange(range)) {
      // EODHD's `to` is inclusive; ask up to the last minute that starts before the end.
      const json = await this.get(intradayPath(code, part.from, part.to - 1), INTRADAY_CALL_COST)
      if (json === null) continue
      if (!Array.isArray(json)) this.fail('bad-response', 'Nieoczekiwana odpowiedź EODHD (oczekiwano listy świec).')
      const parsed = parseIntraday(json)
      rejected += parsed.rejected
      for (const c of parsed.candles) if (c.t >= part.from && c.t < part.to) candles.push(c)
    }
    return { candles, rejected }
  }

  /** Account details without personal data (also a key test). */
  async user(): Promise<EodhdUser> {
    const json = await this.get('/internal-user?fmt=json', 1)
    if (!json || typeof json !== 'object') this.fail('bad-response', 'Nieoczekiwana odpowiedź EODHD.')
    return parseUser(json)
  }

  async symbols(exchange: string): Promise<ExchangeSymbol[]> {
    const json = await this.get(`/exchange-symbol-list/${encodeURIComponent(exchange)}?fmt=json`, 1)
    return parseSymbolList(json)
  }
}
