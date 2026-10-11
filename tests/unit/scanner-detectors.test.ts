import { describe, expect, it } from 'vitest'
import { DateTime } from 'luxon'
import { IntervalEngine } from '@shared/scanner/detectors/interval'
import { LevelSources, rankPools } from '@shared/scanner/detectors/levels'
import { defaultDetectorParams } from '@shared/scanner/detectors/params'
import type { EngineSnapshot } from '@shared/scanner/detectors/types'
import { SymbolEngine, analyzeSeries } from '@shared/scanner/engine'
import { Aggregator, aggregate } from '@shared/scanner/aggregate'
import { bucketEnd, bucketStart, isMarketOpen } from '@shared/scanner/time'
import { inWindow, windowRange, currentOrNextWindow } from '@shared/scanner/windows'
import type { Candle, Interval, SeriesCandle } from '@shared/scanner/types'

const PIP = 0.0001
const ny = (s: string): number => DateTime.fromISO(s, { zone: 'America/New_York' }).toSeconds()
const START = ny('2026-10-13T00:00') // Tuesday
/** Price `x` pips above 1.1000. */
const px = (x: number): number => Math.round((1.1 + x * PIP) * 1e6) / 1e6
const STEP: Record<Interval, number> = { M1: 60, M5: 300, M15: 900, H1: 3600, H4: 14400, D: 86400, W: 5 * 86400 }

/** Candles from [open, high, low, close] rows in pips above 1.1000. */
function bars(rows: readonly (readonly number[])[], interval: Interval = 'H1', start = START): SeriesCandle[] {
  return rows.map(([o, h, l, c], i) => ({ t: start + i * STEP[interval], end: start + (i + 1) * STEP[interval], o: px(o!), h: px(h!), l: px(l!), c: px(c!) }))
}

function run(rows: readonly (readonly number[])[], interval: Interval = 'H1'): IntervalEngine {
  const e = new IntervalEngine(interval, PIP, defaultDetectorParams())
  for (const c of bars(rows, interval)) e.push(c)
  return e
}

/** 1-pip bodies alternating: no swings (equal highs and lows), average body = 1 pip. */
const quiet = (n: number) => Array.from({ length: n }, (_, i) => (i % 2 ? [1, 2, -1, 0] : [0, 2, -1, 1]))

describe('swings', () => {
  it('a 3-candle swing high is confirmed by the candle to its right', () => {
    const e = run([[0, 5, -5, 2], [2, 10, 0, 8]])
    expect(e.swings).toEqual([])
    e.push(bars([[8, 9, 3, 4]], 'H1', START + 2 * 3600)[0]!)
    expect(e.swings).toHaveLength(1)
    expect(e.swings[0]).toMatchObject({ kind: 'high', price: px(10), at: START + 3600, createdAt: START + 2 * 3600, cls: 'ST', takenAt: null })
    expect(e.pools[0]).toMatchObject({ kind: 'SWING_H', side: 'BSL', price: px(10), label: '60 swing H', state: 'untouched' })
  })

  it('equal highs do not make a swing (strict comparison)', () => {
    expect(run([[0, 10, -5, 2], [2, 10, 0, 8], [8, 9, 3, 4]]).swings).toEqual([])
  })

  it('a swing standing out from both neighbours becomes intermediate', () => {
    const e = run([[0, 5, -5, 2], [2, 10, 0, 8], [8, 9, 3, 4], [4, 6, 1, 2], [2, 20, 1, 18], [13, 14, 10, 12], [12, 15, 8, 14], [14, 14, 5, 6]])
    const highs = e.swings.filter((s) => s.kind === 'high').map((s) => [s.price, s.cls])
    expect(highs).toEqual([
      [px(10), 'ST'],
      [px(20), 'IT'],
      [px(15), 'ST']
    ])
  })
})

