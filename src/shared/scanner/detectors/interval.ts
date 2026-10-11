/**
 * ICT detectors of one interval, incremental: `push` takes one closed candle (time order) and updates the objects.
 * Nothing here looks at a candle that has not closed. Order inside `push`: progress states of existing objects with
 * the new candle, detect FVG and displacement, progress blocks (flips need the displacement), then swings, structure,
 * blocks, OTE, dealing range, sweeps and extensions. The batch helper in engine.ts just replays candles through this class, so both are identical.
 */
import type { Interval, SeriesCandle } from '../types'
import type { DetectorParams } from './params'
import type {
  Bpr,
  DealingRange,
  Dir,
  Displacement,
  Fvg,
  IntervalObjects,
  OrderBlock,
  Ote,
  Pool,
  RejectionBlock,
  StructureEvent,
  Sweep,
  Swing,
  VolumeImbalance
} from './types'
import { INTERVAL_LABEL } from './types'

const body = (c: SeriesCandle): number => Math.abs(c.c - c.o)
const isBull = (c: SeriesCandle): boolean => c.c > c.o
const isBear = (c: SeriesCandle): boolean => c.c < c.o

interface PendingSweep {
  pool: Pool
  at: number
  extreme: number
  left: number
}

interface LastDisplacement {
  endIndex: number
  startIndex: number
  id: string
}

export class IntervalEngine {
  readonly candles: SeriesCandle[] = []
  readonly swings: Swing[] = []
  readonly fvgs: Fvg[] = []
  readonly displacements: Displacement[] = []
  readonly structure: StructureEvent[] = []
  readonly blocks: OrderBlock[] = []
  readonly otes: Ote[] = []
  readonly sweeps: Sweep[] = []
  readonly rejections: RejectionBlock[] = []
  readonly bprs: Bpr[] = []
  readonly imbalances: VolumeImbalance[] = []
  /** Pools of this interval: swing highs / lows and EQH / EQL. */
  readonly pools: Pool[] = []
  dealingRange: DealingRange | null = null
  trend: Dir | null = null

  private readonly highs: Swing[] = []
  private readonly lows: Swing[] = []
  private readonly itHighs: Swing[] = []
  private readonly itLows: Swing[] = []
  private lastHigh: Swing | null = null
  private lastLow: Swing | null = null
  private readonly pending: PendingSweep[] = []
  private lastDisp: { bull: LastDisplacement | null; bear: LastDisplacement | null } = { bull: null, bear: null }
  private readonly tag: string

  constructor(
    readonly interval: Interval,
    readonly pipSize: number,
    readonly params: DetectorParams
  ) {
    this.tag = INTERVAL_LABEL[interval]
  }

  get lastAt(): number | null {
    return this.candles.at(-1)?.t ?? null
  }

  private pips(d: number): number {
    return Math.round((d / this.pipSize) * 1000) / 1000
  }

  private get fvgMin(): number {
    return (this.params.fvgMinPips as Partial<Record<Interval, number>>)[this.interval] ?? 0
  }

  private get eqTol(): number {
    return ((this.params.eqTolerancePips as Partial<Record<Interval, number>>)[this.interval] ?? 0) * this.pipSize
  }

  /** Adds a closed candle; `external` = pools of other intervals / sources that this interval's candles can sweep. */
  push(c: SeriesCandle, external: readonly Pool[] = []): void {
    this.candles.push(c)
    const i = this.candles.length - 1
    this.progressStates(c, i)
    const fvg = this.detectFvg(c, i)
    if (fvg) this.detectDisplacement(c, i, fvg)
    this.progressBlocks(c, i)
    this.detectImbalance(c, i)
    this.detectSwings(c, i)
    this.detectStructure(c, i)
    this.updateDealingRange(c)
    this.detectSweeps(c, [...this.pools, ...external])
  }

  // ---- state progression ---------------------------------------------------------------------------------------

