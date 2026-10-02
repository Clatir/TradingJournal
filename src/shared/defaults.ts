import { newId } from './ids'
import { SCHEMA_VERSION } from './schema/common'
import { journalSchema, type DictItem, type JournalFile, type Killzone, type PairConfig } from './schema/journal'
import { tradeSchema, type Trade } from './schema/trade'

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