describe('EQH / EQL', () => {
  const base = [[0, 5, -5, 2], [2, 10, 0, 8], [8, 9, 3, 4], [4, 6, 1, 5]]
  it('two swing highs within 3 pips on H1 form an EQH at the higher one', () => {
    const e = run([...base, [5, 12, 2, 9], [9, 10, 3, 4]])
    const eq = e.pools.filter((p) => p.kind === 'EQH')
    expect(eq).toHaveLength(1)
    expect(eq[0]).toMatchObject({ price: px(12), side: 'BSL', at: START + 4 * 3600, label: '60 EQH' })
  })
  it('further apart than the tolerance: no EQH', () => {
    expect(run([...base, [5, 20, 2, 9], [9, 10, 3, 4]]).pools.filter((p) => p.kind === 'EQH')).toEqual([])
  })
  it('a higher high between them breaks the pair', () => {
    const e = run([[0, 5, -5, 2], [2, 10, 0, 8], [8, 9, 3, 4], [4, 30, 1, 5], [5, 12, 2, 9], [9, 10, 3, 4]])
    expect(e.pools.filter((p) => p.kind === 'EQH')).toEqual([])
  })
})

describe('sweep', () => {
  const setup = [[0, 5, -5, 2], [2, 10, 0, 8], [8, 9, 3, 4]] // swing high 10 → pool
  it('wick beyond the pool and a close back inside on the same candle', () => {
    const e = run([...setup, [4, 16, 2, 5]])
    expect(e.sweeps).toHaveLength(1)
    expect(e.sweeps[0]).toMatchObject({ poolKind: 'SWING_H', side: 'BSL', level: px(10), extreme: px(16), at: START + 3 * 3600, closedBackAt: START + 3 * 3600 })
    expect(e.pools[0]).toMatchObject({ state: 'taken', takenAt: START + 3 * 3600 })
    expect(e.swings[0]!.takenAt).toBe(START + 3 * 3600)
  })
  it('close back within K = 3 candles, extreme = highest wick meanwhile', () => {
    const e = run([...setup, [4, 16, 2, 12], [12, 18, 8, 11], [11, 12, 8, 9]])
    expect(e.sweeps).toHaveLength(1)
    expect(e.sweeps[0]).toMatchObject({ extreme: px(18), at: START + 3 * 3600, closedBackAt: START + 5 * 3600 })
  })
  it('closes beyond for more than K candles = breakout, not a sweep', () => {
    const e = run([...setup, [4, 16, 2, 12], [12, 13, 11, 12], [12, 13, 11, 12], [12, 13, 11, 12], [12, 13, 5, 6]])
    expect(e.sweeps).toEqual([])
    expect(e.pools[0]!.state).toBe('taken')
  })
  it('a wick less than 0.5 pip beyond does not count', () => {
    expect(run([...setup, [4, 10.3, 2, 5]]).sweeps).toEqual([])
  })
})

describe('FVG', () => {
  it('bullish FVG with CE, minimum size per interval, state progression', () => {
    const e = run([[0, 5, -5, 2], [2, 20, 1, 18], [18, 22, 12, 20]])
    expect(e.fvgs).toHaveLength(1)
    const f = e.fvgs[0]!
    expect(f).toMatchObject({ dir: 'bull', top: px(12), bottom: px(5), sizePips: 7, state: 'open', at: START + 2 * 3600 })
    expect(f.ce).toBeCloseTo(px(8.5), 9)
    const t = (i: number) => START + i * 3600
    e.push(bars([[20, 21, 11, 19]], 'H1', t(3))[0]!)
    expect(f).toMatchObject({ state: 'touched', touchedAt: t(3), ceAt: null })
    e.push(bars([[19, 20, 8, 18]], 'H1', t(4))[0]!)
    expect(f).toMatchObject({ state: 'ce', ceAt: t(4) })
    e.push(bars([[18, 19, 4, 10]], 'H1', t(5))[0]!)
    expect(f).toMatchObject({ state: 'filled', filledAt: t(5), invertedAt: null })
    e.push(bars([[10, 11, 2, 3]], 'H1', t(6))[0]!)
    expect(f).toMatchObject({ state: 'inverted', invertedAt: t(6) })
  })
  it('too small for the interval: none (3 pips on H1, minimum 4)', () => {
    expect(run([[0, 5, -5, 2], [2, 20, 1, 18], [18, 22, 8, 20]]).fvgs).toEqual([])
    expect(run([[0, 5, -5, 2], [2, 20, 1, 18], [18, 22, 8, 20]], 'M15').fvgs).toHaveLength(1)
  })
  it('bearish FVG mirrors', () => {
    const e = run([[20, 25, 15, 18], [18, 19, 0, 2], [2, 8, -5, 4]])
    expect(e.fvgs[0]).toMatchObject({ dir: 'bear', top: px(15), bottom: px(8), sizePips: 7 })
  })
})