  private progressStates(c: SeriesCandle, i: number): void {
    const t = c.t
    for (const f of this.fvgs) {
      if (f.state === 'inverted') continue
      if (f.dir === 'bull') {
        if (c.l <= f.top && f.touchedAt === null) f.touchedAt = t
        if (c.l <= f.ce && f.ceAt === null) f.ceAt = t
        if (c.l <= f.bottom && f.filledAt === null) f.filledAt = t
        if (c.c < f.bottom) f.invertedAt = t
      } else {
        if (c.h >= f.bottom && f.touchedAt === null) f.touchedAt = t
        if (c.h >= f.ce && f.ceAt === null) f.ceAt = t
        if (c.h >= f.top && f.filledAt === null) f.filledAt = t
        if (c.c > f.top) f.invertedAt = t
      }
      f.state = f.invertedAt !== null ? 'inverted' : f.filledAt !== null ? 'filled' : f.ceAt !== null ? 'ce' : f.touchedAt !== null ? 'touched' : 'open'
    }
    for (const o of this.otes) {
      if (o.state !== 'active') continue
      if (o.dir === 'bull') {
        if (c.c < o.legStart) {
          o.state = 'invalid'
          o.invalidatedAt = t
          continue
        }
        if (c.h > o.legEnd) {
          o.legEnd = c.h
          o.legEndAt = t
          this.oteLevels(o)
        }
      } else {
        if (c.c > o.legStart) {
          o.state = 'invalid'
          o.invalidatedAt = t
          continue
        }
        if (c.l < o.legEnd) {
          o.legEnd = c.l
          o.legEndAt = t
          this.oteLevels(o)
        }
      }
    }
    for (const r of this.rejections) {
      if (r.state === 'valid' && (r.dir === 'bear' ? c.c > r.top : c.c < r.bottom)) {
        r.state = 'invalid'
        r.invalidatedAt = t
      }
    }
    for (const v of this.imbalances) {
      if (v.state === 'open' && (v.dir === 'bull' ? c.l <= v.bottom : c.h >= v.top)) {
        v.state = 'filled'
        v.filledAt = t
      }
    }
  }

  /**
   * Blocks: a close through the zone invalidates it; with a displacement in that direction (known once its FVG
   * formed, so also when the FVG confirms one or two candles later) the block flips – breaker when a sweep of the
   * side it protected happened after its creation, mitigation block otherwise.
   */
  private progressBlocks(c: SeriesCandle, i: number): void {
    const t = c.t
    const recentAt = i >= 2 ? this.candles[i - 2]!.t : -Infinity
    for (const b of this.blocks) {
      if (b.state === 'valid' && (b.dir === 'bull' ? c.c < b.bottom : c.c > b.top)) {
        b.state = 'invalid'
        if (b.flippedAt === null) b.invalidatedAt = t
        else b.flipInvalidatedAt = t
      }
      if (b.kind !== 'OB' || b.state !== 'invalid' || b.flippedAt !== null || b.invalidatedAt === null || b.invalidatedAt < recentAt) continue
      const disp = b.dir === 'bull' ? this.lastDisp.bear : this.lastDisp.bull
      if (disp === null || disp.endIndex < i - 2) continue
      const sweptSide = b.dir === 'bull' ? 'BSL' : 'SSL'
      const swept = this.sweeps.some((s) => s.side === sweptSide && s.createdAt > b.createdAt)
      b.kind = swept ? 'breaker' : 'mitigation'
      b.dir = b.dir === 'bull' ? 'bear' : 'bull'
      b.state = 'valid'
      b.flippedAt = t
    }
  }

  private oteLevels(o: Ote): void {
    const leg = o.legEnd - o.legStart
    o.l62 = o.legEnd - leg * 0.62
    o.l705 = o.legEnd - leg * 0.705
    o.l79 = o.legEnd - leg * 0.79
  }

  // ---- FVG, displacement, imbalances ---------------------------------------------------------------------------

