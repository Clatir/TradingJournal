import { z } from 'zod'
import { directionSchema, isoDate, recordBase, screenRefSchema, text, ulidSchema } from './common'

export const libraryItemSchema = z.looseObject({
  ...recordBase,
  title: text,
  type: z.enum(['live', 'backtest']).default('backtest'),
  pair: z.string().nullable().default(null),
  direction: directionSchema.nullable().default(null),
  date: isoDate.nullable().default(null),
  entryModelId: ulidSchema.nullable().default(null),
  killzoneId: ulidSchema.nullable().default(null),
  pdArrayIds: z.array(ulidSchema).default([]),
  notes: text,
  linkedTradeId: ulidSchema.nullable().default(null),
  screens: z.array(screenRefSchema).default([])
})
export type LibraryItem = z.infer<typeof libraryItemSchema>