describe('displacement', () => {
  it('two bull candles with bodies 18× the average that leave an FVG', () => {
    const e = run([...quiet(26), [0, 12, -1, 11], [11, 20, 13, 18]])
    expect(e.displacements).toHaveLength(1)
    const d = e.displacements[0]!
    expect(d).toMatchObject({ dir: 'bull', from: START + 26 * 3600, to: START + 27 * 3600 })
    expect(d.bodySum).toBeCloseTo(18 * PIP, 9)
    expect(d.ratio).toBeCloseTo(18, 5)
    expect(d.fvgId).toBe(e.fvgs[0]!.id)
  })
  it('an FVG whose bodies are below m × the average body is not a displacement', () => {
    const e = new IntervalEngine('H1', PIP, { ...defaultDetectorParams(), displacementM: 19 })
    for (const c of bars([...quiet(26), [0, 12, -1, 11], [11, 20, 13, 18]])) e.push(c)
    expect(e.fvgs).toHaveLength(1)
    expect(e.displacements).toEqual([])
    const ok = new IntervalEngine('H1', PIP, { ...defaultDetectorParams(), displacementM: 18 })
    for (const c of bars([...quiet(26), [0, 12, -1, 11], [11, 20, 13, 18]])) ok.push(c)
    expect(ok.displacements).toHaveLength(1)
  })
})

/** Range, swing high 16, swing low −4, then a bearish candle (the OB) and a two-candle bull displacement. */
const MSS_ROWS = [...quiet(22), [0, 15, -1, 14], [14, 16, 10, 11], [11, 12, 4, 5], [5, 6, 0, 1], [1, 2, -4, -2], [-2, 0, -3, -1], [-1, 0, -5, -4], [-4, 14, -5, 13], [13, 25, 16, 24]]
const T = (i: number) => START + i * 3600

describe('structure: MSS, BOS, order block, OTE', () => {
  it('a close above the last swing high with displacement = MSS bull, OB = last bearish candle before the run', () => {
    const e = run(MSS_ROWS)
    expect(e.structure).toHaveLength(1)
    const mss = e.structure[0]!
    expect(mss).toMatchObject({ kind: 'MSS', dir: 'bull', level: px(16), swingAt: T(23), at: T(30) })
    expect(mss.displacementId).toBe(e.displacements.at(-1)!.id) // the earlier one (candle 22) belongs to the range
    expect(e.trend).toBe('bull')
    expect(e.blocks).toHaveLength(1)
    expect(e.blocks[0]).toMatchObject({ dir: 'bull', kind: 'OB', at: T(28), top: px(-1), bottom: px(-4), state: 'valid' })
    expect(e.blocks[0]!.mt).toBeCloseTo(px(-2.5), 9)
    expect(e.otes).toHaveLength(1)
    const o = e.otes[0]!
    expect(o).toMatchObject({ dir: 'bull', legStart: px(-4), legStartAt: T(26), legEnd: px(25), state: 'active' })
    expect(o.l62).toBeCloseTo(px(25) - (px(25) - px(-4)) * 0.62, 9)
    expect(o.l705).toBeCloseTo(px(25) - (px(25) - px(-4)) * 0.705, 9)
    expect(o.l79).toBeCloseTo(px(25) - (px(25) - px(-4)) * 0.79, 9)
  })

  it('a close beyond the opposite swing without displacement is not an MSS', () => {
    const e = run([...quiet(22), [0, 15, -1, 14], [14, 16, 10, 11], [11, 12, 4, 5], [5, 17, 4, 17], [17, 18, 16, 17]])
    expect(e.structure).toEqual([])
    expect(e.trend).toBeNull()
    expect(e.swings.find((s) => s.kind === 'high')!.takenAt).toBe(T(25))
  })

  it('after the MSS a close above the next swing high is a BOS (no displacement needed), OTE leg grows', () => {
    const e = run([...MSS_ROWS, [24, 24, 20, 21], [21, 22, 14, 15], [15, 30, 13, 29]])
    expect(e.structure.map((s) => s.kind)).toEqual(['MSS', 'BOS'])
    expect(e.structure[1]).toMatchObject({ dir: 'bull', level: px(25), displacementId: null })
    expect(e.blocks).toHaveLength(1)
    expect(e.otes[0]).toMatchObject({ legEnd: px(30), legEndAt: T(33), state: 'active' })
  })

  it('OTE is invalidated by a close beyond the leg start', () => {
    const e = run([...MSS_ROWS, [24, 24, 20, 21], [21, 22, -10, -8]])
    expect(e.otes[0]).toMatchObject({ state: 'invalid', invalidatedAt: T(32) })
  })
})

