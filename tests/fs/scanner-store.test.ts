import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DateTime } from 'luxon'
import { CandleStore, decodeCandles, encodeCandles, mergeCandles, subtractRanges, unionRanges } from '../../src/main/scanner/store'
import type { Candle } from '../../src/shared/scanner/types'

const ny = (s: string): number => DateTime.fromISO(s, { zone: 'America/New_York' }).toSeconds()
const bar = (t: number, p = 1.1): Candle => ({ t, o: p, h: p + 0.0005, l: p - 0.0005, c: p + 0.0001 })
const minutes = (from: number, n: number, p = 1.1): Candle[] => Array.from({ length: n }, (_, i) => bar(from + i * 60, p + i * 1e-5))

let dir: string
let store: CandleStore

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'ictj-candles-'))
  store = new CandleStore(dir, 10)
})
afterEach(async () => {
  await store.flush()
  await fs.rm(dir, { recursive: true, force: true })
})

describe('binary format and range helpers', () => {
  it('round-trips full float64 precision and ignores a torn last record', () => {
    const c = [{ t: 1791147600, o: 4195.81887, h: 4196.0000001, l: 4100.123456789, c: 4150.5 }]
    const buf = encodeCandles(c)
    expect(decodeCandles(buf)).toEqual(c)
    expect(decodeCandles(Buffer.concat([buf, Buffer.alloc(10)]))).toEqual(c)
    expect(decodeCandles(Buffer.from('not ours at all, nope'))).toBeNull()
  })

  it('union, subtraction and merge', () => {
    expect(unionRanges([{ from: 5, to: 8 }, { from: 0, to: 2 }, { from: 2, to: 4 }, { from: 7, to: 9 }])).toEqual([
      { from: 0, to: 4 },
      { from: 5, to: 9 }
    ])
    expect(subtractRanges([{ from: 0, to: 10 }], [{ from: 2, to: 4 }, { from: 6, to: 7 }])).toEqual([
      { from: 0, to: 2 },
      { from: 4, to: 6 },
      { from: 7, to: 10 }
    ])
    const a = [bar(60, 1), bar(120, 1)]
    const b = [bar(120, 2), bar(180, 2)]
    expect(mergeCandles(a, b, false).map((x) => x.o)).toEqual([1, 1, 2])
    expect(mergeCandles(a, b, true).map((x) => x.o)).toEqual([1, 2, 2])
  })
})

