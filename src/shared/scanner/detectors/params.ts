/**
 * Detector parameters (settings.scanner.detectors): defaults from the specification, section 5.1, and the windows
 * from section 14 (killzones London 02:00–04:40 and NY 07:00–10:00, Silver Bullet only 03:00–04:00). All in pips of
 * the instrument; times are New York wall clock.
 */
import { z } from 'zod'
import { clockTime } from '../../schema/common'

const pips = (d: number) => z.number().min(0).catch(d).default(d)

export const intervalPipsSchema = z.looseObject({
  M5: pips(1),
  M15: pips(2),
  H1: pips(4),
  H4: pips(8),
  D: pips(15),
  W: pips(15)
})

export const windowSchema = z.looseObject({
  id: z.string().min(1).max(20),
  label: z.string().max(30).default(''),
  /** NY wall clock; `to` before `from` = through midnight. */
  from: clockTime,
  to: clockTime
})
export type TimeWindow = z.infer<typeof windowSchema>

export const detectorParamsSchema = z.looseObject({
  /** Candles on each side of a swing (1 = classic 3-candle swing). */
  swingN: z.number().int().min(1).max(5).catch(1).default(1),
  /** EQH / EQL tolerance per interval (pips). */
  eqTolerancePips: z.looseObject({ M5: pips(2), M15: pips(2), H1: pips(3), H4: pips(5), D: pips(5), W: pips(5) }).prefault({}),
  /** Wick beyond a pool that counts as a sweep (pips) and how many candles may close beyond before it is a breakout. */
  sweepMinPips: pips(0.5),
  sweepK: z.number().int().min(1).max(10).catch(3).default(3),
  /** Displacement: body sum of 1–3 candles ≥ m × average body of the previous N candles, and an FVG. */
  displacementM: z.number().min(1).catch(2).default(2),
  displacementLookback: z.number().int().min(5).max(100).catch(20).default(20),
  /** Minimum FVG size per interval (pips). */
  fvgMinPips: intervalPipsSchema.prefault({}),
  /** Rejection block: wick at least this many times the body. */
  rejectionWickRatio: z.number().min(1).catch(2).default(2),
  /** IPDA look-backs in trading days. */
  ipdaDays: z.array(z.number().int().min(5).max(250)).catch([20, 40, 60]).default([20, 40, 60]),
  /** Sessions (NY time) whose highs and lows are liquidity pools. */
  sessions: z
    .array(windowSchema)
    .default(() => [
      { id: 'asia', label: 'Asia', from: '20:00', to: '00:00' },
      { id: 'london', label: 'London', from: '02:00', to: '05:00' },
      { id: 'nyam', label: 'NY AM', from: '07:00', to: '10:00' }
    ]),
  /** Entry windows (killzones) – an entry counts only inside one of them (section 14.3). */
  windows: z
    .array(windowSchema)
    .default(() => [
      { id: 'london', label: 'London KZ', from: '02:00', to: '04:40' },
      { id: 'ny', label: 'NY KZ', from: '07:00', to: '10:00' }
    ]),
  /** Silver Bullet windows (model 3 only; the classic 10–11 and 14–15 are outside the killzones and dropped). */
  silverBullet: z.array(windowSchema).default(() => [{ id: 'sb-london', label: 'SB', from: '03:00', to: '04:00' }])
})
export type DetectorParams = z.infer<typeof detectorParamsSchema>

export function defaultDetectorParams(): DetectorParams {
  return detectorParamsSchema.parse({})
}
