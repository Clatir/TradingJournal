/**
 * Bar cache in the data folder: `.market/<TICKER>/<YYYY>/<YYYY-MM-DD>.json.gz` (one UTC day, `encodeMarketDay`).
 * The leading dot keeps it out of the scan, the watcher and ZIP backups; it syncs with the folder, so the other
 * computer has the bars offline. Written atomically; an unreadable file is fetched again.
 */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import { MARKET_DIR, decodeMarketDay, encodeMarketDay, type MarketCacheStats, type MarketDay } from '@shared/market'
import { writeFileAtomic } from '../datastore/atomic'

const SAFE_TICKER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,40}$/

export class MarketCache {
  constructor(readonly root: string) {}

  get dir(): string {
    return join(this.root, MARKET_DIR)
  }

  file(ticker: string, day: string): string {
    if (!SAFE_TICKER.test(ticker) || ticker.includes('..') || !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`Niepoprawny symbol lub dzień: ${ticker} ${day}`)
    return join(this.dir, ticker, day.slice(0, 4), `${day}.json.gz`)
  }

  async read(ticker: string, day: string): Promise<MarketDay | null> {
    try {
      const d = decodeMarketDay(gunzipSync(await fs.readFile(this.file(ticker, day))).toString('utf8'))
      return d && d.ticker === ticker && d.day === day ? d : null
    } catch {
      return null
    }
  }

  async write(d: MarketDay): Promise<void> {
    const target = this.file(d.ticker, d.day)
    await fs.mkdir(join(target, '..'), { recursive: true })
    await writeFileAtomic(target, gzipSync(Buffer.from(encodeMarketDay(d), 'utf8'), { level: 9 }))
  }

  async stats(): Promise<MarketCacheStats> {
    const out: MarketCacheStats = { bytes: 0, days: 0, tickers: [] }
    let tickers: string[]
    try {
      tickers = (await fs.readdir(this.dir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name)
    } catch {
      return out
    }
    for (const t of tickers.sort()) {
      let any = false
      for (const y of await fs.readdir(join(this.dir, t)).catch(() => [] as string[])) {
        for (const f of await fs.readdir(join(this.dir, t, y)).catch(() => [] as string[])) {
          if (!f.endsWith('.json.gz')) continue
          const st = await fs.stat(join(this.dir, t, y, f)).catch(() => null)
          if (!st) continue
          out.bytes += st.size
          out.days++
          any = true
        }
      }
      if (any) out.tickers.push(t)
    }
    return out
  }

  async clear(): Promise<void> {
    await fs.rm(this.dir, { recursive: true, force: true })
  }
}
