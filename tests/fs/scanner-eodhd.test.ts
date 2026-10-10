import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { DateTime } from 'luxon'
import { EodhdError, EodhdRest, UsageCounter } from '../../src/main/scanner/eodhd/rest'
import { FxStream, type StreamStatus } from '../../src/main/scanner/eodhd/ws'
import { Backfill, requestRanges } from '../../src/main/scanner/backfill'
import { ApiKeyStore, maskKey, type KeyCrypto } from '../../src/main/scanner/apiKey'
import { CandleStore } from '../../src/main/scanner/store'
import type { Tick } from '../../src/shared/scanner/m1'
import { isMarketOpen } from '../../src/shared/scanner/time'
import { startFakeEodhd, type FakeBar, type FakeEodhd } from '../helpers/fakeEodhd'

const ny = (s: string): number => DateTime.fromISO(s, { zone: 'America/New_York' }).toSeconds()
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until(cond: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error('timeout')
    await wait(10)
  }
}

function minuteBars(from: number, to: number, p = 1.1): FakeBar[] {
  const out: FakeBar[] = []
  for (let t = from; t < to; t += 60) {
    if (!isMarketOpen(t)) continue
    out.push({ timestamp: t, open: p, high: p + 0.0003, low: p - 0.0003, close: p + 0.0001 })
  }
  return out
}

let fake: FakeEodhd
beforeAll(async () => {
  fake = await startFakeEodhd()
})
afterAll(() => fake.close())
beforeEach(() => {
  fake.bars.clear()
  fake.failures.clear()
  fake.requests.length = 0
  fake.subscriptions.length = 0
  fake.symbolLimit = 50
})

const restWith = (token: string | null, now = Date.now, usage = new UsageCounter(null)) =>
  new EodhdRest({ fetch: (u, i) => fetch(u, i), base: fake.restBase, token: () => token, usage, minIntervalMs: 0, now, sleep: async () => undefined })

describe('EODHD REST client', () => {
  it('splits a long range into ≤ 100-day requests, counts 5 calls each, returns bars of the range', async () => {
    const from = ny('2026-01-05T00:00')
    const to = from + 250 * 86400
    fake.bars.set('EURUSD.FOREX', [...minuteBars(from, from + 3600), ...minuteBars(to - 3600, to + 3600)])
    const usage = new UsageCounter(null)
    const r = await restWith(fake.token, Date.now, usage).intraday('EURUSD.FOREX', { from, to })
    expect(fake.requests).toHaveLength(3)
    expect(fake.requests[0]).toContain('interval=1m')
    expect(r.candles.length).toBe(minuteBars(from, from + 3600).length + minuteBars(to - 3600, to).length)
    expect(r.candles.every((c) => c.t >= from && c.t < to)).toBe(true)
    expect(usage.get()).toMatchObject({ calls: 15, requests: 3 })
  })

  it('maps errors and never leaks the token', async () => {
    await expect(restWith(null).intraday('EURUSD.FOREX', { from: 0, to: 60 })).rejects.toMatchObject({ kind: 'no-key' })
    expect(fake.requests).toHaveLength(0)
    const bad = restWith('wrong-token-xyz')
    const e = await bad.user().catch((x: unknown) => x)
    expect(e).toBeInstanceOf(EodhdError)
    expect((e as EodhdError).kind).toBe('auth')
    // Unknown symbol (WTIUSD has no REST history): empty, not an error.
    expect((await restWith(fake.token).intraday('WTIUSD.FOREX', { from: 0, to: 600 })).candles).toEqual([])
    fake.failures.set('/api/intraday/BAD.FOREX', 500)
    const http = await restWith(fake.token).intraday('BAD.FOREX', { from: 0, to: 600 }).catch((x: EodhdError) => x)
    expect(http).toMatchObject({ kind: 'http' })
    expect(String((http as Error).message)).not.toContain(fake.token)
    // A network error message that contains the URL (and so the token) is masked.
    const leaky = new EodhdRest({
      fetch: async (url) => {
        throw new Error(`fetch failed for ${url}`)
      },
      base: fake.restBase,
      token: () => fake.token,
      usage: new UsageCounter(null),
      minIntervalMs: 0
    })
    const net = (await leaky.user().catch((x: EodhdError) => x)) as EodhdError
    expect(net).toMatchObject({ kind: 'network' })
    expect(JSON.stringify([net.message, leaky.error()])).not.toContain(fake.token)
  })

  it('daily limit (402) blocks requests until midnight GMT', async () => {
    fake.failures.set('/api/internal-user', 402)
    let now = Date.parse('2026-10-12T15:00:00Z')
    const rest = restWith(fake.token, () => now)
    await expect(rest.user()).rejects.toMatchObject({ kind: 'daily-limit' })
    expect(rest.blocked()).toBe(Date.parse('2026-10-13T00:00:00Z'))
    fake.failures.clear()
    const before = fake.requests.length
    await expect(rest.user()).rejects.toMatchObject({ kind: 'daily-limit' })
    expect(fake.requests.length).toBe(before)
    now = Date.parse('2026-10-13T00:00:01Z')
    expect((await rest.user()).apiRequests).toBe(42)
  })

  it('user details without personal data, symbol list', async () => {
    const rest = restWith(fake.token)
    const u = await rest.user()
    expect(JSON.stringify(u)).not.toMatch(/Test User|example\.com/)
    expect(u).toMatchObject({ subscriptionMode: 'paid', dailyRateLimit: 100000 })
    expect((await rest.symbols('FOREX')).map((s) => s.code)).toEqual(['EURUSD', 'XAUUSD', 'GBPUSD'])
  })

  it('usage counter persists per GMT day', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'ictj-usage-'))
    let now = Date.parse('2026-10-12T23:00:00Z')
    const a = new UsageCounter(join(dir, 'usage.json'), () => now)
    a.add(5)
    a.add(1)
    await wait(50)
    const b = new UsageCounter(join(dir, 'usage.json'), () => now)
    await b.load()
    expect(b.get()).toMatchObject({ date: '2026-10-12', calls: 6, requests: 2 })
    now = Date.parse('2026-10-13T00:30:00Z')
    expect(b.get()).toMatchObject({ date: '2026-10-13', calls: 0 })
    await fs.rm(dir, { recursive: true, force: true })
  })
})

