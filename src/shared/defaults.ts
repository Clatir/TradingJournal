import { newId } from './ids'
import { SCHEMA_VERSION } from './schema/common'
import { journalSchema, type DictItem, type JournalFile, type Killzone, type PairConfig, type Settings } from './schema/journal'
import { tradeSchema, type Trade } from './schema/trade'
import { dayPlanSchema, type DayPlan } from './schema/day'
import { FORECAST_MAX_MONTHS, forecastSchema, type Forecast, type ForecastDraws } from './schema/forecast'
import { drawUniforms } from './random'

const dict = (names: string[]): DictItem[] => names.map((name) => ({ id: newId(), name, archived: false }))

export const DEFAULT_PAIRS: PairConfig[] = [
  { symbol: 'AUDUSD', pipSize: 0.0001, priceDecimals: 5, quoteCurrency: 'USD', tvSymbol: 'FX:AUDUSD', archived: false },
  { symbol: 'EURAUD', pipSize: 0.0001, priceDecimals: 5, quoteCurrency: 'AUD', tvSymbol: 'FX:EURAUD', archived: false },
  { symbol: 'EURGBP', pipSize: 0.0001, priceDecimals: 5, quoteCurrency: 'GBP', tvSymbol: 'FX:EURGBP', archived: false },
  { symbol: 'EURUSD', pipSize: 0.0001, priceDecimals: 5, quoteCurrency: 'USD', tvSymbol: 'FX:EURUSD', archived: false },
  { symbol: 'USDCHF', pipSize: 0.0001, priceDecimals: 5, quoteCurrency: 'CHF', tvSymbol: 'FX:USDCHF', archived: false }
]

export function defaultKillzones(): Killzone[] {
  const kz = (name: string, start: string, end: string, kind: Killzone['kind']): Killzone => ({
    id: newId(),
    name,
    start,
    end,
    kind,
    archived: false
  })
  return [
    kz('London', '02:00', '05:00', 'killzone'),
    kz('New York', '07:00', '10:00', 'killzone'),
    kz('SB London', '03:00', '04:00', 'silverBullet'),
    kz('SB AM', '10:00', '11:00', 'silverBullet'),
    kz('SB PM', '14:00', '15:00', 'silverBullet')
  ]
}

export function createDefaultJournal(now = new Date().toISOString()): JournalFile {
  return journalSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    id: newId(),
    createdAt: now,
    updatedAt: now,
    settings: {
      pairs: DEFAULT_PAIRS,
      killzones: defaultKillzones()
    },
    dictionaries: {
      entryModels: dict(['Sweep → MSS → FVG', 'OTE 62–79%', 'Silver Bullet', 'Turtle soup', 'Breaker']),
      pdArrays: dict([
        'FVG',
        'Order Block',
        'Breaker',
        'Mitigation block',
        'Rejection block',
        'Propulsion block',
        'BPR',
        'Inversion FVG',
        'Volume imbalance',
        'Liquidity void'
      ]),
      liquidityPools: dict([
        'PDH',
        'PDL',
        'EQH',
        'EQL',
        'Asia high',
        'Asia low',
        'London high',
        'London low',
        'NY high',
        'NY low',
        'PWH',
        'PWL'
      ]),
      mistakeTags: dict(['Przesunięty TP', 'SL za ciasny', 'Wejście poza killzone']),
      missedReasons: dict(['Brak potwierdzenia', 'Wahanie / strach', 'Poza komputerem', 'Za późno zauważony setup'])
    }
  })
}

export function createTrade(partial: Partial<Trade> & Pick<Trade, 'pair' | 'direction' | 'entryTime'>, now = new Date().toISOString()): Trade {
  return tradeSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    id: newId(),
    createdAt: now,
    updatedAt: now,
    exits: [{ id: newId(), time: null, price: null, percent: 100, note: '' }],
    ...partial
  })
}

export function createDayPlan(date: string, pairs: string[], instruments: string[], now = new Date().toISOString()): DayPlan {
  return dayPlanSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    id: newId(),
    createdAt: now,
    updatedAt: now,
    date,
    pairs: pairs.map((pair) => ({ pair })),
    intermarket: instruments.map((instrument) => ({ instrument }))
  })
}

/** "<prefix> N" with the first N that is not taken yet. */
export function firstFreeName(prefix: string, taken: Iterable<string>): string {
  const names = new Set(taken)
  let n = 1
  while (names.has(`${prefix} ${n}`)) n++
  return `${prefix} ${n}`
}

/** Four fresh tables of random numbers, one per month of the longest forecast. */
export function freshForecastDraws(): ForecastDraws {
  return {
    rate: drawUniforms(FORECAST_MAX_MONTHS),
    loss: drawUniforms(FORECAST_MAX_MONTHS),
    lossSize: drawUniforms(FORECAST_MAX_MONTHS),
    pips: drawUniforms(FORECAST_MAX_MONTHS)
  }
}

/**
 * New payout forecast scenario: "Scenariusz N", account currency, start capital = account balance (or 10000),
 * first month = the current month on this computer, fresh random numbers; everything else from the schema.
 */
export function createForecast(
  risk: Pick<Settings['risk'], 'accountCurrency' | 'accountBalance'>,
  takenNames: Iterable<string>,
  now = new Date().toISOString()
): Forecast {
  const d = new Date(now)
  return forecastSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    id: newId(),
    createdAt: now,
    updatedAt: now,
    name: firstFreeName('Scenariusz', takenNames),
    currency: risk.accountCurrency,
    startCapital: Math.min(risk.accountBalance ?? 10000, 1e12),
    firstMonth: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
    draws: freshForecastDraws()
  })
}