  private detectFvg(c: SeriesCandle, i: number): Fvg | null {
    if (i < 2) return null
    const a = this.candles[i - 2]!
    let dir: Dir | null = null
    let top = 0
    let bottom = 0
    if (c.l > a.h) {
      dir = 'bull'
      top = c.l
      bottom = a.h
    } else if (c.h < a.l) {
      dir = 'bear'
      top = a.l
      bottom = c.h
    }
    if (!dir) return null
    const sizePips = this.pips(top - bottom)
    if (sizePips < this.fvgMin) return null
    const fvg: Fvg = {
      id: `${this.interval}:fvg:${c.t}`,
      interval: this.interval,
      dir,
      at: c.t,
      createdAt: c.t,
      top,
      bottom,
      ce: (top + bottom) / 2,
      sizePips,
      state: 'open',
      touchedAt: null,
      ceAt: null,
      filledAt: null,
      invertedAt: null
    }
    this.fvgs.push(fvg)
    // Balanced price range: this FVG overlaps an opposite one that is still open.
    for (let k = this.fvgs.length - 2; k >= 0 && k >= this.fvgs.length - 40; k--) {
      const other = this.fvgs[k]!
      if (other.dir === dir) continue // (usually the old gap is already inverted by the move that made the new one)
      const lo = Math.max(bottom, other.bottom)
      const hi = Math.min(top, other.top)
      if (hi > lo) {
        this.bprs.push({
          id: `${this.interval}:bpr:${c.t}`,
          interval: this.interval,
          dir,
          at: c.t,
          createdAt: c.t,
          top: hi,
          bottom: lo,
          bullFvgId: dir === 'bull' ? fvg.id : other.id,
          bearFvgId: dir === 'bear' ? fvg.id : other.id
        })
        break
      }
    }
    return fvg
  }

  /**
   * Displacement: the run of up to three same-direction candles that ends at the FVG's middle candle (or at the third
   * candle when it continues the run) with a body sum ≥ m × the average body of the `lookback` candles before it.
   */
  private detectDisplacement(c: SeriesCandle, i: number, fvg: Fvg): void {
    const dir = fvg.dir
    const same = dir === 'bull' ? isBull : isBear
    const end = same(c) ? i : i - 1
    if (!same(this.candles[i - 1]!)) return
    let start = end
    while (start > 0 && end - start < 2 && same(this.candles[start - 1]!)) start--
    if (start > i - 1) return
    const lookFrom = Math.max(0, start - this.params.displacementLookback)
    if (start - lookFrom < 5) return
    let sum = 0
    for (let k = lookFrom; k < start; k++) sum += body(this.candles[k]!)
    const avgBody = sum / (start - lookFrom)
    if (!(avgBody > 0)) return
    let bodySum = 0
    for (let k = start; k <= end; k++) bodySum += body(this.candles[k]!)
    const ratio = bodySum / avgBody
    if (ratio < this.params.displacementM) return
    const to = this.candles[end]!.t
    if (this.displacements.some((d) => d.to === to && d.dir === dir)) return
    const d: Displacement = {
      id: `${this.interval}:disp:${to}`,
      interval: this.interval,
      dir,
      from: this.candles[start]!.t,
      to,
      createdAt: c.t,
      bodySum,
      avgBody,
      ratio,
      fvgId: fvg.id
    }
    this.displacements.push(d)
    this.lastDisp[dir] = { endIndex: end, startIndex: start, id: d.id }
  }

  /** Volume imbalance: bodies of two adjacent candles do not overlap while their wicks do. */
  private detectImbalance(c: SeriesCandle, i: number): void {
    if (i < 1) return
    const p = this.candles[i - 1]!
    const pTop = Math.max(p.o, p.c)
    const pBottom = Math.min(p.o, p.c)
    const cTop = Math.max(c.o, c.c)
    const cBottom = Math.min(c.o, c.c)
    let dir: Dir | null = null
    let top = 0
    let bottom = 0
    if (cBottom > pTop && c.l <= p.h) {
      dir = 'bull'
      top = cBottom
      bottom = pTop
    } else if (cTop < pBottom && c.h >= p.l) {
      dir = 'bear'
      top = pBottom
      bottom = cTop
    }
    if (!dir || this.pips(top - bottom) < this.fvgMin / 2) return
    this.imbalances.push({ id: `${this.interval}:vi:${c.t}`, interval: this.interval, dir, at: c.t, createdAt: c.t, top, bottom, state: 'open', filledAt: null })
  }

