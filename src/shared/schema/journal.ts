import { z } from 'zod'
import { PNL_PRESETS } from '../calc/pnl'
import { clockTime, isoDate, isoDateTime, recordBase, text, ulidSchema } from './common'

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

export const DICTIONARY_KEYS = ['entryModels', 'pdArrays', 'liquidityPools', 'mistakeTags', 'missedReasons', 'rejectReasons'] as const
export type DictionaryKey = (typeof DICTIONARY_KEYS)[number]

/**
 * Reasons for rejecting a pair in an analysis session (since 1.4.0). Fixed ids: a journal from 1.3.x gets the same
 * defaults on every computer without writing anything.
 */
export const DEFAULT_REJECT_REASONS: ReadonlyArray<{ id: string; name: string }> = [
  { id: '01K6R00000000000000000RJ01', name: 'Brak biasu' },
  { id: '01K6R00000000000000000RJ02', name: 'Konsolidacja' },
  { id: '01K6R00000000000000000RJ03', name: 'News' },
  { id: '01K6R00000000000000000RJ04', name: 'Płynność już zebrana' },
  { id: '01K6R00000000000000000RJ05', name: 'Za daleko do POI' },
  { id: '01K6R00000000000000000RJ06', name: 'Brak czytelnej struktury' }
]

