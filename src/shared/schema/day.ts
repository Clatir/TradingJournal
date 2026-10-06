import { z } from 'zod'
import { isoDate, isoDateTime, nullableNumber, recordBase, screenRefSchema, text, ulidSchema } from './common'

export const biasDirectionSchema = z.enum(['bullish', 'bearish', 'neutral'])
export type BiasDirection = z.infer<typeof biasDirectionSchema>

const biasSchema = z.looseObject({
  direction: biasDirectionSchema.nullable().default(null),
  reason: text
})

export const BIAS_TIMEFRAMES = ['W', 'D', 'H4', 'H1'] as const
export type BiasTimeframe = (typeof BIAS_TIMEFRAMES)[number]

export const dayPairSchema = z.looseObject({
  pair: z.string().min(1),
  bias: z
    .looseObject({
      W: biasSchema.prefault({}),
      D: biasSchema.prefault({}),
      H4: biasSchema.prefault({}),
      H1: biasSchema.prefault({})
    })
    .prefault({}),
  drawOnLiquidity: text,
  keyLevels: z
    .array(z.looseObject({ id: ulidSchema, price: nullableNumber, label: text }))
    .default([]),
  scenarioPrimary: text,
  scenarioAlternative: text,
  screens: z.array(screenRefSchema).default([])
})
export type DayPair = z.infer<typeof dayPairSchema>

export const intermarketSchema = z.looseObject({
  instrument: z.string().min(1),
  read: text,
  relation: z.enum(['confirms', 'diverges', 'neutral']).nullable().default(null)
})

export const newsSchema = z.looseObject({
  id: ulidSchema,
  time: isoDateTime,
  currency: z.string().default('USD'),
  title: text,
  impact: z.enum(['high']).default('high')
})
export type NewsItem = z.infer<typeof newsSchema>

/** A stretch of analysis time; `pair` = the pair analysed in it (null = the portfolio as a whole). */
export const sessionSegmentSchema = z.looseObject({
  start: isoDateTime,
  end: isoDateTime.nullable().default(null),
  pair: z.string().nullable().default(null)
})
export type SessionSegment = z.infer<typeof sessionSegmentSchema>

export const pairDecisionSchema = z.enum(['trade', 'watch', 'reject'])
export type PairDecision = z.infer<typeof pairDecisionSchema>

export const sessionPairSchema = z.looseObject({
  pair: z.string().min(1),
  decision: pairDecisionSchema.nullable().default(null),
  /** Reasons of a rejection (dictionaries.rejectReasons). */
  reasonIds: z.array(ulidSchema).default([]),
  note: text,
  /** Minutes set by hand (null = measured per pair, the rest split evenly). */
  minutes: z.number().nonnegative().nullable().default(null),
  /** Rejected pair, asked later: did it give a good setup after all? */
  review: z.enum(['setup', 'noSetup', 'unknown']).nullable().default(null)
})
export type SessionPair = z.infer<typeof sessionPairSchema>

/** Analysis of the whole portfolio (since 1.4.0): stopwatch time, then a decision for every pair. */
export const analysisSessionSchema = z.looseObject({
  id: ulidSchema,
  name: text,
  /** Computer the stopwatch runs on. */
  machine: z.string().nullable().default(null),
  segments: z.array(sessionSegmentSchema).default([]),
  /** Total minutes set by hand (null = the segments). */
  minutesOverride: z.number().nonnegative().nullable().default(null),
  pairs: z.array(sessionPairSchema).default([]),
  /** Stopped for good (a paused session has no endedAt). */
  endedAt: isoDateTime.nullable().default(null),
  decidedAt: isoDateTime.nullable().default(null)
})
export type AnalysisSession = z.infer<typeof analysisSessionSchema>

export const dayPlanSchema = z.looseObject({
  ...recordBase,
  /** Trading date (New York calendar date). */
  date: isoDate,
  pairs: z.array(dayPairSchema).default([]),
  intermarket: z.array(intermarketSchema).default([]),
  news: z.array(newsSchema).default([]),
  review: z
    .looseObject({
      whatHappened: text,
      vsPlan: z.enum(['matched', 'partial', 'missed']).nullable().default(null),
      notes: text
    })
    .prefault({}),
  notes: text,
  screens: z.array(screenRefSchema).default([]),
  /** Since 1.4.0. */
  sessions: z.array(analysisSessionSchema).default([])
})
export type DayPlan = z.infer<typeof dayPlanSchema>
