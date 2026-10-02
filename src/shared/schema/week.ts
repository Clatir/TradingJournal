import { z } from 'zod'
import { clockTime, nullableNumber, recordBase, text } from './common'

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri'] as const
export const weekdaySchema = z.enum(WEEKDAYS)
export type Weekday = z.infer<typeof weekdaySchema>

export const weekDaySchema = z.looseObject({
  day: weekdaySchema,
  high: nullableNumber,
  low: nullableNumber,
  /** New York local time of the daily high / low. */
  highTimeNy: clockTime.nullable().default(null),
  lowTimeNy: clockTime.nullable().default(null)
})

export const weekPairSchema = z.looseObject({
  pair: z.string().min(1),
  days: z.array(weekDaySchema).default(() => WEEKDAYS.map((day) => weekDaySchema.parse({ day }))),
  weekHighDay: weekdaySchema.nullable().default(null),
  weekLowDay: weekdaySchema.nullable().default(null),
  source: z.enum(['manual', 'csv']).default('manual'),
  notes: text
})
export type WeekPair = z.infer<typeof weekPairSchema>

export const weekReviewSchema = z.looseObject({
  ...recordBase,
  /** ISO week, e.g. 2026-W40. */
  week: z.string().regex(/^\d{4}-W\d{2}$/),
  pairs: z.array(weekPairSchema).default([]),
  conclusions: text,
  goalNextWeek: text,
  previousGoalResult: z.enum(['yes', 'partial', 'no']).nullable().default(null),
  previousGoalNote: text
})
export type WeekReview = z.infer<typeof weekReviewSchema>
