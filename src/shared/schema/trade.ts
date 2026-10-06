import { z } from 'zod'
import { directionSchema, isoDateTime, nullableNumber, recordBase, screenRefSchema, text, ulidSchema } from './common'

export const tradeStatusSchema = z.enum(['open', 'closed', 'missed'])
export type TradeStatus = z.infer<typeof tradeStatusSchema>

export const exitSchema = z.looseObject({
  id: ulidSchema,
  time: isoDateTime.nullable().default(null),
  price: nullableNumber,
  /** Share of the position closed by this exit, 0..100. */
  percent: z.number().min(0).max(100).default(100),
  note: text
})
export type TradeExit = z.infer<typeof exitSchema>

const moodSchema = z.looseObject({
  /** 1 (bardzo źle) .. 5 (bardzo dobrze), null = nie oceniono */
  score: z.number().int().min(1).max(5).nullable().default(null),
  note: text
})

export const psychologySchema = z.looseObject({
  before: moodSchema.prefault({}),
  during: moodSchema.prefault({}),
  after: moodSchema.prefault({}),
  mistakeTagIds: z.array(ulidSchema).default([]),
  didWell: text,
  nextTime: text
})

/** The broker's position (history import), kept for reconciliation; amounts in `currency`, times UTC. */
export const brokerFillSchema = z.looseObject({
  tickets: z.array(z.string()).default([]),
  symbol: text,
  volume: nullableNumber,
  openTime: isoDateTime.nullable().default(null),
  closeTime: isoDateTime.nullable().default(null),
  openPrice: nullableNumber,
  closePrice: nullableNumber,
  profit: nullableNumber,
  commission: nullableNumber,
  swap: nullableNumber,
  net: nullableNumber,
  currency: z.string().regex(/^[A-Z]{3}$/).nullable().default(null),
  importedAt: isoDateTime.nullable().default(null),
  /** Where the numbers came from: a broker file (default) or a screenshot read by OCR (1.4.6). */
  source: z.enum(['file', 'screen']).optional()
})
export type BrokerFill = z.infer<typeof brokerFillSchema>

export const tradeSchema = z.looseObject({
  ...recordBase,
  status: tradeStatusSchema.default('closed'),
  pair: z.string().min(1),
  direction: directionSchema,
  entryTime: isoDateTime,
  /** null = wykrywana automatycznie z czasu wejścia; 'none' = poza killzone (ręcznie) */
  killzoneOverride: z.string().nullable().default(null),
  entryModelId: ulidSchema.nullable().default(null),
  entryPdArrayId: ulidSchema.nullable().default(null),
  htfPdArrayId: ulidSchema.nullable().default(null),
  liquidityTakenIds: z.array(ulidSchema).default([]),
  prices: z
    .looseObject({
      entry: nullableNumber,
      stopLoss: nullableNumber,
      takeProfit1: nullableNumber,
      takeProfit2: nullableNumber
    })
    .prefault({}),
  exits: z.array(exitSchema).default([]),
  maePips: nullableNumber,
  mfePips: nullableNumber,
  riskPercent: nullableNumber,
  riskAmount: nullableNumber,
  lots: nullableNumber,
  pnlAmountOverride: nullableNumber,
  /** Currency of `riskAmount` and `pnlAmountOverride` (the account currency when typed); null = before 1.3.0. */
  amountCurrency: z.string().regex(/^[A-Z]{3}$/).nullable().default(null),
  tradingViewUrl: text,
  stopBeyondLiquidity: z.enum(['yes', 'no', 'unknown']).default('unknown'),
  psychology: psychologySchema.prefault({}),
  missed: z
    .looseObject({
      reasonId: ulidSchema.nullable().default(null),
      hypotheticalOutcome: z.enum(['tp1', 'tp2', 'sl', 'none']).nullable().default(null)
    })
    .prefault({}),
  notes: text,
  screens: z.array(screenRefSchema).default([]),
  /** Since 1.3.0; null = not imported from a broker's history. */
  broker: brokerFillSchema.nullable().default(null),
  /** Values of the user's own fields by field id (since 1.4.0): text, number, option id or yes/no. */
  custom: z.record(z.string().max(40), z.union([z.string().max(2000), z.number().finite(), z.boolean(), z.null()])).default({})
})
export type Trade = z.infer<typeof tradeSchema>
