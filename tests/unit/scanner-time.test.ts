import { describe, expect, it } from 'vitest'
import { DateTime } from 'luxon'
import {
  bucketEnd,
  bucketStart,
  fromNyLocal,
  isMarketOpen,
  marketRanges,
  marketSeconds,
  nyLocal,
  nyOffsetMin,
  nyParts,
  tradingDay
} from '@shared/scanner/time'
import { Aggregator, aggregate, markIncomplete } from '@shared/scanner/aggregate'
import type { Candle, Interval, SeriesCandle } from '@shared/scanner/types'

/** Instant of a New York wall-clock time. */
const ny = (s: string): number => DateTime.fromISO(s, { zone: 'America/New_York' }).toSeconds()
const utc = (s: string): number => Date.parse(s) / 1000
const nyStr = (t: number): string => DateTime.fromSeconds(t, { zone: 'America/New_York' }).toFormat('ccc yyyy-MM-dd HH:mm')

describe('New York offset (IANA, cached per year)', () => {
  it('switches to EDT on the second Sunday of March and back on the first Sunday of November', () => {
    // 2026: DST from 8 March 07:00 UTC (02:00 EST) to 1 November 06:00 UTC (02:00 EDT).
    expect(nyOffsetMin(utc('2026-03-08T06:59:59Z'))).toBe(-300)
    expect(nyOffsetMin(utc('2026-03-08T07:00:00Z'))).toBe(-240)
    expect(nyOffsetMin(utc('2026-11-01T05:59:59Z'))).toBe(-240)
    expect(nyOffsetMin(utc('2026-11-01T06:00:00Z'))).toBe(-300)
  })

  it('agrees with luxon for every hour of two years', () => {
    for (let t = utc('2025-01-01T00:00:00Z'); t < utc('2027-01-01T00:00:00Z'); t += 3600) {
      expect(nyOffsetMin(t)).toBe(DateTime.fromSeconds(t, { zone: 'America/New_York' }).offset)
    }
  })

  it('converts NY wall clock back to the instant', () => {
    const t = ny('2026-07-15T09:30')
    expect(fromNyLocal(nyLocal(t), t)).toBe(t)
    expect(nyParts(t)).toMatchObject({ date: '2026-07-15', weekday: 3, hour: 9, minute: 30 })
  })
})

describe('FX market hours (Sunday 17:00 → Friday 17:00 NY)', () => {
  it.each([
    ['2026-10-09T16:59', true],
    ['2026-10-09T17:00', false],
    ['2026-10-10T12:00', false],
    ['2026-10-11T16:59', false],
    ['2026-10-11T17:00', true],
    ['2026-01-16T16:59', true], // EST
    ['2026-01-16T17:00', false],
    ['2026-01-18T17:00', true]
  ])('%s NY open = %s', (s, open) => {
    expect(isMarketOpen(ny(s))).toBe(open)
  })

  it('cuts the weekend out of a range', () => {
    const r = marketRanges(ny('2026-10-07T12:00'), ny('2026-10-14T12:00'))
    expect(r.map((x) => [nyStr(x.from), nyStr(x.to)])).toEqual([
      ['Wed 2026-10-07 12:00', 'Fri 2026-10-09 17:00'],
      ['Sun 2026-10-11 17:00', 'Wed 2026-10-14 12:00']
    ])
    expect(marketSeconds(ny('2026-10-04T17:00'), ny('2026-10-11T17:00'))).toBe(5 * 86400)
  })
})

describe('trading day and buckets', () => {
  it('trading day runs 17:00 → 17:00 NY and is named after its end', () => {
    expect(tradingDay(ny('2026-10-11T17:00'))).toBe('2026-10-12')
    expect(tradingDay(ny('2026-10-12T16:59'))).toBe('2026-10-12')
    expect(tradingDay(ny('2026-10-12T17:00'))).toBe('2026-10-13')
  })

  it('H4 starts at 17, 21, 01, 05, 09, 13 NY', () => {
    const starts = new Set<string>()
    for (let t = ny('2026-10-12T17:00'); t < ny('2026-10-13T17:00'); t += 900) starts.add(nyStr(bucketStart(t, 'H4')).slice(15))
    expect([...starts]).toEqual(['17:00', '21:00', '01:00', '05:00', '09:00', '13:00'])
    expect(nyStr(bucketStart(ny('2026-10-13T00:30'), 'H4'))).toBe('Mon 2026-10-12 21:00')
    expect(nyStr(bucketEnd(bucketStart(ny('2026-10-13T10:30'), 'H4'), 'H4'))).toBe('Tue 2026-10-13 13:00')
  })

  it('D and W follow 17:00 NY in winter, summer and across the March and November switches', () => {
    // Week of the March switch (US on EDT, Europe still on CET until 29 March).
    expect(bucketStart(ny('2026-03-09T10:00'), 'D')).toBe(utc('2026-03-08T21:00:00Z'))
    expect(bucketEnd(utc('2026-03-08T21:00:00Z'), 'D')).toBe(utc('2026-03-09T21:00:00Z'))
    expect(bucketStart(ny('2026-03-04T10:00'), 'D')).toBe(utc('2026-03-03T22:00:00Z'))
    expect(bucketStart(ny('2026-03-20T03:00'), 'H4')).toBe(utc('2026-03-20T05:00:00Z')) // 01:00 EDT
    // Week of the November switch.
    expect(bucketStart(ny('2026-11-02T08:00'), 'D')).toBe(utc('2026-11-01T22:00:00Z'))
    expect(bucketStart(ny('2026-10-30T08:00'), 'D')).toBe(utc('2026-10-29T21:00:00Z'))
    // Week: Sunday 17:00 → Friday 17:00 NY.
    const w = bucketStart(ny('2026-10-14T10:00'), 'W')
    expect(nyStr(w)).toBe('Sun 2026-10-11 17:00')
    expect(nyStr(bucketEnd(w, 'W'))).toBe('Fri 2026-10-16 17:00')
    expect(nyStr(bucketStart(ny('2026-03-11T10:00'), 'W'))).toBe('Sun 2026-03-08 17:00')
    expect(nyStr(bucketEnd(bucketStart(ny('2026-03-11T10:00'), 'W'), 'W'))).toBe('Fri 2026-03-13 17:00')
  })

  it('the Sunday open starts a new day and week', () => {
    const open = ny('2026-10-11T17:00')
    expect(bucketStart(open, 'D')).toBe(open)
    expect(bucketStart(open, 'W')).toBe(open)
    expect(bucketStart(open, 'H4')).toBe(open)
  })
})

