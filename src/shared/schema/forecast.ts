import { z } from 'zod'
import { recordBase, text, ulidSchema } from './common'

export const FORECAST_MAX_MONTHS = 240
export const FORECAST_MAX_GOALS = 10

const unit = z.number().min(0).lt(1) // one uniform draw in [0, 1)
const draws = z.array(unit).max(FORECAST_MAX_MONTHS).default([])

export const forecastGoalSchema = z.looseObject({
  id: ulidSchema,
  name: z.string().max(40).default(''),
  /** Forecast month number (1 = first month); null while the field is empty. */
  month: z.number().int().min(1).max(FORECAST_MAX_MONTHS).nullable().default(null),
  /** Price of the goal; null = the goal takes everything set aside in its month. */
  amount: z.number().positive().max(1e12).nullable().default(null),
  enabled: z.boolean().default(true),
  /** "Może poczekać": while it waits for its amount it does not block later goals. */
  flexible: z.boolean().default(false)
})
export type ForecastGoal = z.infer<typeof forecastGoalSchema>

export const forecastSchema = z.looseObject({
  ...recordBase,
  name: z.string().min(1).max(60),
  /** Currency of every amount in the scenario. */
  currency: z.string().regex(/^[A-Z]{3}$/),
  payoutPercent: z.number().min(0).max(100).default(50),
  gain: z.enum(['pct', 'pips']).default('pct'),
  pct: z
    .looseObject({
      mode: z.enum(['fixed', 'random']).default('random'),
      fixed: z.number().min(-100).max(100).default(11),
      lo: z.number().min(-100).max(100).default(7),
      hi: z.number().min(-100).max(100).default(10)
    })
    .prefault({}),
  pips: z
    .looseObject({
      instrumentId: z.string().default('EURUSD'),
      pipsMode: z.enum(['fixed', 'random']).default('fixed'),
      pips: z.number().min(-1e9).max(1e9).default(200),
      pipsLo: z.number().min(-1e9).max(1e9).default(100),
      pipsHi: z.number().min(-1e9).max(1e9).default(300),
      lotMode: z.enum(['fixed', 'perCapital', 'risk']).default('fixed'),
      lot: z.number().positive().max(1e9).default(0.1),
      /** perCapital: `lotPer` lots for every `lotPerAmount` of capital. */
      lotPer: z.number().positive().default(0.01),
      lotPerAmount: z.number().positive().default(1000),
      /** risk: lots from risk % of capital and a stop in pips. */
      riskPercent: z.number().positive().max(100).default(1),
      stopPips: z.number().positive().default(20),
      /** Upper limit for a scaled lot; null = none. */
      lotMax: z.number().positive().nullable().default(null)
    })
    .prefault({}),
  loss: z
    .looseObject({
      /** Chance (percent) that a month is a losing one; 0 = off. */
      probability: z.number().min(0).max(100).default(0),
      pctLo: z.number().min(0).max(100).default(2),
      pctHi: z.number().min(0).max(100).default(5),
      pipsLo: z.number().min(0).max(1e9).default(50),
      pipsHi: z.number().min(0).max(1e9).default(150)
    })
    .prefault({}),
  startCapital: z.number().min(0).max(1e12).default(10000),
  monthlyDeposit: z.number().min(0).max(1e12).default(0),
  /** First forecast month, "RRRR-MM". */
  firstMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  months: z.number().int().min(1).max(FORECAST_MAX_MONTHS).default(50),
  /** Custom deposit per month number ("1".."240"); negative = withdrawal from capital. */
  deposits: z.record(z.string().regex(/^\d{1,3}$/), z.number().min(-1e12).max(1e12)).default({}),
  keep: z.enum(['cash', 'fund']).default('fund'),
  goals: z.array(forecastGoalSchema).max(FORECAST_MAX_GOALS).default([]),
  tax: z
    .looseObject({
      enabled: z.boolean().default(false),
      ratePercent: z.number().min(0).max(100).default(19),
      /** Calendar month (1-12) in which the tax for the previous year is paid. */
      payMonth: z.number().int().min(1).max(12).default(4)
    })
    .prefault({}),
  /** Stored random numbers, so the scenario is the same on every machine. Index = month - 1. */
  draws: z.looseObject({ rate: draws, loss: draws, lossSize: draws, pips: draws }).prefault({}),
  monteCarloRuns: z.number().int().min(100).max(10000).default(1000),
  notes: text
})
export type Forecast = z.infer<typeof forecastSchema>
export type ForecastDraws = Forecast['draws']