describe('CandleStore', () => {
  it('writes across month files and reads any range', async () => {
    const start = Date.UTC(2026, 8, 30, 23, 50) / 1000 // 30 Sep 23:50 UTC → crosses into October
    await store.write('EURUSD', 'M1', minutes(start, 20), true)
    expect((await fs.readdir(join(dir, 'EURUSD', 'm1'))).sort()).toEqual(['2026-09.bin', '2026-10.bin'])
    const r = await store.read('EURUSD', 'M1', start + 5 * 60, start + 15 * 60)
    expect(r.map((c) => (c.t - start) / 60)).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14])
  })

  it('appends live bars, falls back to merge for older ones, recovers from a torn record', async () => {
    const t = ny('2026-10-13T09:30')
    await store.appendLive('EURUSD', bar(t))
    await store.appendLive('EURUSD', bar(t + 60))
    await store.appendLive('EURUSD', bar(t - 60)) // late: merged into place
    expect((await store.read('EURUSD', 'M1', t - 600, t + 600)).map((c) => c.t)).toEqual([t - 60, t, t + 60])
    // Simulate a crash in the middle of an append, then a new process.
    const file = join(dir, 'EURUSD', 'm1', '2026-10.bin')
    await fs.appendFile(file, Buffer.alloc(7))
    const again = new CandleStore(dir, 10)
    await again.appendLive('EURUSD', bar(t + 120))
    expect((await again.read('EURUSD', 'M1', t - 600, t + 600)).map((c) => c.t)).toEqual([t - 60, t, t + 60, t + 120])
    expect(((await fs.stat(file)).size - 16) % 36).toBe(0)
  })

  it('REST data overrides stream bars of the same minute only when asked', async () => {
    const t = ny('2026-10-13T09:30')
    await store.write('EURUSD', 'M1', [bar(t, 1.1)], true)
    await store.write('EURUSD', 'M1', [bar(t, 1.2)], false)
    expect((await store.read('EURUSD', 'M1', t, t + 60))[0]!.o).toBe(1.1)
    await store.write('EURUSD', 'M1', [bar(t, 1.3)], true)
    expect((await store.read('EURUSD', 'M1', t, t + 60))[0]!.o).toBe(1.3)
  })

  it('coverage gives gaps only inside market hours and survives a restart', async () => {
    const from = ny('2026-10-08T00:00')
    const to = ny('2026-10-13T00:00')
    await store.addCoverage('EURUSD', 'M1', { from: ny('2026-10-08T00:00'), to: ny('2026-10-09T12:00') })
    await store.addCoverage('EURUSD', 'M1', { from: ny('2026-10-11T17:00'), to: ny('2026-10-12T08:00') })
    const gaps = await store.gaps('EURUSD', from, to)
    const fmt = (t: number) => DateTime.fromSeconds(t, { zone: 'America/New_York' }).toFormat('ccc HH:mm')
    // Weekend (Fri 17:00 → Sun 17:00) is not a gap.
    expect(gaps.map((g) => `${fmt(g.from)}–${fmt(g.to)}`)).toEqual(['Fri 12:00–Fri 17:00', 'Mon 08:00–Tue 00:00'])
    await store.flush()
    const again = new CandleStore(dir, 10)
    expect(await again.gaps('EURUSD', from, to)).toEqual(gaps)
  })

  it('series: H1/H4/D from M1, imported H1 fills hours without M1, incomplete marks gaps', async () => {
    const day = ny('2026-10-12T17:00') // Tuesday's trading day
    // M1 for the first 12 hours, imported H1 for the whole day.
    const m1 = minutes(day, 12 * 60)
    await store.write('WTIUSD', 'M1', m1, true)
    await store.addCoverage('WTIUSD', 'M1', { from: day, to: day + 12 * 3600 })
    const h1 = Array.from({ length: 24 }, (_, i) => bar(day + i * 3600, 70 + i))
    await store.write('WTIUSD', 'H1', h1, true)
    await store.addCoverage('WTIUSD', 'H1', { from: day, to: day + 24 * 3600 })
    const s = await store.series('WTIUSD', 'H1', day, day + 24 * 3600)
    expect(s).toHaveLength(24)
    expect(s[0]!.o).toBe(m1[0]!.o) // from M1
    expect(s[12]!.o).toBe(70 + 12) // from the import
    expect(s.some((c) => c.incomplete)).toBe(false)
    const d = await store.series('WTIUSD', 'D', day, day + 24 * 3600)
    expect(d).toHaveLength(1)
    expect(d[0]!.c).toBe(h1[23]!.c)
    // M15 has no import: the second half of the day is a gap (no candles there, shown as a gap on the chart).
    const m15 = await store.series('WTIUSD', 'M15', day, day + 24 * 3600)
    expect(m15).toHaveLength(48)
    expect(await store.gaps('WTIUSD', day, day + 24 * 3600)).toEqual([{ from: day + 12 * 3600, to: day + 24 * 3600 }])
    // A candle that straddles the end of the coverage is incomplete.
    await store.write('WTIUSD', 'M1', minutes(day + 12 * 3600, 10, 71), true)
    const partial = await store.series('WTIUSD', 'M15', day, day + 24 * 3600)
    expect(partial.at(-1)).toMatchObject({ t: day + 12 * 3600, incomplete: true })
    expect(partial.at(-2)!.incomplete).toBeUndefined()
  })

  it('flush waits for a background index write already in progress', async () => {
    const fast = new CandleStore(dir, 0)
    await fast.addCoverage('EURUSD', 'M1', { from: 0, to: 60 })
    await new Promise((r) => setTimeout(r, 1)) // the timer fired: its write is running
    await fast.flush()
    // Resolved flush = the index is on disk (the caller may remove the folder right away).
    expect(JSON.parse(await fs.readFile(join(dir, 'EURUSD', 'index.json'), 'utf8')).m1).toEqual([{ from: 0, to: 60 }])
    await fast.clear()
    expect(await fs.readdir(dir)).toEqual([])
  })

  it('reports usage and clears a symbol', async () => {
    const t = ny('2026-10-13T09:30')
    await store.write('EURUSD', 'M1', minutes(t, 100), true)
    await store.write('XAUUSD', 'M1', minutes(t, 10, 4000), true)
    await store.addCoverage('EURUSD', 'M1', { from: t, to: t + 6000 })
    const u = await store.usage()
    expect(u.map((x) => [x.symbol, x.bytes])).toEqual([
      ['EURUSD', 16 + 100 * 36],
      ['XAUUSD', 16 + 10 * 36]
    ])
    expect(u[0]).toMatchObject({ from: t, to: t + 6000 })
    await store.clear('EURUSD')
    expect((await store.usage()).map((x) => x.symbol)).toEqual(['XAUUSD'])
    expect(await store.read('EURUSD', 'M1', t, t + 6000)).toEqual([])
  })
})