  // ---- swings, EQ, rejection blocks ---------------------------------------------------------------------------------

  private detectSwings(c: SeriesCandle, i: number): void {
    const n = this.params.swingN
    const center = i - n
    if (center < n) return
    const cc = this.candles[center]!
    let high = true
    let low = true
    for (let k = center - n; k <= center + n; k++) {
      if (k === center) continue
      const x = this.candles[k]!
      if (x.h >= cc.h) high = false
      if (x.l <= cc.l) low = false
    }
    if (high) this.addSwing('high', cc, c.t)
    if (low) this.addSwing('low', cc, c.t)
  }

  private addSwing(kind: 'high' | 'low', cc: SeriesCandle, createdAt: number): void {
    const price = kind === 'high' ? cc.h : cc.l
    const swing: Swing = { id: `${this.interval}:s${kind[0]}:${cc.t}`, interval: this.interval, kind, at: cc.t, price, createdAt, cls: 'ST', takenAt: null }
    this.swings.push(swing)
    const list = kind === 'high' ? this.highs : this.lows
    list.push(swing)
    this.classify(list, kind === 'high' ? this.itHighs : this.itLows, kind)
    if (kind === 'high') this.lastHigh = swing
    else this.lastLow = swing
    // Liquidity pool of the swing.
    this.pools.push({
      id: `${this.interval}:pool:${swing.id}`,
      interval: this.interval,
      kind: kind === 'high' ? 'SWING_H' : 'SWING_L',
      side: kind === 'high' ? 'BSL' : 'SSL',
      price,
      at: cc.t,
      createdAt,
      label: `${this.tag} swing ${kind === 'high' ? 'H' : 'L'}`,
      state: 'untouched',
      takenAt: null,
      expiredAt: null,
      rank: 1
    })
    this.detectEq(list, createdAt)
    this.detectRejection(cc, kind, createdAt)
  }

  /** ST → IT when a swing stands out from both neighbours; IT → LT the same way among IT swings. */
  private classify(list: Swing[], itList: Swing[], kind: 'high' | 'low'): void {
    const better = (a: number, b: number) => (kind === 'high' ? a > b : a < b)
    const k = list.length - 2
    if (k >= 1) {
      const s = list[k]!
      if (better(s.price, list[k - 1]!.price) && better(s.price, list[k + 1]!.price)) {
        s.cls = 'IT'
        itList.push(s)
        const j = itList.length - 2
        if (j >= 1) {
          const it = itList[j]!
          if (better(it.price, itList[j - 1]!.price) && better(it.price, itList[j + 1]!.price)) it.cls = 'LT'
        }
      }
    }
  }

  /** EQH / EQL: the new swing and an earlier one of the same kind within the tolerance, nothing between them beyond. */
  private detectEq(list: Swing[], createdAt: number): void {
    const b = list[list.length - 1]!
    const tol = this.eqTol
    for (let k = list.length - 2; k >= 0 && k >= list.length - 6; k--) {
      const a = list[k]!
      if (Math.abs(a.price - b.price) > tol) continue
      const level = b.kind === 'high' ? Math.max(a.price, b.price) : Math.min(a.price, b.price)
      let clean = true
      for (let j = this.candles.length - 1; j >= 0; j--) {
        const x = this.candles[j]!
        if (x.t <= a.at) break
        if (x.t >= b.at) continue
        if (b.kind === 'high' ? x.h > level + tol : x.l < level - tol) {
          clean = false
          break
        }
      }
      if (!clean) continue
      const kind = b.kind === 'high' ? 'EQH' : 'EQL'
      this.pools.push({
        id: `${this.interval}:pool:${kind}:${b.at}`,
        interval: this.interval,
        kind,
        side: b.kind === 'high' ? 'BSL' : 'SSL',
        price: level,
        at: b.at,
        createdAt,
        label: `${this.tag} ${kind}`,
        state: 'untouched',
        takenAt: null,
        expiredAt: null,
        rank: 1
      })
      return
    }
  }

