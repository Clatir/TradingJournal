/**
 * Scanner settings shared by all computers: `settings.scanner` in journal.json (additive, SCHEMA_VERSION unchanged).
 * Per-computer parts (API key, alert switches, REST usage) live in userData. Later phases add fields; unknown fields
 * are kept (looseObject).
 */
import { z } from 'zod'
import { instrumentPreset, START_INSTRUMENTS } from './instruments'

const currency = z.string().regex(/^[A-Z]{3}$/)

export const scannerInstrumentSchema = z.looseObject({
  /** EODHD stream symbol and the instrument id. */
  symbol: z.string().regex(/^[A-Z0-9]{3,15}$/),
  label: z.string().max(20).default(''),
  /** EODHD REST code (EURUSD.FOREX); null = no REST history (WTIUSD). */
  rest: z.string().max(30).nullable().default(null),
  enabled: z.boolean().default(true),
  pipSize: z.number().positive(),
  priceDecimals: z.number().int().min(0).max(8),
  contractSize: z.number().positive(),
  quoteCurrency: currency,
  /** Own maximum stop in pips (gold 650 = 65 USD); null = `scanner.maxStopPips`. */
  maxStopPips: z.number().positive().nullable().default(null)
})
export type ScannerInstrument = z.infer<typeof scannerInstrumentSchema>

export const correlationSchema = z.looseObject({
  a: z.string().min(3),
  b: z.string().min(3),
  /** 1 = positive, −1 = negative correlation. */
  sign: z.union([z.literal(1), z.literal(-1)])
})
export type Correlation = z.infer<typeof correlationSchema>

/** Correlation map from the specification (section 7.3); DXY / EURX are the synthetic indices. */
export const DEFAULT_CORRELATIONS: Correlation[] = [
  { a: 'EURUSD', b: 'GBPUSD', sign: 1 },
  { a: 'AUDUSD', b: 'NZDUSD', sign: 1 },
  { a: 'EURUSD', b: 'USDCHF', sign: -1 },
  { a: 'EURUSD', b: 'DXY', sign: -1 },
  { a: 'AUDUSD', b: 'DXY', sign: -1 },
  { a: 'XAUUSD', b: 'DXY', sign: -1 },
  { a: 'USDCHF', b: 'DXY', sign: 1 },
  { a: 'EURAUD', b: 'EURX', sign: 1 },
  { a: 'EURGBP', b: 'EURX', sign: 1 }
]

export function defaultInstrument(symbol: string): ScannerInstrument {
  const p = instrumentPreset(symbol)
  return scannerInstrumentSchema.parse({ ...p, enabled: true })
}

function uniqueInstruments(list: ScannerInstrument[]): ScannerInstrument[] {
  const seen = new Set<string>()
  return list.filter((i) => (seen.has(i.symbol) ? false : (seen.add(i.symbol), true)))
}

export const scannerSettingsSchema = z.looseObject({
  instruments: z
    .array(scannerInstrumentSchema)
    .default(() => START_INSTRUMENTS.map(defaultInstrument))
    .transform(uniqueInstruments),
  /** Candles from stream ticks: bid (default, matches REST history and TradingView OANDA) or mid. */
  price: z.enum(['bid', 'mid']).catch('bid').default('bid'),
  /** M1 history depth for instruments and for index components (days). */
  depthDays: z.number().int().min(14).max(1500).catch(400).default(400),
  componentDepthDays: z.number().int().min(14).max(1500).catch(120).default(120),
  synthetic: z
    .looseObject({ DXY: z.boolean().default(true), EURX: z.boolean().default(true) })
    .prefault({}),
  correlations: z.array(correlationSchema).default(() => DEFAULT_CORRELATIONS.map((c) => ({ ...c }))),
  /** Maximum stop for FX instruments in pips (user decision: 30). */
  maxStopPips: z.number().positive().catch(30).default(30)
})
export type ScannerSettings = z.infer<typeof scannerSettingsSchema>

export function defaultScannerSettings(): ScannerSettings {
  return scannerSettingsSchema.parse({})
}