describe('EODHD WebSocket client', () => {
  let stream: FxStream | null = null
  afterEach(() => {
    stream?.stop()
    stream = null
  })

  const make = (token: string | null, extra: Partial<ConstructorParameters<typeof FxStream>[0]> = {}) => {
    const ticks: Tick[] = []
    const statuses: StreamStatus[] = []
    stream = new FxStream({
      url: `${fake.wsBase}/forex`,
      token: () => token,
      onTick: (t) => ticks.push(t),
      onStatus: (s) => statuses.push(s),
      backoffMs: [30, 60],
      ...extra
    })
    return { s: stream, ticks, statuses }
  }

  it('subscribes once with a comma-separated list after "Authorized" and delivers ticks', async () => {
    const { s, ticks } = make(fake.token)
    s.start(['EURUSD', 'XAUUSD'])
    await until(() => s.status().state === 'live' && fake.subscriptions.length === 1)
    expect(JSON.parse(fake.subscriptions[0]!)).toEqual({ action: 'subscribe', symbols: 'EURUSD,XAUUSD' })
    fake.tick('EURUSD', 1.1, 1.1002, Date.now())
    fake.tick('GBPUSD', 1.3, 1.3002, Date.now()) // not subscribed
    await until(() => ticks.length === 1)
    expect(ticks[0]).toMatchObject({ symbol: 'EURUSD', bid: 1.1, ask: 1.1002 })
    expect(s.status().lastLiveTickAt).not.toBeNull()
  })

  it('a rejected key stops without retrying; the token is not in any status', async () => {
    const { s, statuses } = make('bad-token-777')
    s.start(['EURUSD'])
    await until(() => s.status().state === 'auth-failed')
    await wait(150)
    expect(s.status().state).toBe('auth-failed')
    expect(fake.subscriptions).toHaveLength(0)
    expect(JSON.stringify(statuses)).not.toContain('bad-token-777')
  })

  it('reconnects after a drop and subscribes again', async () => {
    const { s } = make(fake.token)
    s.start(['EURUSD'])
    await until(() => fake.subscriptions.length === 1)
    fake.dropConnections()
    await until(() => fake.subscriptions.length === 2)
    expect(s.status()).toMatchObject({ state: 'live', reconnects: 1 })
  })

  it('"Symbols limit reached" waits and retries', async () => {
    fake.symbolLimit = 1
    const { s } = make(fake.token, { limitRetryMs: 80 })
    s.start(['EURUSD', 'XAUUSD'])
    await until(() => s.status().state === 'symbol-limit')
    expect(s.status().message).toMatch(/drugim komputerze/)
    fake.symbolLimit = 50
    await until(() => s.status().state === 'live' && fake.subscriptions.length === 2)
  })

  it('a silent stream during market hours is reconnected', async () => {
    let now = Date.now()
    const { s } = make(fake.token, { now: () => now, marketOpen: () => true, silenceMs: 1000 })
    s.start(['EURUSD'])
    await until(() => s.status().state === 'live')
    s.checkHealth()
    expect(fake.subscriptions).toHaveLength(1)
    now += 5000
    s.checkHealth()
    await until(() => fake.subscriptions.length === 2)
    // Closed market: silence is normal.
    const closed = make(fake.token, { now: () => now, marketOpen: () => false, silenceMs: 1000 })
    closed.s.start(['XAUUSD'])
    await until(() => closed.s.status().state === 'live')
    now += 60_000
    closed.s.checkHealth()
    expect(closed.s.status().reconnects).toBe(0)
    closed.s.stop()
  })
})