describe('breaker and mitigation block', () => {
  const bos = [[24, 24, 20, 21], [21, 22, 14, 15], [15, 30, 13, 29]]
  it('OB closed through with displacement after a sweep of the side it protected becomes a breaker', () => {
    const e = run([...MSS_ROWS, ...bos, [29, 31, 20, 22], [22, 23, -10, -9], [-9, -8, -20, -18]])
    expect(e.sweeps.some((s) => s.side === 'BSL' && s.level === px(25))).toBe(true)
    const b = e.blocks[0]!
    expect(b).toMatchObject({ kind: 'breaker', dir: 'bear', state: 'valid', invalidatedAt: T(35), flippedAt: T(36), top: px(-1), bottom: px(-4) })
  })
  it('without a prior sweep it becomes a mitigation block', () => {
    // The pullback stays above the broken swing high (16) and the BOS level (25) is left for good: no sweep.
    const noSweep = [[24, 24, 20, 21], [21, 22, 17, 18], [18, 30, 16, 29]]
    const e = run([...MSS_ROWS, ...noSweep, [29, 30, 27, 28], [28, 30, 27, 29], [29, 31, 27, 30], [30, 31, 26, 27], [27, 28, -10, -9], [-9, -8, -20, -18]])
    expect(e.sweeps.filter((s) => s.side === 'BSL')).toEqual([])
    expect(e.blocks[0]).toMatchObject({ kind: 'mitigation', dir: 'bear', state: 'valid', flippedAt: T(39) })
  })
  it('closed through without displacement (no FVG left behind): just invalid', () => {
    const e = run([...MSS_ROWS, ...bos, [29, 30, 27, 28], [28, 29, -6, -5], [-5, 28, -7, -3]])
    expect(e.displacements.filter((d) => d.dir === 'bear' && d.to >= T(34))).toEqual([])
    expect(e.blocks[0]).toMatchObject({ kind: 'OB', state: 'invalid', invalidatedAt: T(35), flippedAt: null })
  })
  it('a flipped block keeps its first invalidation time when it is closed through again', () => {
    const e = run([...MSS_ROWS, ...bos, [29, 31, 20, 22], [22, 23, -10, -9], [-9, -8, -20, -18], [-18, 5, -19, 3]])
    expect(e.blocks[0]).toMatchObject({ kind: 'breaker', state: 'invalid', invalidatedAt: T(35), flippedAt: T(36), flipInvalidatedAt: T(37) })
  })
})

describe('dealing range', () => {
  it('spans the last significant swings, extended by price beyond them; premium above EQ', () => {
    const e = run(MSS_ROWS)
    expect(e.dealingRange).toMatchObject({ high: px(25), low: px(-5), zone: 'premium' })
    expect(e.dealingRange!.eq).toBeCloseTo(px(10), 9)
    e.push(bars([[24, 24, 2, 3]], 'H1', T(31))[0]!)
    expect(e.dealingRange!.zone).toBe('discount')
  })
})

