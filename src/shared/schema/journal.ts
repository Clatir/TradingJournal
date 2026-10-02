import { z } from 'zod'
import { clockTime, isoDateTime, recordBase, ulidSchema } from './common'

export const pairConfigSchema = z.looseObject({
  symbol: z.string().regex(/^[A-Z0-9]{3,12}$/, 'Symbol: wielkie litery i cyfry, np. EURUSD'),
  pipSize: z.number().positive(),
  priceDecimals: z.number().int().min(0).max(8).default(5),
  quoteCurrency: z.string().regex(/^[A-Z]{3}$/),
  tvSymbol: z.string().default(''),
  archived: z.boolean().default(false)
})
export type PairConfig = z.infer<typeof pairConfigSchema>

export const killzoneSchema = z.looseObject({
  id: ulidSchema,
  name: z.string().min(1),
  /** Times are New York local time. */
  start: clockTime,
  end: clockTime,
  kind: z.enum(['killzone', 'silverBullet']).default('killzone'),
  archived: z.boolean().default(false)
})
export type Killzone = z.infer<typeof killzoneSchema>

export const dictItemSchema = z.looseObject({
  id: ulidSchema,
  name: z.string().min(1),
  archived: z.boolean().default(false)
})
export type DictItem = z.infer<typeof dictItemSchema>

export const DICTIONARY_KEYS = ['entryModels', 'pdArrays', 'liquidityPools', 'mistakeTags', 'missedReasons'] as const
export type DictionaryKey = (typeof DICTIONARY_KEYS)[number]

export const dictionariesSchema = z.looseObject({
  entryModels: z.array(dictItemSchema).default([]),
  pdArrays: z.array(dictItemSchema).default([]),
  liquidityPools: z.array(dictItemSchema).default([]),
  mistakeTags: z.array(dictItemSchema).default([]),
  missedReasons: z.array(dictItemSchema).default([]),
  timeframes: z.array(z.string().min(1)).default(['W', 'D', 'H4', 'H1', 'M15', 'M5', 'M1'])
})
export type Dictionaries = z.infer<typeof dictionariesSchema>

const toggle = z.looseObject({ enabled: z.boolean().default(true) })

export const rulesSchema = z.looseObject({
  maxStopPips: z.looseObject({ enabled: z.boolean().default(true), value: z.number().positive().default(20) }).prefault({}),
  minRiskReward: z.looseObject({ enabled: z.boolean().default(true), value: z.number().positive().default(2) }).prefault({}),
  requireKillzone: toggle.prefault({}),
  htfBias: z
    .looseObject({ enabled: z.boolean().default(true), timeframe: z.enum(['W', 'D', 'H4', 'H1']).default('D') })
    .prefault({}),
  stopBeyondLiquidity: toggle.prefault({}),
  /** Informational only: never lowers the compliance score. */
  newsDay: toggle.prefault({})
})
export type RulesSettings = z.infer<typeof rulesSchema>

export const settingsSchema = z.looseObject({
  pairs: z.array(pairConfigSchema).default([]),
  contextInstruments: z.array(z.string().min(1)).default(['DXY', 'EURX', 'FGBL1!', 'ZB1!']),
  killzones: z.array(killzoneSchema).default([]),
  rules: rulesSchema.prefault({}),
  risk: z
    .looseObject({
      accountCurrency: z.string().regex(/^[A-Z]{3}$/).default('USD'),
      accountBalance: z.number().nonnegative().nullable().default(null),
      defaultRiskPercent: z.number().positive().default(0.5),
      contractSize: z.number().positive().default(100000),
      lotStep: z.number().positive().default(0.01),
      dailyLossLimitR: z.number().positive().nullable().default(2),
      dailyMaxTrades: z.number().int().positive().nullable().default(3)
    })
    .prefault({}),
  stats: z
    .looseObject({
      /** |R| <= threshold counts as break-even and is excluded from win rate. */
      breakevenThresholdR: z.number().nonnegative().default(0.1)
    })
    .prefault({}),
  screens: z
    .looseObject({
      /**
       * auto = encode both and keep lossless when it is at most `autoMaxRatio` x the lossy size
       * (always the case for TradingView charts: pixel-exact axis digits at a similar size).
       */
      mode: z.enum(['auto', 'lossy', 'lossless']).default('auto'),
      /** WebP quality 1..100 used for lossy encoding. */
      quality: z.number().int().min(1).max(100).default(90),
      autoMaxRatio: z.number().min(1).max(5).default(1.3),
      maxWidth: z.number().int().min(320).max(10000).default(2560),
      thumbWidth: z.number().int().min(120).max(1200).default(480)
    })
    .prefault({}),
  display: z
    .looseObject({
      showMoney: z.boolean().default(false),
      timeInputZone: z.enum(['NY', 'WAW']).default('NY')
    })
    .prefault({})
})
export type Settings = z.infer<typeof settingsSchema>

export const journalSchema = z.looseObject({
  ...recordBase,
  createdAt: isoDateTime,
  settings: settingsSchema.prefault({}),
  dictionaries: dictionariesSchema.prefault({})
})
export type JournalFile = z.infer<typeof journalSchema>
