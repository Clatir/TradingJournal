/**
 * Levels that are not detectors of one interval: previous day / week / month highs and lows, IPDA look-back
 * extremes (from closed D candles), session highs and lows, opening prices and the NDOG / NWOG gaps (from closed
 * M15 candles). Replaced levels expire (state), they are never removed.
 */
import type { Interval, SeriesCandle } from '../types'
import { bucketEnd, bucketStart, nyParts, tradingDay } from '../time'
import { windowRange } from '../windows'
import type { DetectorParams } from './params'
import type { Gap, OpenLevel, Pool, PoolKind } from './types'

interface SessionTracker {
  from: number
  to: number
  high: number
  low: number
  highAt: number
  lowAt: number
}

const KEEP_NDOG = 5
const KEEP_NWOG = 3

export class LevelSources {
  readonly pools: Pool[] = []
  readonly opens: OpenLevel[] = []
  readonly gaps: Gap[] = []

  private readonly dCandles: SeriesCandle[] = []
  private weekBuffer: SeriesCandle[] = []
  private monthBuffer: SeriesCandle[] = []
  private readonly current = new Map<string, Pool>()
  private readonly sessions = new Map<string, SessionTracker>()
  private lastM15: SeriesCandle | null = null
  private lastDate = ''
  private open0830Date = ''

  constructor(
    readonly pipSize: number,
    readonly params: DetectorParams
  ) {}

  /** Closed daily candle (17:00 → 17:00 NY). */
  pushD(c: SeriesCandle): void {
    this.dCandles.push(c)
    const at = c.end
    this.setPool('PDH', 'D', c.h, c.t, at, 'PDH')
    this.setPool('PDL', 'D', c.l, c.t, at, 'PDL')
    // Week: the Friday candle ends the week; a week without its last candle (holiday) is flushed by the next one.
    const prev = this.dCandles[this.dCandles.length - 2]
    if (prev && bucketStart(prev.t, 'W') !== bucketStart(c.t, 'W')) this.flushWeek(c.t)
    this.weekBuffer.push(c)
    if (bucketEnd(bucketStart(c.t, 'W'), 'W') === c.end) this.flushWeek(c.end)
    const month = tradingDay(c.t).slice(0, 7)
    if (prev && tradingDay(prev.t).slice(0, 7) !== month) this.flushMonth(c.t)
    this.monthBuffer.push(c)
    for (const days of this.params.ipdaDays) {
      const slice = this.dCandles.slice(-days)
      let hi = slice[0]!
      let lo = slice[0]!
      for (const x of slice) {
        if (x.h > hi.h) hi = x
        if (x.l < lo.l) lo = x
      }
      this.setPool('IPDA_H', 'D', hi.h, hi.t, at, `IPDA ${days}d H`, `IPDA_H:${days}`)
      this.setPool('IPDA_L', 'D', lo.l, lo.t, at, `IPDA ${days}d L`, `IPDA_L:${days}`)
    }
  }

  private flushWeek(at: number): void {
    if (!this.weekBuffer.length) return
    const hi = this.weekBuffer.reduce((m, x) => (x.h > m.h ? x : m))
    const lo = this.weekBuffer.reduce((m, x) => (x.l < m.l ? x : m))
    this.setPool('PWH', 'W', hi.h, hi.t, at, 'PWH')
    this.setPool('PWL', 'W', lo.l, lo.t, at, 'PWL')
    this.weekBuffer = []
  }

  private flushMonth(at: number): void {
    if (!this.monthBuffer.length) return
    const hi = this.monthBuffer.reduce((m, x) => (x.h > m.h ? x : m))
    const lo = this.monthBuffer.reduce((m, x) => (x.l < m.l ? x : m))
    this.setPool('PMH', 'D', hi.h, hi.t, at, 'PMH')
    this.setPool('PML', 'D', lo.l, lo.t, at, 'PML')
    this.monthBuffer = []
  }

  /** Replaces the current pool of `key` (expired, not removed) unless it is the same level from the same candle. */
  private setPool(kind: PoolKind, interval: Interval, price: number, at: number, createdAt: number, label: string, key: string = kind): void {
    const cur = this.current.get(key)
    if (cur && cur.price === price && cur.at === at) return
    if (cur && cur.expiredAt === null) {
      cur.expiredAt = createdAt
      if (cur.state === 'untouched') cur.state = 'expired'
    }
    const pool: Pool = {
      id: `${interval}:pool:${key}:${at}:${createdAt}`,
      interval,
      kind,
      side: kind.endsWith('H') ? 'BSL' : 'SSL',
      price,
      at,
      createdAt,
      label,
      state: 'untouched',
      takenAt: null,
      expiredAt: null,
      rank: 1
    }
    this.pools.push(pool)
    this.current.set(key, pool)
  }