describe('extensions', () => {
  it('rejection block from a long upper wick on a swing high', () => {
    const e = run([[0, 5, -5, 2], [2, 20, 0, 4], [4, 6, 1, 3]])
    expect(e.rejections[0]).toMatchObject({ dir: 'bear', top: px(20), bottom: px(4), state: 'valid' })
  })
  it('volume imbalance between non-overlapping bodies with overlapping wicks, filled later', () => {
    const e = run([[0, 6, -1, 5], [8, 15, 4, 14]])
    expect(e.imbalances[0]).toMatchObject({ dir: 'bull', top: px(8), bottom: px(5), state: 'open' })
    e.push(bars([[14, 15, 4, 10]], 'H1', T(2))[0]!)
    expect(e.imbalances[0]!.state).toBe('filled')
    expect(run([[0, 6, -1, 5], [8, 15, 7, 14]]).imbalances).toEqual([]) // a gap, wicks do not overlap
  })
  it('balanced price range = overlap of a bull and a bear FVG', () => {
    const e = run([[20, 25, 15, 18], [18, 19, 0, 2], [2, 8, -5, 4], [4, 5, 0, 3], [3, 30, 2, 29], [29, 35, 20, 33]])
    expect(e.fvgs.map((f) => f.dir)).toEqual(['bear', 'bull'])
    expect(e.bprs).toHaveLength(1)
    expect(e.bprs[0]).toMatchObject({ dir: 'bull', top: px(15), bottom: px(8) })
  })
})