/** Random-walk M1 bars over [from, to), market hours only, with random missing minutes and weekend noise. */
function makeBars(from: number, to: number, seed = 7, weekendNoise = true): Candle[] {
  let s = seed
  const rnd = (): number => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
  const out: Candle[] = []
  let price = 1.1
  for (let t = from; t < to; t += 60) {
    const open = isMarketOpen(t)
    if (!open && !(weekendNoise && rnd() < 0.5)) continue
    if (open && rnd() < 0.05) continue
    const o = price
    const c = o + (rnd() - 0.5) * 0.0004
    const h = Math.max(o, c) + rnd() * 0.0002
    const l = Math.min(o, c) - rnd() * 0.0002
    out.push({ t, o, h, l, c })
    price = c
  }
  return out
}

describe('aggregation M1 → higher intervals', () => {
  it('builds one W and five D candles from a week with weekend noise, H1 exactly from minutes', () => {
    const bars = makeBars(ny('2026-10-09T12:00'), ny('2026-10-17T12:00'))
    const w = aggregate(bars, 'W')
    expect(w.map((c) => nyStr(c.t))).toEqual(['Sun 2026-10-04 17:00', 'Sun 2026-10-11 17:00'])
    const d = aggregate(bars, 'D').filter((c) => c.t >= ny('2026-10-11T17:00'))
    expect(d.map((c) => nyStr(c.t).slice(0, 3))).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu'])
    const h1 = aggregate(bars, 'H1')
    const one = h1.find((c) => c.t === ny('2026-10-13T09:00'))!
    const minutes = bars.filter((b) => b.t >= one.t && b.t < one.end)
    expect(one.o).toBe(minutes[0]!.o)
    expect(one.c).toBe(minutes.at(-1)!.c)
    expect(one.h).toBe(Math.max(...minutes.map((b) => b.h)))
    expect(one.l).toBe(Math.min(...minutes.map((b) => b.l)))
    // No candle starts on Saturday.
    expect(aggregate(bars, 'M1').some((c) => !isMarketOpen(c.t))).toBe(false)
  })

  it.each([
    ['March switch', '2026-03-01T12:00', '2026-03-20T12:00'],
    ['November switch', '2026-10-25T12:00', '2026-11-10T12:00']
  ])('incremental equals batch across the %s', (_name, a, b) => {
    const bars = makeBars(ny(a), ny(b), 11)
    const intervals: Interval[] = ['M5', 'M15', 'H1', 'H4', 'D', 'W']
    const agg = new Aggregator(intervals)
    const got = new Map<Interval, SeriesCandle[]>(intervals.map((i) => [i, []]))
    for (const bar of bars) {
      for (const c of agg.push(bar)) got.get(c.interval)!.push(c.candle)
      for (const c of agg.advance(bar.t + 60)) got.get(c.interval)!.push(c.candle)
    }
    for (const i of intervals) {
      const batch = aggregate(bars, i)
      const last = agg.forming(i)
      const all = last ? [...got.get(i)!, last] : got.get(i)!
      expect(all).toEqual(batch)
    }
  })

  it('ignores a late bar of a bucket already closed by the watermark', () => {
    const agg = new Aggregator(['H1'])
    const t = ny('2026-10-13T09:00')
    agg.push({ t, o: 1, h: 2, l: 0.5, c: 1.5 })
    expect(agg.advance(t + 3600)).toHaveLength(1)
    expect(agg.push({ t: t + 120, o: 1, h: 9, l: 0.1, c: 1 })).toEqual([])
    expect(agg.forming('H1')).toBeNull()
  })

  it('marks candles overlapping a gap as incomplete', () => {
    const bars = makeBars(ny('2026-10-13T08:00'), ny('2026-10-13T12:00'), 3, false)
    const h1 = markIncomplete(aggregate(bars, 'H1'), [{ from: ny('2026-10-13T10:15'), to: ny('2026-10-13T10:40') }])
    expect(h1.map((c) => !!c.incomplete)).toEqual([false, false, true, false])
  })
})