export const dictionariesSchema = z.looseObject({
  entryModels: z.array(dictItemSchema).default([]),
  pdArrays: z.array(dictItemSchema).default([]),
  liquidityPools: z.array(dictItemSchema).default([]),
  mistakeTags: z.array(dictItemSchema).default([]),
  missedReasons: z.array(dictItemSchema).default([]),
  rejectReasons: z.array(dictItemSchema).default(() => DEFAULT_REJECT_REASONS.map((r) => ({ ...r, archived: false }))),
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

/** Instrument of the P/L calculator and of the pip mode of the payout forecast. */
export const instrumentSchema = z.looseObject({
  /** Stable key; also the key of hand-entered pip values in risk.pipValuesPerLot. */
  id: z.string().regex(/^[A-Z0-9]{2,16}$/),
  name: z.string().min(1).max(24),
  /** Price change of one pip; null = no calculated pip value (hand-entered only). */
  pipSize: z.number().positive().nullable().default(null),
  /** Units per 1.00 lot; null = risk.contractSize. */
  contractSize: z.number().positive().nullable().default(null),
  /** Currency of the pip value; null = account currency. */
  quoteCurrency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable()
    .default(null),
  /** Smallest lot; null = risk.lotStep. */
  minLot: z.number().positive().nullable().default(null),
  description: text,
  archived: z.boolean().default(false)
})
export type Instrument = z.infer<typeof instrumentSchema>

/** The calculator presets as instruments (ids stay, so hand-entered pip values keep working). */
export function presetInstruments(): Instrument[] {
  return PNL_PRESETS.map((p) => ({
    id: p.id,
    name: p.label,
    pipSize: p.pipSize,
    contractSize: p.contractSize,
    quoteCurrency: p.quoteCurrency,
    minLot: null,
    description: p.description,
    archived: false
  }))
}

/** NBP table A: mid rates, PLN for 1 unit of the currency. */
export const nbpTableSchema = z.looseObject({
  no: z.string(),
  effectiveDate: isoDate,
  fetchedAt: isoDateTime,
  rates: z.record(z.string(), z.number().positive())
})
export type NbpTable = z.infer<typeof nbpTableSchema>

/** 1.2.0 kept hand-entered pip values per smallest lot; they are converted to values per 1.00 lot. */
function migrateLegacyPipValues<
  R extends { lotStep: number; pipValues: Record<string, number>; pipValuesPerLot: Record<string, number>; customInstrument: { minLot: number | null } }
>(r: R): R {
  const legacy = Object.entries(r.pipValues)
  if (!legacy.length) return r
  const pipValuesPerLot = { ...r.pipValuesPerLot }
  for (const [id, value] of legacy) {
    const minLot = id === 'CUSTOM' ? (r.customInstrument.minLot ?? r.lotStep) : r.lotStep
    if (pipValuesPerLot[id] == null) pipValuesPerLot[id] = Number((value / minLot).toFixed(10))
  }
  return { ...r, pipValues: {}, pipValuesPerLot }
}

/**
 * An empty instrument list (journal from 1.2.x) is filled with the calculator presets and the former
 * own instrument, whose hand-entered pip value stays under the same id ("CUSTOM").
 */
function seedInstruments<S extends { instruments: Instrument[]; risk: { customInstrument: { name: string; minLot: number | null } } }>(s: S): S {
  if (s.instruments.length) return s
  const custom = s.risk.customInstrument
  return {
    ...s,
    instruments: [
      ...presetInstruments(),
      {
        id: 'CUSTOM',
        name: custom.name.trim().slice(0, 24) || 'Własny',
        pipSize: null,
        contractSize: null,
        quoteCurrency: null,
        minLot: custom.minLot,
        description: '',
        archived: false
      }
    ]
  }
}

export const settingsSchema = z.looseObject({
  pairs: z.array(pairConfigSchema).default([]),
  contextInstruments: z.array(z.string().min(1)).default(['DXY', 'EURX', 'FGBL1!', 'ZB1!']),
  killzones: z.array(killzoneSchema).default([]),
  rules: rulesSchema.prefault({}),
  risk: z
    .looseObject({
      accountCurrency: z.string().regex(/^[A-Z]{3}$/).default('USD'),
      accountBalance: z.number().nonnegative().nullable().default(null),
      /**
       * Currency of trade amounts (risk, result) saved without their own `amountCurrency` (before 1.3.0): the account
       * currency of that time. Set once, on the first account currency change; null = the account currency.
       */
      legacyAmountCurrency: z.string().regex(/^[A-Z]{3}$/).nullable().default(null),
      /**
       * Currency of the calculator page (position, P/L, partials): amounts are converted from the account currency at the
       * rate account → it (NBP or typed). Lots do not depend on it. Without a rate the page uses the account currency.
       */
      calcCurrency: z.string().regex(/^[A-Z]{3}$/).default('PLN'),
      defaultRiskPercent: z.number().positive().default(0.5),
      contractSize: z.number().positive().default(100000),
      lotStep: z.number().positive().default(0.01),
      dailyLossLimitR: z.number().positive().nullable().default(2),
      dailyMaxTrades: z.number().int().positive().nullable().default(3),
      /** Manually entered conversion rates: 1 unit of the key currency = value in account currency. */
      conversionRates: z.record(z.string(), z.number().positive()).default({}),
      /** Legacy (1.2.0): hand-entered pip values per smallest lot; moved to `pipValuesPerLot` on load. */
      pipValues: z.record(z.string(), z.number().positive()).default({}),
      /**
       * P/L calculator: value of one pip for 1.00 lot (account currency) entered by hand, per instrument
       * (AUDUSD, EURGBP, EURUSD, EURAUD, WTI, CUSTOM); shown per smallest lot. Without an entry it is
       * calculated. Per 1.00 lot, so changing the lot step does not change its meaning.
       */
      pipValuesPerLot: z.record(z.string(), z.number().positive()).default({}),
      /**
       * Conversion rates and hand-entered pip values belong to one account currency: switching the
       * account currency parks them here and brings back the ones of the new currency.
       */
      byAccountCurrency: z
        .record(
          z.string(),
          z.looseObject({
            conversionRates: z.record(z.string(), z.number().positive()).default({}),
            pipValuesPerLot: z.record(z.string(), z.number().positive()).default({})
          })
        )
        .default({}),
      /** P/L calculator: own instrument (name, smallest lot; null = lotStep). */
      customInstrument: z
        .looseObject({
          name: z.string().default(''),
          minLot: z.number().positive().nullable().default(null)
        })
        .prefault({})
    })
    .transform(migrateLegacyPipValues)
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
    .prefault({}),
  /** Changes of the data folder made on another computer while this one has it open (since 1.4.0). */
  sync: z
    .looseObject({
      /**
       * merge: take them; when the same entry has local unsaved edits, merge field by field and ask only about fields
       * changed on both sides. ask: always ask first (list of changed entries with their differences).
       */
      remoteChanges: z.enum(['merge', 'ask']).default('merge')
    })
    .prefault({}),
  /** P/L calculator and pip mode of the payout forecast; an empty list is seeded on load. */
  instruments: z.array(instrumentSchema).default([]),
  fx: z
    .looseObject({
      /** Fetch NBP table A automatically. */
      autoFetch: z.boolean().default(true),
      /** Last fetched NBP table: mid rates, PLN for 1 unit of the currency. */
      nbp: nbpTableSchema.nullable().default(null),
      /** Hand-entered rates for pairs that do not involve the account currency: "USD>PLN" -> 3.9. */
      manual: z.record(z.string().regex(/^[A-Z]{3}>[A-Z]{3}$/), z.number().positive()).default({}),
      /**
       * Archive NBP mid rates per currency (src/shared/fxHistory.ts): the covered date range and date → mid. Trade
       * amounts are converted at the table of the day before the transaction.
       */
      history: z
        .record(
          z.string().regex(/^[A-Z]{3}$/),
          z.looseObject({ from: isoDate, to: isoDate, rates: z.record(z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.number().positive()) })
        )
        .default({})
    })
    .prefault({})
}).transform(seedInstruments)
export type Settings = z.infer<typeof settingsSchema>

export const journalSchema = z.looseObject({
  ...recordBase,
  createdAt: isoDateTime,
  settings: settingsSchema.prefault({}),
  dictionaries: dictionariesSchema.prefault({})
})
export type JournalFile = z.infer<typeof journalSchema>
