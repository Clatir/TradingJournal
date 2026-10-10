/**
 * Market bars for the renderer: from the cache in the data folder, missing days fetched from EODHD (when switched on
 * and a key is set), whole days at a time (consecutive days in one request). A day is fetched once it has ended; the
 * day still forming is fetched again at most every 2 minutes. Requests run one after another.
 */
import { OPEN_DAY_REFETCH_MS, dayIsFinal, dayRanges, dayStart, daysBetween, DAY_MS, splitByDay, type Bar, type MarketBarsResult, type MarketDay } from '@shared/market'
import type { FetchLike } from '../update/download'
import { MarketCache } from './cache'
import { fetchIntraday, type MarketSource } from './eodhd'

export interface MarketServiceDeps {
  fetch: FetchLike
  source: () => MarketSource
  /** The key (decrypted) when fetching is allowed: switched on and set; null = cache only. */
  key: () => string | null
  /** Data folder (null = none open) and whether it is read-only (then fetched days stay in memory only). */
  root: () => string | null
  readOnly: () => boolean
  now?: () => number
  log?: (level: 'info' | 'warn', msg: string) => void
}

export class MarketService {
  private queue: Promise<unknown> = Promise.resolve()
  /** Days read or fetched in this session, per data folder. */
  private memo = new Map<string, MarketDay>()
  private memoRoot: string | null = null

  constructor(private readonly deps: MarketServiceDeps) {}

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now()
  }

  private cache(): MarketCache | null {
    const root = this.deps.root()
    if (root !== this.memoRoot) {
      this.memo.clear()
      this.memoRoot = root
    }
    return root ? new MarketCache(root) : null
  }

  forget(): void {
    this.memo.clear()
  }

  /** Bars of [fromMs, toMs) (UTC ms); `offline` = never connect (cache only). */
  bars(ticker: string, fromMs: number, toMs: number, opts: { offline?: boolean } = {}): Promise<MarketBarsResult> {
    // One at a time: two views asking for the same day fetch it once.
    const run = this.queue.then(() => this.load(ticker, fromMs, toMs, opts))
    this.queue = run.catch(() => undefined)
    return run
  }

  private async load(ticker: string, fromMs: number, toMs: number, opts: { offline?: boolean }): Promise<MarketBarsResult> {
    const cache = this.cache()
    const now = this.now()
    // Days that have not started have no bars.
    const days = daysBetween(fromMs, Math.min(toMs, now + 60_000))
    const have = new Map<string, MarketDay>()
    const need: string[] = []
    for (const day of days) {
      const key = `${ticker}|${day}`
      let d = this.memo.get(key) ?? null
      if (!d && cache) {
        d = await cache.read(ticker, day)
        if (d) this.memo.set(key, d)
      }
      if (d) have.set(day, d)
      const fresh = d && (d.final || now - Date.parse(d.fetchedAt) < OPEN_DAY_REFETCH_MS)
      if (!fresh) need.push(day)
    }
    const key = opts.offline ? null : this.deps.key()
    const source = this.deps.source()
    let error: string | null = null
    let fetchedDays = 0
    if (need.length && key && source.base) {
      for (const range of dayRanges(need)) {
        const from = dayStart(range.first)
        const to = dayStart(range.last) + DAY_MS
        const res = await fetchIntraday(this.deps.fetch, source, key, ticker, from, to)
        if (!res.ok) {
          error = res.message
          this.deps.log?.('warn', `market ${ticker} ${range.first}…${range.last}: ${res.message}`)
          break
        }
        const fetchedAt = new Date(now).toISOString()
        const rangeDays = daysBetween(from, to).filter((d) => need.includes(d))
        for (const [day, bars] of splitByDay(res.bars, rangeDays)) {
          const d: MarketDay = { ticker, day, final: dayIsFinal(day, now), fetchedAt, bars }
          this.memo.set(`${ticker}|${day}`, d)
          have.set(day, d)
          fetchedDays++
          if (cache && !this.deps.readOnly()) await cache.write(d).catch((e) => this.deps.log?.('warn', `market cache ${ticker} ${day}: ${String(e)}`))
        }
        this.deps.log?.('info', `market ${ticker} ${range.first}…${range.last}: ${res.bars.length} bars`)
      }
    }
    const bars: Bar[] = []
    for (const day of days) for (const b of have.get(day)?.bars ?? []) if (b.t >= fromMs && b.t < toMs) bars.push(b)
    const missingDays = days.filter((d) => !have.has(d))
    return error ? { ok: false, message: error, bars, missingDays } : { ok: true, bars, missingDays, fetchedDays }
  }
}