describe('backfill', () => {
  let dir: string
  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'ictj-backfill-'))
  })
  afterEach(() => fs.rm(dir, { recursive: true, force: true }))

  it('groups gaps into request ranges', () => {
    expect(requestRanges([{ from: 0, to: 10 }, { from: 20, to: 30 }, { from: 200, to: 260 }], 100)).toEqual([
      { from: 0, to: 30 },
      { from: 200, to: 260 }
    ])
    expect(requestRanges([{ from: 0, to: 250 }], 100)).toEqual([
      { from: 0, to: 100 },
      { from: 100, to: 200 },
      { from: 200, to: 250 }
    ])
  })

  it('fills the store in stages, covers old empty ranges, retries only the recent tail, skips WTI', async () => {
    const now = ny('2026-10-14T12:00')
    const lastBar = now - 3 * 3600 // REST three hours behind
    fake.bars.set('EURUSD.FOREX', minuteBars(now - 20 * 86400, lastBar))
    const store = new CandleStore(dir, 10)
    const rest = restWith(fake.token, () => now * 1000)
    const bf = new Backfill({ store, rest, now: () => now * 1000 })
    await bf.run([
      { symbol: 'EURUSD', rest: 'EURUSD.FOREX', depthDays: 400 },
      { symbol: 'WTIUSD', rest: null, depthDays: 400 }
    ])
    expect(bf.state()).toMatchObject({ running: false, errors: {} })
    const bars = await store.read('EURUSD', 'M1', now - 21 * 86400, now)
    expect(bars.length).toBe(fake.bars.get('EURUSD.FOREX')!.length)
    // Only the not-yet-published tail is still a gap.
    const gaps = await store.gaps('EURUSD', now - 400 * 86400, Math.floor(now / 60) * 60)
    expect(gaps).toEqual([{ from: lastBar, to: Math.floor(now / 60) * 60 }])
    expect(fake.requests.every((r) => r.includes('EURUSD'))).toBe(true)
    const firstRun = fake.requests.length
    await bf.run([{ symbol: 'EURUSD', rest: 'EURUSD.FOREX', depthDays: 400 }])
    expect(fake.requests.length - firstRun).toBeLessThanOrEqual(3)
    await store.flush()
  })

  it('stops the whole run on a rejected key', async () => {
    const now = ny('2026-10-14T12:00')
    const store = new CandleStore(dir, 10)
    const bf = new Backfill({ store, rest: restWith('wrong-token-1'), now: () => now * 1000 })
    await bf.run([
      { symbol: 'EURUSD', rest: 'EURUSD.FOREX', depthDays: 30 },
      { symbol: 'XAUUSD', rest: 'XAUUSD.FOREX', depthDays: 30 }
    ])
    expect(Object.keys(bf.state().errors)).toEqual(['EURUSD'])
    expect(fake.requests).toHaveLength(1)
  })
})

describe('API key store', () => {
  let dir: string
  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'ictj-key-'))
  })
  afterEach(() => fs.rm(dir, { recursive: true, force: true }))

  const crypto = (available = true): KeyCrypto => ({
    available: () => available,
    encrypt: (s) => Buffer.from([...Buffer.from(s)].map((b) => b ^ 0x5a)),
    decrypt: (b) => Buffer.from([...b].map((x) => x ^ 0x5a)).toString()
  })

  it('stores the key encrypted, reloads it, masks it, clears it', async () => {
    const path = join(dir, 'scanner', 'key.bin')
    const a = new ApiKeyStore(path, crypto())
    expect(await a.set('  65f8a1b2c3d4e5.12345678 ')).toMatchObject({ present: true, source: 'stored', persisted: true, masked: '65f8…5678' })
    expect((await fs.readFile(path)).toString()).not.toContain('65f8a1b2')
    const b = new ApiKeyStore(path, crypto())
    await b.load()
    expect(b.get()).toBe('65f8a1b2c3d4e5.12345678')
    await b.clear()
    const c = new ApiKeyStore(path, crypto())
    await c.load()
    expect(c.get()).toBeNull()
    expect(maskKey('abc')).toBe('****')
  })

  it('without encryption keeps the key for the session only; env overrides; bad format rejected', async () => {
    const path = join(dir, 'key.bin')
    const a = new ApiKeyStore(path, crypto(false))
    expect(await a.set('abcdefgh1234')).toMatchObject({ source: 'session', persisted: false })
    await expect(fs.access(path)).rejects.toThrow()
    await expect(a.set('bad key!')).rejects.toThrow(/format/)
    const env = new ApiKeyStore(path, crypto(), 'from-env-1234')
    await env.load()
    expect(env.state()).toMatchObject({ source: 'env', present: true })
  })
})