  /** Closed M15 candle: sessions, opening prices, NDOG / NWOG. */
  pushM15(c: SeriesCandle): void {
    const prev = this.lastM15
    this.lastM15 = c
    const p = nyParts(c.t)
    // Sessions.
    for (const w of this.params.sessions) {
      const r = windowRange(c.t, w)
      const tracker = this.sessions.get(w.id)
      if (tracker && (!r.active || r.from !== tracker.from)) this.closeSession(w.id, w.label || w.id, tracker, c.t)
      if (r.active) {
        const cur = this.sessions.get(w.id)
        if (!cur || cur.from !== r.from) this.sessions.set(w.id, { from: r.from, to: r.to, high: c.h, low: c.l, highAt: c.t, lowAt: c.t })
        else {
          if (c.h > cur.high) {
            cur.high = c.h
            cur.highAt = c.t
          }
          if (c.l < cur.low) {
            cur.low = c.l
            cur.lowAt = c.t
          }
        }
        const t = this.sessions.get(w.id)!
        if (c.end >= t.to) this.closeSession(w.id, w.label || w.id, t, c.end)
      }
    }
    // Opening prices: first candle of the NY calendar day (midnight open), first at/after 08:30, first of the week.
    if (p.date !== this.lastDate) {
      this.lastDate = p.date
      // Only a candle from the first hour counts (data starting mid-day has no midnight open for that day).
      if (p.minuteOfDay < 60) this.setOpen('midnight', c, '00:00')
    }
    if (p.minuteOfDay >= 510 && p.minuteOfDay < 570 && this.open0830Date !== p.date) {
      this.open0830Date = p.date
      this.setOpen('0830', c, '08:30')
    }
    const weekStart = bucketStart(c.t, 'W')
    const newWeek = prev ? bucketStart(prev.t, 'W') !== weekStart : c.t === weekStart
    if (newWeek) this.setOpen('week', c, 'tydz.')
    // Gaps: new trading day after a candle that closed the previous one (17:00 NY), new week after Friday.
    if (prev && newWeek) this.addGap('NWOG', prev, c, KEEP_NWOG)
    else if (prev && tradingDay(prev.t) !== tradingDay(c.t) && prev.end === bucketEnd(bucketStart(prev.t, 'D'), 'D')) this.addGap('NDOG', prev, c, KEEP_NDOG)
  }

  private closeSession(id: string, label: string, t: SessionTracker, at: number): void {
    this.sessions.delete(id)
    this.setPool('SESSION_H', 'M15', t.high, t.highAt, at, `${label} H`, `S_H:${id}`)
    this.setPool('SESSION_L', 'M15', t.low, t.lowAt, at, `${label} L`, `S_L:${id}`)
  }

  private setOpen(kind: OpenLevel['kind'], c: SeriesCandle, label: string): void {
    for (const o of this.opens) if (o.kind === kind && o.expiredAt === null) o.expiredAt = c.t
    this.opens.push({ id: `open:${kind}:${c.t}`, kind, at: c.t, createdAt: c.t, price: c.o, label, expiredAt: null })
  }

  private addGap(kind: Gap['kind'], prev: SeriesCandle, c: SeriesCandle, keep: number): void {
    const top = Math.max(prev.c, c.o)
    const bottom = Math.min(prev.c, c.o)
    if (top - bottom < this.pipSize * 0.1) return
    this.gaps.push({ id: `gap:${kind}:${c.t}`, kind, at: c.t, createdAt: c.t, top, bottom, ce: (top + bottom) / 2, expiredAt: null })
    const active = this.gaps.filter((g) => g.kind === kind && g.expiredAt === null)
    for (const g of active.slice(0, Math.max(0, active.length - keep))) g.expiredAt = c.t
  }
}

/**
 * Rank of every active pool = number of intervals with a same-side level within the EQ tolerance (of the higher
 * interval). Computed on demand (snapshot), not per candle.
 */
export function rankPools(pools: readonly Pool[], tolerancePips: Readonly<Partial<Record<Interval, number>>>, pipSize: number): void {
  const active = pools.filter((p) => p.state !== 'expired' && p.expiredAt === null)
  const tol = (i: Interval): number => (tolerancePips[i] ?? 0) * pipSize
  const bySide: Record<'BSL' | 'SSL', Pool[]> = { BSL: [], SSL: [] }
  for (const p of active) bySide[p.side].push(p)
  for (const side of ['BSL', 'SSL'] as const) {
    const list = bySide[side].sort((a, b) => a.price - b.price)
    for (let i = 0; i < list.length; i++) {
      const p = list[i]!
      const intervals = new Set<Interval>([p.interval])
      for (let j = i - 1; j >= 0; j--) {
        const q = list[j]!
        const t = Math.max(tol(p.interval), tol(q.interval))
        if (p.price - q.price > t) break
        intervals.add(q.interval)
      }
      for (let j = i + 1; j < list.length; j++) {
        const q = list[j]!
        const t = Math.max(tol(p.interval), tol(q.interval))
        if (q.price - p.price > t) break
        intervals.add(q.interval)
      }
      p.rank = intervals.size
    }
  }
}