describe('daily, weekly, monthly, IPDA, session levels, opens and gaps', () => {
  const day = (date: string): number => bucketStart(ny(`${date}T12:00`), 'D')
  const dCandle = (date: string, h: number, l: number): SeriesCandle => {
    const t = day(date)
    return { t, end: bucketEnd(t, 'D'), o: px((h + l) / 2), h: px(h), l: px(l), c: px((h + l) / 2 + 1) }
  }
  it('PDH / PDL replace the previous ones (expired), PWH / PWL after the Friday candle, IPDA extremes', () => {
    const lv = new LevelSources(PIP, defaultDetectorParams())
    lv.pushD(dCandle('2026-10-05', 50, 10))
    expect(lv.pools.filter((p) => p.kind === 'PDH')[0]).toMatchObject({ price: px(50), at: day('2026-10-05'), createdAt: bucketEnd(day('2026-10-05'), 'D'), state: 'untouched' })
    lv.pushD(dCandle('2026-10-06', 60, 20))
    const pdh = lv.pools.filter((p) => p.kind === 'PDH')
    expect(pdh).toHaveLength(2)
    expect(pdh[0]).toMatchObject({ state: 'expired', expiredAt: bucketEnd(day('2026-10-06'), 'D') })
    expect(pdh[1]).toMatchObject({ price: px(60), state: 'untouched' })
    expect(lv.pools.filter((p) => p.kind === 'PWH')).toEqual([])
    lv.pushD(dCandle('2026-10-07', 40, 15))
    lv.pushD(dCandle('2026-10-08', 45, 5))
    lv.pushD(dCandle('2026-10-09', 48, 12))
    const pwh = lv.pools.filter((p) => p.kind === 'PWH' && p.expiredAt === null)
    expect(pwh).toHaveLength(1)
    expect(pwh[0]).toMatchObject({ price: px(60), at: day('2026-10-06'), createdAt: bucketEnd(day('2026-10-09'), 'D'), interval: 'W' })
    expect(lv.pools.find((p) => p.kind === 'PWL' && p.expiredAt === null)).toMatchObject({ price: px(5), at: day('2026-10-08') })
    const ipda = lv.pools.filter((p) => p.kind === 'IPDA_H' && p.expiredAt === null)
    expect(ipda.map((p) => p.label)).toEqual(['IPDA 20d H', 'IPDA 40d H', 'IPDA 60d H'])
    expect(ipda[0]).toMatchObject({ price: px(60), at: day('2026-10-06') })
  })

  it('a new month expires PMH / PML of the previous one', () => {
    const lv = new LevelSources(PIP, defaultDetectorParams())
    lv.pushD(dCandle('2026-09-29', 50, 10))
    lv.pushD(dCandle('2026-09-30', 55, 12))
    expect(lv.pools.filter((p) => p.kind === 'PMH')).toEqual([])
    lv.pushD(dCandle('2026-10-01', 40, 20))
    expect(lv.pools.find((p) => p.kind === 'PMH')).toMatchObject({ price: px(55), at: day('2026-09-30'), createdAt: day('2026-10-01') })
    expect(lv.pools.find((p) => p.kind === 'PML')).toMatchObject({ price: px(10) })
  })

  it('session high / low after the session ends, opens, NDOG and NWOG from M15 candles', () => {
    const lv = new LevelSources(PIP, defaultDetectorParams())
    const m15 = (s: string, o: number, h: number, l: number, c: number): SeriesCandle => ({ t: ny(s), end: ny(s) + 900, o: px(o), h: px(h), l: px(l), c: px(c) })
    // Friday close 16:45 → Sunday 17:00 open: NWOG and week open.
    lv.pushM15(m15('2026-10-09T16:45', 0, 1, -1, 0))
    lv.pushM15(m15('2026-10-11T17:00', 3, 4, 2, 3))
    expect(lv.gaps[0]).toMatchObject({ kind: 'NWOG', top: px(3), bottom: px(0), at: ny('2026-10-11T17:00') })
    expect(lv.opens.find((o) => o.kind === 'week' && o.expiredAt === null)).toMatchObject({ price: px(3), at: ny('2026-10-11T17:00') })
    // Asia 20:00–00:00: 16 candles; the high comes at 21:30.
    for (let i = 0; i < 15; i++) {
      const t = ny('2026-10-11T20:00') + i * 900
      lv.pushM15({ t, end: t + 900, o: px(3), h: px(i === 6 ? 15 : 5), l: px(i === 10 ? -5 : 1), c: px(3) })
    }
    expect(lv.pools.filter((p) => p.kind === 'SESSION_H')).toEqual([])
    // The candle that ends exactly at the session end closes it (its end = 00:00).
    lv.pushM15({ t: ny('2026-10-11T23:45'), end: ny('2026-10-12T00:00'), o: px(3), h: px(5), l: px(1), c: px(3) })
    expect(lv.pools.filter((p) => p.kind === 'SESSION_H')).toHaveLength(1)
    lv.pushM15(m15('2026-10-12T00:00', 3, 4, 2, 3)) // the midnight open
    expect(lv.pools.find((p) => p.kind === 'SESSION_H')).toMatchObject({ price: px(15), label: 'Asia H', at: ny('2026-10-11T21:30'), createdAt: ny('2026-10-12T00:00') })
    expect(lv.pools.find((p) => p.kind === 'SESSION_L')).toMatchObject({ price: px(-5), label: 'Asia L' })
    expect(lv.opens.filter((o) => o.kind === 'midnight')).toHaveLength(1) // the Friday 16:45 candle is not a midnight open
    expect(lv.opens.find((o) => o.kind === 'midnight')).toMatchObject({ price: px(3), at: ny('2026-10-12T00:00') })
    lv.pushM15(m15('2026-10-12T08:30', 7, 8, 6, 7))
    expect(lv.opens.find((o) => o.kind === '0830')).toMatchObject({ price: px(7) })
    // 16:45 close → 18:00 open: NDOG (the 17:00–18:00 hour has no candles).
    lv.pushM15(m15('2026-10-12T16:45', 7, 8, 6, 10))
    lv.pushM15(m15('2026-10-12T18:00', 14, 15, 13, 14))
    expect(lv.gaps.find((g) => g.kind === 'NDOG')).toMatchObject({ top: px(14), bottom: px(10), at: ny('2026-10-12T18:00') })
    expect(lv.gaps.find((g) => g.kind === 'NDOG')!.ce).toBeCloseTo(px(12), 9)
    // Next day's midnight open expires the previous one.
    lv.pushM15(m15('2026-10-13T00:00', 14, 15, 13, 14))
    const mids = lv.opens.filter((o) => o.kind === 'midnight')
    expect(mids.map((o) => o.expiredAt === null)).toEqual([false, true])
  })
})

