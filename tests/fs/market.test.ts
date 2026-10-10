import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MARKET_DIR } from '@shared/market'
import { isIgnoredPath } from '@shared/paths'
import { MarketCache } from '../../src/main/market/cache'
import { fetchMarketUser, marketSource } from '../../src/main/market/eodhd'
import { MarketService } from '../../src/main/market/service'
import { startMarketServer, syntheticBars, type MarketServer } from '../helpers/market'
import { tempDir } from './helpers'

const KEY = 'test-key-1234'
const nodeFetch = (url: string, init?: RequestInit) => fetch(url, init)
const ms = (iso: string) => Date.parse(iso)

let server: MarketServer | null = null
afterEach(async () => {
  await server?.close()
  server = null
})

function service(root: string | null, opts: { key?: string | null; now?: string; readOnly?: boolean } = {}) {
  const logs: string[] = []
  const svc = new MarketService({
    fetch: nodeFetch,
    source: () => marketSource(server!.url),
    key: () => (opts.key === undefined ? KEY : opts.key),
    root: () => root,
    readOnly: () => !!opts.readOnly,
    now: () => ms(opts.now ?? '2026-10-10T12:00:00Z'),
    log: (_l, m) => logs.push(m)
  })
  return { svc, logs }
}

describe('dane rynkowe: pobieranie i pamięć podręczna w folderze danych', () => {
  it('brakujące dni pobierane jednym zapytaniem, zapisane w .market/ (gzip), drugi raz z dysku bez sieci', async () => {
    server = await startMarketServer({ key: KEY })
    const root = tempDir()
    const { svc } = service(root)
    const from = ms('2026-09-21T10:00:00Z')
    const to = ms('2026-09-23T14:00:00Z')
    const r = await svc.bars('EURUSD.FOREX', from, to)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.fetchedDays).toBe(3)
    expect(r.missingDays).toEqual([])
    expect(r.bars.length).toBe((to - from) / 60_000)
    expect(r.bars[0]!.t).toBe(from)
    // One request for the three days (whole days).
    expect(server.requests.filter((q) => q.path.startsWith('/api/intraday'))).toEqual([
      { path: '/api/intraday/EURUSD.FOREX', from: ms('2026-09-21T00:00:00Z') / 1000, to: ms('2026-09-24T00:00:00Z') / 1000 - 1 }
    ])
    const file = join(root, MARKET_DIR, 'EURUSD.FOREX', '2026', '2026-09-22.json.gz')
    expect((await fs.stat(file)).size).toBeLessThan(30_000)
    // The cache is hidden from the scan, the watcher and ZIP backups.
    expect(isIgnoredPath(`${MARKET_DIR}/EURUSD.FOREX/2026/2026-09-22.json.gz`)).toBe(true)

    // A new session (another computer with the synced folder): bars from disk, no request, also without a key.
    const before = server.requests.length
    const again = await service(root, { key: null }).svc.bars('EURUSD.FOREX', from, to)
    expect(again).toMatchObject({ ok: true, fetchedDays: 0, missingDays: [] })
    if (again.ok) expect(again.bars).toEqual(r.bars)
    expect(server.requests.length).toBe(before)
    // Same values as the source.
    const src = syntheticBars('EURUSD.FOREX', from / 1000, from / 1000 + 60)[0]!
    expect(r.bars[0]).toEqual({ t: from, open: src.open, high: src.high, low: src.low, close: src.close })
  })

  it('dzień jeszcze trwający: pobierany ponownie najwyżej co 2 min, po zamknięciu ostateczny', async () => {
    server = await startMarketServer({ key: KEY })
    const root = tempDir()
    const from = ms('2026-10-10T08:00:00Z')
    const to = ms('2026-10-10T09:00:00Z')
    await service(root, { now: '2026-10-10T12:00:00Z' }).svc.bars('EURUSD.FOREX', from, to)
    const count = () => server!.requests.filter((q) => q.path.startsWith('/api/intraday')).length
    expect(count()).toBe(1)
    await service(root, { now: '2026-10-10T12:01:00Z' }).svc.bars('EURUSD.FOREX', from, to)
    expect(count()).toBe(1)
    await service(root, { now: '2026-10-10T12:03:00Z' }).svc.bars('EURUSD.FOREX', from, to)
    expect(count()).toBe(2)
    // The next day, once settled: final, never again.
    await service(root, { now: '2026-10-11T04:00:00Z' }).svc.bars('EURUSD.FOREX', from, to)
    expect(count()).toBe(3)
    await service(root, { now: '2026-10-20T04:00:00Z' }).svc.bars('EURUSD.FOREX', from, to)
    expect(count()).toBe(3)
    // Days that have not started are not asked for.
    await service(root, { now: '2026-10-20T04:00:00Z' }).svc.bars('EURUSD.FOREX', ms('2026-10-20T03:00:00Z'), ms('2026-10-22T00:00:00Z'))
    expect(server.requests.at(-1)).toMatchObject({ to: ms('2026-10-21T00:00:00Z') / 1000 - 1 })
  })

  it('bez klucza / offline: tylko z dysku, brakujące dni podane; błędy po polsku i bez klucza w treści', async () => {
    server = await startMarketServer({ key: KEY })
    const root = tempDir()
    const from = ms('2026-09-22T10:00:00Z')
    const to = ms('2026-09-22T11:00:00Z')
    expect(await service(root, { key: null }).svc.bars('EURUSD.FOREX', from, to)).toEqual({ ok: true, bars: [], missingDays: ['2026-09-22'], fetchedDays: 0 })
    expect(await service(root).svc.bars('EURUSD.FOREX', from, to, { offline: true })).toMatchObject({ ok: true, missingDays: ['2026-09-22'] })
    const { svc, logs } = service(root, { key: 'zly-klucz-0000' })
    const bad = await svc.bars('EURUSD.FOREX', from, to)
    expect(bad).toMatchObject({ ok: false, message: 'EODHD odrzucił klucz API (nieprawidłowy albo wygasły)', missingDays: ['2026-09-22'] })
    const unknown = await service(root).svc.bars('WTI.FOREX', from, to)
    expect(unknown).toMatchObject({ ok: false, message: 'EODHD nie zna tego symbolu' })
    expect(logs.join('\n')).not.toContain('zly-klucz')
    expect(await fetchMarketUser(nodeFetch, marketSource(server.url), KEY)).toEqual({ ok: true, requests: expect.any(Number), dailyLimit: 100000, plan: 'monthly' })
    expect(await fetchMarketUser(nodeFetch, marketSource(server.url), 'zly-klucz-0000')).toEqual({ ok: false, message: 'EODHD odrzucił klucz API (nieprawidłowy albo wygasły)' })
    expect(await fetchMarketUser(nodeFetch, marketSource('off'), KEY)).toEqual({ ok: false, message: 'połączenie z EODHD jest wyłączone' })
    // A server that does not answer.
    expect(await fetchMarketUser(nodeFetch, marketSource('http://127.0.0.1:9'), KEY)).toEqual({ ok: false, message: 'brak połączenia z internetem albo serwer EODHD nie odpowiada' })
  })

  it('folder tylko do odczytu: dane w pamięci, nic na dysku; uszkodzony plik dnia pobierany od nowa; statystyki i czyszczenie', async () => {
    server = await startMarketServer({ key: KEY })
    const root = tempDir()
    const from = ms('2026-09-22T10:00:00Z')
    const to = ms('2026-09-22T11:00:00Z')
    const ro = await service(root, { readOnly: true }).svc.bars('EURUSD.FOREX', from, to)
    expect(ro).toMatchObject({ ok: true, fetchedDays: 1 })
    await expect(fs.stat(join(root, MARKET_DIR))).rejects.toThrow()

    await service(root).svc.bars('EURUSD.FOREX', from, to)
    const cache = new MarketCache(root)
    const file = cache.file('EURUSD.FOREX', '2026-09-22')
    await fs.writeFile(file, 'zepsute')
    expect(await cache.read('EURUSD.FOREX', '2026-09-22')).toBeNull()
    const fixed = await service(root).svc.bars('EURUSD.FOREX', from, to)
    expect(fixed).toMatchObject({ ok: true, fetchedDays: 1 })
    await service(root).svc.bars('GBPUSD.FOREX', from, to)
    const st = await cache.stats()
    expect(st).toMatchObject({ days: 2, tickers: ['EURUSD.FOREX', 'GBPUSD.FOREX'] })
    expect(st.bytes).toBeGreaterThan(0)
    expect(() => cache.file('../x', '2026-09-22')).toThrow()
    await cache.clear()
    expect(await cache.stats()).toEqual({ bytes: 0, days: 0, tickers: [] })
  })
})
