/**
 * Objects produced by the ICT detectors (docs/skaner/definicje.md). Every object has an `id` that is deterministic
 * (symbol-independent: interval + kind + time), a `createdAt` = time of the closed candle that produced it, and
 * identity fields that never change afterwards. Fields marked "state" only progress (open → touched → filled…),
 * which is what the no-look-ahead test allows.
 */
import type { Interval } from '../types'

export type Dir = 'bull' | 'bear'
export type SwingKind = 'high' | 'low'
export type SwingClass = 'ST' | 'IT' | 'LT'

export interface Swing {
  id: string
  interval: Interval
  kind: SwingKind
  /** Time of the swing candle. */
  at: number
  price: number
  /** Time of the candle that confirmed it (N bars to the right). */
  createdAt: number
  /** state */
  cls: SwingClass
  /** state: a later candle traded beyond the swing (liquidity taken). */
  takenAt: number | null
}

export type FvgState = 'open' | 'touched' | 'ce' | 'filled' | 'inverted'

export interface Fvg {
  id: string
  interval: Interval
  dir: Dir
  /** Time of the third candle (also createdAt). */
  at: number
  createdAt: number
  top: number
  bottom: number
  ce: number
  sizePips: number
  /** state (monotone): open → touched → ce → filled; inverted = closed through the whole gap. */
  state: FvgState
  touchedAt: number | null
  ceAt: number | null
  filledAt: number | null
  invertedAt: number | null
}

export interface Displacement {
  id: string
  interval: Interval
  dir: Dir
  /** First and last candle of the run (1–3 candles). */
  from: number
  to: number
  createdAt: number
  bodySum: number
  avgBody: number
  ratio: number
  fvgId: string
}

export type StructureKind = 'MSS' | 'BOS'

export interface StructureEvent {
  id: string
  interval: Interval
  kind: StructureKind
  dir: Dir
  /** Time of the closing candle (createdAt). */
  at: number
  createdAt: number
  /** Price of the broken swing and its time. */
  level: number
  swingAt: number
  displacementId: string | null
}

export type BlockKind = 'OB' | 'breaker' | 'mitigation'
export type BlockState = 'valid' | 'invalid'

export interface OrderBlock {
  id: string
  interval: Interval
  /** Direction the block supports (a bull OB is a demand zone). */
  dir: Dir
  /** Time of the block candle. */
  at: number
  createdAt: number
  /** Body only: open / close, mean threshold = 50%. */
  top: number
  bottom: number
  mt: number
  structureId: string
  /** state: kind changes OB → breaker / mitigation when price closes through it with displacement. */
  kind: BlockKind
  state: BlockState
  invalidatedAt: number | null
  /** state: when it became a breaker / mitigation block (then `dir` is the new direction). */
  flippedAt: number | null
  /** state: when the breaker / mitigation block was closed through in turn. */
  flipInvalidatedAt: number | null
}

export type PoolKind = 'PDH' | 'PDL' | 'PWH' | 'PWL' | 'PMH' | 'PML' | 'SESSION_H' | 'SESSION_L' | 'EQH' | 'EQL' | 'SWING_H' | 'SWING_L' | 'IPDA_H' | 'IPDA_L'
/** Buy-side liquidity sits above price (highs), sell-side below (lows). */
export type PoolSide = 'BSL' | 'SSL'
export type PoolState = 'untouched' | 'taken' | 'expired'

export interface Pool {
  id: string
  /** Interval of the source ('M15' for session levels, 'D' for daily / IPDA levels). */
  interval: Interval
  kind: PoolKind
  side: PoolSide
  price: number
  /** Time of the candle / swing that set the level. */
  at: number
  createdAt: number
  /** Chart label, e.g. "PDH", "EQH", "Asia H", "IPDA 20d H". */
  label: string
  /** state */
  state: PoolState
  takenAt: number | null
  expiredAt: number | null
  /** state: number of intervals on which a level sits within the EQ tolerance (1 = only this one). */
  rank: number
}

export interface Sweep {
  id: string
  /** Interval of the candles that made the sweep. */
  interval: Interval
  poolId: string
  poolKind: PoolKind
  side: PoolSide
  level: number
  /** First candle beyond the level (createdAt = the candle that closed back inside). */
  at: number
  createdAt: number
  /** Extreme reached beyond the level. */
  extreme: number
  closedBackAt: number
}

export interface DealingRange {
  interval: Interval
  high: number
  highAt: number
  low: number
  lowAt: number
  eq: number
  /** Position of the last close. */
  zone: 'premium' | 'discount'
  updatedAt: number
}

export interface Ote {
  id: string
  interval: Interval
  dir: Dir
  structureId: string
  /** Start of the impulse leg (the swing the MSS came from). */
  legStartAt: number
  legStart: number
  createdAt: number
  /** state: extreme of the leg so far. */
  legEnd: number
  legEndAt: number
  l62: number
  l705: number
  l79: number
  state: 'active' | 'invalid'
  invalidatedAt: number | null
}

export type OpenKind = 'midnight' | '0830' | 'week'

export interface OpenLevel {
  id: string
  kind: OpenKind
  /** Time of the candle whose open is the level. */
  at: number
  createdAt: number
  price: number
  label: string
  /** state: replaced by the next day's / week's level. */
  expiredAt: number | null
}

export interface Gap {
  id: string
  kind: 'NDOG' | 'NWOG'
  /** Time of the first candle after the gap. */
  at: number
  createdAt: number
  top: number
  bottom: number
  ce: number
  expiredAt: number | null
}

/** Extensions (section 5.2): no own signals, only for scoring and chart layers. */
export interface RejectionBlock {
  id: string
  interval: Interval
  dir: Dir
  at: number
  createdAt: number
  /** From the body end to the wick end. */
  top: number
  bottom: number
  state: 'valid' | 'invalid'
  invalidatedAt: number | null
}

export interface Bpr {
  id: string
  interval: Interval
  /** Direction of the later FVG. */
  dir: Dir
  at: number
  createdAt: number
  top: number
  bottom: number
  bullFvgId: string
  bearFvgId: string
}

export interface VolumeImbalance {
  id: string
  interval: Interval
  dir: Dir
  at: number
  createdAt: number
  top: number
  bottom: number
  state: 'open' | 'filled'
  filledAt: number | null
}

export interface IntervalObjects {
  interval: Interval
  swings: Swing[]
  fvgs: Fvg[]
  displacements: Displacement[]
  structure: StructureEvent[]
  blocks: OrderBlock[]
  otes: Ote[]
  sweeps: Sweep[]
  rejections: RejectionBlock[]
  bprs: Bpr[]
  imbalances: VolumeImbalance[]
  dealingRange: DealingRange | null
  /** Current structure direction (after the last MSS / BOS). */
  trend: Dir | null
  /** Last closed candle time. */
  lastAt: number | null
}

export interface EngineSnapshot {
  intervals: Partial<Record<Interval, IntervalObjects>>
  /** All pools (swing, EQ, daily, weekly, monthly, session, IPDA) with ranks. */
  pools: Pool[]
  opens: OpenLevel[]
  gaps: Gap[]
}

/** Orders of intervals for "higher timeframe" checks. */
export const INTERVAL_ORDER: Record<Interval, number> = { M1: 0, M5: 1, M15: 2, H1: 3, H4: 4, D: 5, W: 6 }

/** TradingView-style label of an interval for HTF objects ("60 FVG", "240 FVG", "D FVG"). */
export const INTERVAL_LABEL: Record<Interval, string> = { M1: '1', M5: '5', M15: '15', H1: '60', H4: '240', D: 'D', W: 'W' }
