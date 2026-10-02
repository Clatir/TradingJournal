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
  screens: z.array(screenRefSchema).default([])
})
export type DayPlan = z.infer<typeof dayPlanSchema>