describe('cross-interval rank and the symbol engine', () => {
  it('a level present on H1 and D gets rank 2 on both pools', () => {
    const e = new SymbolEngine(PIP, defaultDetectorParams(), ['H1', 'D'])
    for (const c of bars([[0, 5, -5, 2], [2, 10, 0, 8], [8, 9, 3, 4]], 'H1')) e.push('H1', c)
    const t = bucketStart(START, 'D')
    e.push('D', { t: t - 86400, end: t, o: px(0), h: px(12), l: px(-20), c: px(1) })
    const snap = e.snapshot()
    const swing = snap.pools.find((p) => p.kind === 'SWING_H')!
    const pdh = snap.pools.find((p) => p.kind === 'PDH')!
    expect(swing.rank).toBe(2)
    expect(pdh.rank).toBe(2)
    expect(snap.pools.find((p) => p.kind === 'PDL')!.rank).toBe(1)
  })

  it('rankPools counts intervals, not pools', () => {
    const mk = (interval: Interval, price: number, i: number) => ({ id: `${i}`, interval, kind: 'SWING_H' as const, side: 'BSL' as const, price, at: i, createdAt: i, label: '', state: 'untouched' as const, takenAt: null, expiredAt: null, rank: 1 })
    const pools = [mk('H1', px(10), 1), mk('H1', px(11), 2), mk('H4', px(13), 3), mk('H4', px(40), 4)]
    rankPools(pools, { H1: 3, H4: 5 }, PIP)
    expect(pools.map((p) => p.rank)).toEqual([2, 2, 2, 1])
  })

  it('M15 candles sweep an H1 swing pool (external pool, sweep tagged M15)', () => {
    const e = new SymbolEngine(PIP, defaultDetectorParams(), ['M15', 'H1'])
    for (const c of bars([[0, 5, -5, 2], [2, 10, 0, 8], [8, 9, 3, 4]], 'H1')) e.push('H1', c)
    e.push('M15', bars([[4, 16, 2, 5]], 'M15', START + 3 * 3600)[0]!)
    const snap = e.snapshot()
    expect(snap.intervals.M15!.sweeps[0]).toMatchObject({ interval: 'M15', poolKind: 'SWING_H', level: px(10) })
    expect(snap.pools.find((p) => p.kind === 'SWING_H')!.state).toBe('taken')
  })
})

describe('time windows', () => {
  const p = defaultDetectorParams()
  it('killzones London 02:00–04:40 and NY 07:00–10:00, Asia through midnight', () => {
    const london = p.windows[0]!
    expect(inWindow(ny('2026-10-13T02:00'), london)).toBe(true)
    expect(inWindow(ny('2026-10-13T04:39'), london)).toBe(true)
    expect(inWindow(ny('2026-10-13T04:40'), london)).toBe(false)
    const asia = p.sessions[0]!
    expect(inWindow(ny('2026-10-13T23:59'), asia)).toBe(true)
    expect(inWindow(ny('2026-10-13T00:00'), asia)).toBe(false)
    expect(inWindow(ny('2026-10-13T19:59'), asia)).toBe(false)
    const r = windowRange(ny('2026-10-13T22:00'), asia)
    expect([r.from, r.to, r.active]).toEqual([ny('2026-10-13T20:00'), ny('2026-10-14T00:00'), true])
    const next = currentOrNextWindow(ny('2026-10-13T05:00'), p.windows)!
    expect(next.window.id).toBe('ny')
    expect(next.from).toBe(ny('2026-10-13T07:00'))
    expect(next.active).toBe(false)
  })
})

// ---- properties on a random market ----------------------------------------------------------------------------

function randomM15(from: number, to: number, seed: number): SeriesCandle[] {
  let s = seed
  const rnd = (): number => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
  const m1: Candle[] = []
  let price = 1.1
  for (let t = from; t < to; t += 60) {
    if (!isMarketOpen(t)) continue
    const o = price
    const drift = Math.sin(t / 50000) * 0.00005
    const c = o + (rnd() - 0.5) * 0.0006 + drift + (rnd() < 0.02 ? (rnd() - 0.5) * 0.004 : 0)
    m1.push({ t, o, h: Math.max(o, c) + rnd() * 0.0003, l: Math.min(o, c) - rnd() * 0.0003, c })
    price = c
  }
  return aggregate(m1, 'M15')
}

const MUTABLE = new Set(['state', 'cls', 'takenAt', 'touchedAt', 'ceAt', 'filledAt', 'invertedAt', 'invalidatedAt', 'flippedAt', 'flipInvalidatedAt', 'expiredAt', 'kind', 'dir', 'legEnd', 'legEndAt', 'l62', 'l705', 'l79', 'rank'])
const TIMESTAMPS = new Set(['takenAt', 'touchedAt', 'ceAt', 'filledAt', 'invertedAt', 'invalidatedAt', 'flippedAt', 'flipInvalidatedAt', 'expiredAt'])

