import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DateTime } from 'luxon'
import { ScannerService, scannerNetwork } from '../../src/main/scanner/service'
import { defaultScannerSettings } from '../../src/shared/scanner/settings'
import { isMarketOpen } from '../../src/shared/scanner/time'
import type { ScannerEvent } from '../../src/shared/scanner/api'
import { startFakeEodhd, type FakeBar, type FakeEodhd } from '../helpers/fakeEodhd'

const ny = (s: string): number => DateTime.fromISO(s, { zone: 'America/New_York' }).toSeconds()
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until(cond: () => boolean | Promise<boolean>, ms = 8000): Promise<void> {
  const end = Date.now() + ms
  while (!(await cond())) {
    if (Date.now() > end) throw new Error('timeout')
    await wait(20)
  }
}

describe('scanner network setting', () => {
  it('EODHD by default, off, or a local test server', () => {
    expect(scannerNetwork(undefined)).toEqual({ restBase: 'https://eodhd.com/api', wsUrl: 'wss://ws.eodhistoricaldata.com/ws/forex' })
    expect(scannerNetwork('off')).toBeNull()
    expect(scannerNetwork('http://127.0.0.1:4567/')).toEqual({ restBase: 'http://127.0.0.1:4567/api', wsUrl: 'ws://127.0.0.1:4567/ws/forex' })
  })
})

describe('ScannerService with a fake EODHD', () => {
  let fake: FakeEodhd
  let dir: string
  let svc: ScannerService
  const events: ScannerEvent[] = []
  // Simulated clock: Wednesday in the New York session, 60× faster than real time.
  const base = ny('2026-10-14T09:00') * 1000
  const start = Date.now()
  const now = () => base + (Date.now() - start) * 60

  beforeAll(async () => {
    fake = await startFakeEodhd()
    dir = await fs.mkdtemp(join(tmpdir(), 'ictj-scanner-'))
    const bars: FakeBar[] = []
    for (let t = base / 1000 - 2 * 86400; t < base / 1000 - 3 * 3600; t += 60) {
      if (isMarketOpen(t)) bars.push({ timestamp: t, open: 1.12, high: 1.1203, low: 1.1197, close: 1.1201 })
    }
    fake.bars.set('EURUSD.FOREX', bars)
    svc = new ScannerService({
      root: dir,
      fetch: (u, i) => fetch(u, i),
      network: { restBase: fake.restBase, wsUrl: `${fake.wsBase}/forex` },
      crypto: { available: () => false, encrypt: () => Buffer.alloc(0), decrypt: () => '' },
      envToken: fake.token,
      log: () => undefined,
      emit: (e) => events.push(e),
      now,
      tickMs: 50,
      backfillEveryMs: 1e9
    })
    await svc.init()
  })
  afterAll(async () => {
    await svc.stop()
    await fake.close()
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('subscribes the planned symbols, fills history, builds M1 from ticks and reports status', async () => {
    const status0 = await svc.configure({ scanner: defaultScannerSettings(), accountCurrency: 'PLN' })
    expect(status0.plan.symbols).toHaveLength(16)
    await until(() => fake.subscriptions.length === 1)
    const sub = JSON.parse(fake.subscriptions[0]!) as { symbols: string }
    expect(sub.symbols.split(',')).toHaveLength(16)
    // Same configuration again: no new subscription.
    await svc.configure({ scanner: defaultScannerSettings(), accountCurrency: 'PLN' })

    await until(async () => {
      const s = await svc.status()
      return !s.backfill.running && s.backfill.finishedAt !== null
    }, 15000)
    const hist = await svc.store.read('EURUSD', 'M1', base / 1000 - 3 * 86400, base / 1000)
    expect(hist.length).toBe(fake.bars.get('EURUSD.FOREX')!.length)
    // WTIUSD has no REST history: never requested.
    expect(fake.requests.some((r) => r.includes('WTIUSD'))).toBe(false)

    // Live ticks for about four simulated minutes.
    const tickStart = now()
    while (now() - tickStart < 4 * 60_000) {
      const t = now()
      fake.tick('EURUSD', 1.13 + ((t / 1000) % 60) / 1e5, 1.1302 + ((t / 1000) % 60) / 1e5, t)
      await wait(40)
    }
    await until(async () => (await svc.store.read('EURUSD', 'M1', tickStart / 1000, now() / 1000)).length >= 3)
    const liveBars = await svc.store.read('EURUSD', 'M1', tickStart / 1000, now() / 1000)
    expect(liveBars.every((b) => b.l >= 1.13 && b.h < 1.131)).toBe(true)
    // Stream coverage reaches the last finished minute.
    const cov = await svc.store.coverage('EURUSD')
    expect(cov.at(-1)!.to).toBeGreaterThanOrEqual(Math.floor(now() / 60_000) * 60 - 120)
    expect(events.some((e) => e.type === 'live' && e.updates.some((u) => u.symbol === 'EURUSD' && u.forming))).toBe(true)

    const status = await svc.status()
    expect(status.stream.state).toBe('live')
    expect(status.key).toMatchObject({ present: true, source: 'env' })
    expect(status.usage.calls).toBeGreaterThan(0)
    const eur = status.symbols.find((s) => s.symbol === 'EURUSD')!
    expect(eur).toMatchObject({ streaming: true, rest: true })
    expect(status.symbols.find((s) => s.symbol === 'WTIUSD')).toMatchObject({ rest: false, streaming: false })
    expect(JSON.stringify(status)).not.toContain(fake.token)
    expect(JSON.stringify(events)).not.toContain(fake.token)
  })

  it('imports a TradingView H1 export for WTI and serves it as a series', async () => {
    const from = ny('2026-10-05T09:00')
    const rows = Array.from({ length: 30 }, (_, i) => `${from + i * 3600},70.1,70.5,69.8,70.2`)
    const result = await svc.importCsv('WTIUSD', ['time,open,high,low,close', ...rows].join('\n'))
    expect(result).toMatchObject({ symbol: 'WTIUSD', interval: 'H1', count: 30 })
    const h4 = await svc.series('WTIUSD', 'H4', from, from + 30 * 3600)
    expect(h4.length).toBeGreaterThan(5)
    expect(h4.every((c) => !c.incomplete || c.t >= from)).toBe(true)
    expect(await svc.gaps('WTIUSD', from, from + 30 * 3600)).toEqual([])
  })
})