  /** Rejection block: a long wick on the swing candle (wick ≥ ratio × body), zone from the body end to the wick end. */
  private detectRejection(cc: SeriesCandle, kind: 'high' | 'low', createdAt: number): void {
    const b = body(cc)
    const wick = kind === 'high' ? cc.h - Math.max(cc.o, cc.c) : Math.min(cc.o, cc.c) - cc.l
    if (wick < this.params.rejectionWickRatio * Math.max(b, this.pipSize) || this.pips(wick) < 1) return
    this.rejections.push({
      id: `${this.interval}:rb:${cc.t}:${kind}`,
      interval: this.interval,
      dir: kind === 'high' ? 'bear' : 'bull',
      at: cc.t,
      createdAt,
      top: kind === 'high' ? cc.h : Math.min(cc.o, cc.c),
      bottom: kind === 'high' ? Math.max(cc.o, cc.c) : cc.l,
      state: 'valid',
      invalidatedAt: null
    })
  }

  // ---- structure, order blocks, OTE ----------------------------------------------------------------------------

  private detectStructure(c: SeriesCandle, i: number): void {
    if (this.lastHigh && c.c > this.lastHigh.price) this.structureBreak('bull', this.lastHigh, c, i)
    if (this.lastLow && c.c < this.lastLow.price) this.structureBreak('bear', this.lastLow, c, i)
  }

  private structureBreak(dir: Dir, swing: Swing, c: SeriesCandle, i: number): void {
    if (dir === 'bull') this.lastHigh = null
    else this.lastLow = null
    if (swing.takenAt === null) swing.takenAt = c.t
    const disp = this.lastDisp[dir]
    const withDisplacement = disp !== null && disp.endIndex >= i - 2
    const shift = this.trend !== dir
    if (shift && !withDisplacement) return // a close beyond the opposite swing without displacement: no MSS
    const kind = shift ? 'MSS' : 'BOS'
    const event: StructureEvent = {
      id: `${this.interval}:${kind.toLowerCase()}:${c.t}`,
      interval: this.interval,
      kind,
      dir,
      at: c.t,
      createdAt: c.t,
      level: swing.price,
      swingAt: swing.at,
      displacementId: withDisplacement ? disp.id : null
    }
    this.structure.push(event)
    this.trend = dir
    if (withDisplacement) this.detectOrderBlock(dir, disp, event, c)
    if (kind === 'MSS') this.startOte(dir, event, c)
  }

  /** The last opposite candle before the displacement run; zone = its body. */
  private detectOrderBlock(dir: Dir, disp: LastDisplacement, event: StructureEvent, c: SeriesCandle): void {
    const opposite = dir === 'bull' ? isBear : isBull
    for (let k = disp.startIndex - 1; k >= 0 && k >= disp.startIndex - 10; k--) {
      const x = this.candles[k]!
      if (!opposite(x)) continue
      if (this.blocks.some((b) => b.at === x.t)) return
      const top = Math.max(x.o, x.c)
      const bottom = Math.min(x.o, x.c)
      this.blocks.push({
        id: `${this.interval}:ob:${x.t}`,
        interval: this.interval,
        dir,
        at: x.t,
        createdAt: c.t,
        top,
        bottom,
        mt: (top + bottom) / 2,
        structureId: event.id,
        kind: 'OB',
        state: 'valid',
        invalidatedAt: null,
        flippedAt: null,
        flipInvalidatedAt: null
      })
      return
    }
  }

  /** OTE of the impulse leg: from the last swing of the other kind to the extreme reached so far. */
  private startOte(dir: Dir, event: StructureEvent, c: SeriesCandle): void {
    const origin = dir === 'bull' ? this.lastLow : this.lastHigh
    if (!origin) return
    for (const o of this.otes) {
      if (o.state === 'active' && o.dir !== dir) {
        o.state = 'invalid'
        o.invalidatedAt = c.t
      }
    }
    let legEnd = dir === 'bull' ? -Infinity : Infinity
    let legEndAt = c.t
    for (let k = this.candles.length - 1; k >= 0; k--) {
      const x = this.candles[k]!
      if (x.t < origin.at) break
      if (dir === 'bull' ? x.h > legEnd : x.l < legEnd) {
        legEnd = dir === 'bull' ? x.h : x.l
        legEndAt = x.t
      }
    }
    const o: Ote = {
      id: `${this.interval}:ote:${event.at}`,
      interval: this.interval,
      dir,
      structureId: event.id,
      legStartAt: origin.at,
      legStart: origin.price,
      createdAt: c.t,
      legEnd,
      legEndAt,
      l62: 0,
      l705: 0,
      l79: 0,
      state: 'active',
      invalidatedAt: null
    }
    this.oteLevels(o)
    this.otes.push(o)
  }

