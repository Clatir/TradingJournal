/**
 * Against the real EODHD, only when EODHD_API_TOKEN is set (locally; CI has no key): fetches one past day of EURUSD,
 * checks the cache round trip and measures a trade. Asserts only properties – no market data is stored in the repo.
 */
import { describe, expect, it } from 'vitest'
import { createTrade } from '@shared/defaults'
import { marketStatsFor } from '@shared/calc/marketStats'
import { MarketService } from '../../src/main/market/service'
import { fetchMarketUser, marketSource } from '../../src/main/market/eodhd'
import { tempDir } from './helpers'

const KEY = process.env.EODHD_API_TOKEN?.trim()

describe.skipIf(!KEY)('EODHD na żywo (tylko z kluczem w środowisku)', () => {
  it('konto, jeden dzień EURUSD M1, zapis i odczyt z dysku, pomiar transakcji', { timeout: 60_000 }, async () => {
    const source = marketSource(undefined)
    const fetchFn = (url: string, init?: RequestInit) => fetch(url, init)
    const user = await fetchMarketUser(fetchFn, source, KEY!)
    expect(user.ok).toBe(true)
    const root = tempDir()
    const svc = new MarketService({ fetch: fetchFn, source: () => source, key: () => KEY!, root: () => root, readOnly: () => false })
    const from = Date.parse('2026-09-22T00:00:00Z')
    const to = Date.parse('2026-09-23T00:00:00Z')
    const r = await svc.bars('EURUSD.FOREX', from, to)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.bars.length).toBeGreaterThan(1300)
    const offline = await new MarketService({ fetch: fetchFn, source: () => source, key: () => null, root: () => root, readOnly: () => false }).bars('EURUSD.FOREX', from, to)
    expect(offline.ok && offline.bars).toEqual(r.bars)
    // A short closed at its target in the afternoon: the target is reached, MAE ≤ 0 ≤ MFE.
    const close = r.bars.find((b) => b.t === Date.parse('2026-09-22T13:10:00Z'))!.close
    const t = createTrade({
      pair: 'EURUSD',
      direction: 'short',
      status: 'closed',
      entryTime: '2026-09-22T13:10:13.000Z',
      prices: { entry: close, stopLoss: close + 0.002, takeProfit1: null, takeProfit2: null },
      exits: [{ id: '01K6H3Z0W8Q4M2N5P7R9S1T3V5', time: '2026-09-22T15:05:20.000Z', price: close - 0.001, percent: 100, note: '' }]
    })
    const m = marketStatsFor(t, r.bars, { ticker: 'EURUSD.FOREX', pipSize: 0.0001, marginPips: 1, now: new Date().toISOString() })
    expect(m.maePips).not.toBeNull()
    expect(m.maePips!).toBeLessThanOrEqual(0)
    expect(m.mfePips!).toBeGreaterThanOrEqual(0)
    expect(m.warnings).toEqual([])
  })
})
