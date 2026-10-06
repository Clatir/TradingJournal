import { z } from 'zod'
import { directionSchema, isoDateTime, recordBase, ulidSchema } from './common'

export const DRILL_MAX_CARDS = 50

/** The answer on a card: take it long / short, or stay out. */
export const drillAnswerSchema = z.enum(['long', 'short', 'skip'])
export type DrillAnswer = z.infer<typeof drillAnswerSchema>

/** What the trade really was when the card was answered (kept, so later edits or deletion do not rewrite the score). */
export const drillTruthSchema = z.looseObject({
  direction: directionSchema,
  status: z.enum(['closed', 'missed']),
  resultR: z.number().finite().nullable().default(null),
  outcome: z.enum(['win', 'loss', 'breakeven']).nullable().default(null),
  riskPips: z.number().finite().nullable().default(null)
})
export type DrillTruth = z.infer<typeof drillTruthSchema>

export const drillCardSchema = z.looseObject({
  tradeId: ulidSchema,
  pair: z.string().max(20).default(''),
  answer: drillAnswerSchema.nullable().default(null),
  /** Guessed stop loss in pips (optional). */
  slPips: z.number().positive().max(100000).nullable().default(null),
  answeredAt: isoDateTime.nullable().default(null),
  truth: drillTruthSchema.nullable().default(null)
})
export type DrillCard = z.infer<typeof drillCardSchema>

/** One training session (drills/ULID.json): "before" screens of past trades, the answer, then the reveal. */
export const drillSessionSchema = z.looseObject({
  ...recordBase,
  startedAt: isoDateTime,
  machine: z.string().max(200).nullable().default(null),
  cards: z.array(drillCardSchema).max(DRILL_MAX_CARDS).default([]),
  finishedAt: isoDateTime.nullable().default(null)
})
export type DrillSession = z.infer<typeof drillSessionSchema>