  // ---- dealing range -------------------------------------------------------------------------------------------

  /** Between the last significant swing high and low (IT when available, else ST), extended by price beyond them. */
  private updateDealingRange(c: SeriesCandle): void {
    const hi = this.itHighs.at(-1) ?? this.highs.at(-1)
    const lo = this.itLows.at(-1) ?? this.lows.at(-1)
    if (!hi || !lo) return
    let high = hi.price
    let highAt = hi.at
    let low = lo.price
    let lowAt = lo.at
    for (let k = this.candles.length - 1; k >= 0; k--) {
      const x = this.candles[k]!
      if (x.t <= Math.min(hi.at, lo.at)) break
      if (x.t > hi.at && x.h > high) {
        high = x.h
        highAt = x.t
      }
      if (x.t > lo.at && x.l < low) {
        low = x.l
        lowAt = x.t
      }
    }
    const eq = (high + low) / 2
    this.dealingRange = { interval: this.interval, high, highAt, low, lowAt, eq, zone: c.c >= eq ? 'premium' : 'discount', updatedAt: c.t }
  }

  // ---- sweeps --------------------------------------------------------------------------------------------------

  private detectSweeps(c: SeriesCandle, pools: readonly Pool[]): void {
    const min = this.params.sweepMinPips * this.pipSize
    // Pending sweeps from earlier candles: close back inside within K candles, else it was a breakout.
    for (let k = this.pending.length - 1; k >= 0; k--) {
      const p = this.pending[k]!
      const above = p.pool.side === 'BSL'
      p.extreme = above ? Math.max(p.extreme, c.h) : Math.min(p.extreme, c.l)
      if (above ? c.c < p.pool.price : c.c > p.pool.price) {
        this.confirmSweep(p, c)
        this.pending.splice(k, 1)
      } else if (--p.left <= 0) this.pending.splice(k, 1)
    }
    for (const pool of pools) {
      if (pool.state !== 'untouched') continue
      const above = pool.side === 'BSL'
      const beyond = above ? c.h >= pool.price + min : c.l <= pool.price - min
      if (!beyond) continue
      pool.state = 'taken'
      pool.takenAt = c.t
      const swing = pool.kind === 'SWING_H' || pool.kind === 'SWING_L' ? this.swings.find((s) => pool.id.endsWith(s.id)) : undefined
      if (swing && swing.takenAt === null) swing.takenAt = c.t
      const p: PendingSweep = { pool, at: c.t, extreme: above ? c.h : c.l, left: this.params.sweepK }
      if (above ? c.c < pool.price : c.c > pool.price) this.confirmSweep(p, c)
      else this.pending.push(p)
    }
  }

  private confirmSweep(p: PendingSweep, c: SeriesCandle): void {
    this.sweeps.push({
      id: `${this.interval}:sweep:${p.pool.id}:${p.at}`,
      interval: this.interval,
      poolId: p.pool.id,
      poolKind: p.pool.kind,
      side: p.pool.side,
      level: p.pool.price,
      at: p.at,
      createdAt: c.t,
      extreme: p.extreme,
      closedBackAt: c.t
    })
  }

  objects(): IntervalObjects {
    return {
      interval: this.interval,
      swings: this.swings,
      fvgs: this.fvgs,
      displacements: this.displacements,
      structure: this.structure,
      blocks: this.blocks,
      otes: this.otes,
      sweeps: this.sweeps,
      rejections: this.rejections,
      bprs: this.bprs,
      imbalances: this.imbalances,
      dealingRange: this.dealingRange,
      trend: this.trend,
      lastAt: this.lastAt
    }
  }
}