function allObjects(snap: EngineSnapshot): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>()
  const add = (list: ReadonlyArray<{ id: string }>) => {
    for (const o of list) {
      expect(out.has(o.id)).toBe(false)
      out.set(o.id, o as unknown as Record<string, unknown>)
    }
  }
  for (const io of Object.values(snap.intervals)) {
    add(io.swings)
    add(io.fvgs)
    add(io.displacements)
    add(io.structure)
    add(io.blocks)
    add(io.otes)
    add(io.sweeps)
    add(io.rejections)
    add(io.bprs)
    add(io.imbalances)
  }
  add(snap.pools)
  add(snap.opens)
  add(snap.gaps)
  return out
}

describe('properties on a random two-week market', () => {
  const from = ny('2026-10-04T17:00')
  const to = ny('2026-10-16T17:00')
  const m15 = randomM15(from, to, 42)
  const series = { M15: m15, H1: aggregate(m15, 'H1'), H4: aggregate(m15, 'H4'), D: aggregate(m15, 'D') }

  it('finds objects of every kind', () => {
    const snap = analyzeSeries(series, PIP, defaultDetectorParams())
    const h1 = snap.intervals.H1!
    expect(h1.swings.length).toBeGreaterThan(20)
    expect(h1.fvgs.length).toBeGreaterThan(0)
    expect(h1.structure.length).toBeGreaterThan(0)
    expect(snap.intervals.M15!.sweeps.length).toBeGreaterThan(0)
    expect(snap.pools.filter((p) => p.kind === 'PDH')).toHaveLength(series.D.length)
    expect(snap.pools.some((p) => p.kind === 'SESSION_H')).toBe(true)
    expect(snap.opens.some((o) => o.kind === '0830')).toBe(true)
  })

  it('live order (aggregator closes) gives the same snapshot as the batch', () => {
    const live = new SymbolEngine(PIP, defaultDetectorParams())
    const agg = new Aggregator(['H1', 'H4', 'D'])
    for (const bar of m15) {
      const closed = agg.push(bar)
      live.push('M15', bar)
      for (const c of [...closed, ...agg.advance(bar.end)]) live.push(c.interval, c.candle)
    }
    for (const i of ['H1', 'H4', 'D'] as const) {
      const f = agg.forming(i)
      if (f) live.push(i, f)
    }
    const a = JSON.parse(JSON.stringify(live.snapshot()))
    const b = JSON.parse(JSON.stringify(analyzeSeries(series, PIP, defaultDetectorParams())))
    expect(a).toEqual(b)
  })

  it('nothing is rewritten retroactively: objects keep identity, states only progress', () => {
    const engine = new SymbolEngine(PIP, defaultDetectorParams())
    const all: Array<{ interval: Interval; candle: SeriesCandle }> = []
    for (const interval of ['M15', 'H1', 'H4', 'D'] as const) for (const candle of series[interval]) all.push({ interval, candle })
    all.sort((a, b) => a.candle.end - b.candle.end || ['M15', 'H1', 'H4', 'D'].indexOf(a.interval) - ['M15', 'H1', 'H4', 'D'].indexOf(b.interval))
    let prev = allObjects(structuredClone(engine.snapshot()))
    let checked = 0
    let n = 0
    for (const x of all) {
      engine.push(x.interval, x.candle)
      // A retroactive change persists, so comparing every 7th snapshot catches it at a seventh of the cost.
      if (++n % 7 !== 0) continue
      const next = allObjects(structuredClone(engine.snapshot()))
      for (const [id, a] of prev) {
        const b = next.get(id)
        expect(b, `object ${id} disappeared`).toBeDefined()
        for (const [key, value] of Object.entries(a)) {
          if (TIMESTAMPS.has(key)) {
            if (value !== null) expect(b![key], `${id}.${key}`).toBe(value)
          } else if (!MUTABLE.has(key)) expect(b![key], `${id}.${key}`).toEqual(value)
          checked++
        }
      }
      prev = next
    }
    expect(checked).toBeGreaterThan(10000)
  }, 120_000)
})
