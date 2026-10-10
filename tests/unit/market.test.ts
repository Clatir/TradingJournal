import { describe, expect, it } from 'vitest'
import { createTrade } from '@shared/defaults'
import {
  dayIsFinal,
  dayRanges,
  daysBetween,
  decodeMarketDay,
  defaultMarketTicker,
  encodeMarketDay,
  marketTicker,
  parseEodhdIntraday,
  resampleBars,
  splitByDay,
  type Bar
} from '@shared/market'
import { marketDiffers, marketStatsFor, needsMarketStats, tradeMarketKey, tradeMarketWindow, withMarketStats } from '@shared/calc/marketStats'
import { tradeSchema, type Trade } from '@shared/schema'

const MIN = 60_000
const T0 = Date.parse('2026-09-22T12:00:00Z')

/** M1 bars from a list of [open, high, low, close] starting at `start`. */
const bars = (start: number, ohlc: Array<[number, number, number, number]>): Bar[] =>
  ohlc.map(([open, high, low, close], i) => ({ t: start + i * MIN, open, high, low, close }))

describe('dane rynkowe: symbole, dni, plik dnia', () => {
  it('symbol EODHD: pary walut i metale z końcówką .FOREX, znane indeksy, WTI bez danych, własny symbol pary', () => {
    expect(['EURUSD', 'xauusd', 'GBP/USD', 'DXY', 'US500', 'BRENT', 'WTI', 'USOIL', 'DE40'].map(defaultMarketTicker)).toEqual([
      'EURUSD.FOREX',
      'XAUUSD.FOREX',
      'GBPUSD.FOREX',
      'DXY.INDX',
      'GSPC.INDX',
      'XBRUSD.FOREX',
      null,
      null,
      null
    ])
    const pairs = [
      { symbol: 'EURUSD', marketSymbol: null },
      { symbol: 'DE40', marketSymbol: 'GDAXI.INDX' },
      { symbol: 'GBPUSD', marketSymbol: '' },
      { symbol: 'AUDUSD', marketSymbol: 'nie symbol' }
    ]
    expect(['EURUSD', 'DE40', 'GBPUSD', 'AUDUSD', 'EURGBP'].map((s) => marketTicker(s, pairs))).toEqual(['EURUSD.FOREX', 'GDAXI.INDX', null, 'AUDUSD.FOREX', 'EURGBP.FOREX'])
  })

  it('dni UTC zakresu, grupowanie kolejnych dni w zapytania, dzień ostateczny po zamknięciu i odczekaniu', () => {
    expect(daysBetween(Date.parse('2026-09-21T22:00:00Z'), Date.parse('2026-09-23T00:00:00Z'))).toEqual(['2026-09-21', '2026-09-22'])
    expect(daysBetween(T0, T0)).toEqual([])
    expect(dayRanges(['2026-09-23', '2026-09-21', '2026-09-22', '2026-09-25'])).toEqual([
      { first: '2026-09-21', last: '2026-09-23' },
      { first: '2026-09-25', last: '2026-09-25' }
    ])
    const long = Array.from({ length: 150 }, (_, i) => new Date(Date.parse('2026-01-01T00:00:00Z') + i * 86_400_000).toISOString().slice(0, 10))
    expect(dayRanges(long).map((r) => [r.first, r.last])).toEqual([
      ['2026-01-01', '2026-04-10'],
      ['2026-04-11', '2026-05-30']
    ])
    expect(dayIsFinal('2026-09-22', Date.parse('2026-09-23T02:00:00Z'))).toBe(false)
    expect(dayIsFinal('2026-09-22', Date.parse('2026-09-23T03:00:00Z'))).toBe(true)
  })

  it('odpowiedź EODHD: sortowanie, duplikaty, płaskie wypełniacze bez wolumenu pominięte, high/low obejmują open i close', () => {
    const raw = [
      { timestamp: T0 / 1000 + 60, open: 1.1, high: 1.1002, low: 1.0999, close: 1.1001, volume: 5 },
      { timestamp: T0 / 1000, open: 1.1, high: 1.1, low: 1.1, close: 1.1, volume: 0 },
      { timestamp: T0 / 1000 + 120, open: 1.1001, high: 1.1001, low: 1.1001, close: 1.1001, volume: 0 }, // filler
      { timestamp: T0 / 1000 + 180, open: 1.1001, high: 1.1, low: 1.1, close: 1.1003, volume: 2 }, // high below close
      { timestamp: 'x', open: 1 },
      null
    ]
    const parsed = parseEodhdIntraday(raw)!
    expect(parsed.map((b) => (b.t - T0) / MIN)).toEqual([0, 1, 3])
    expect(parsed[2]).toMatchObject({ high: 1.1003, low: 1.1 })
    expect(parseEodhdIntraday({ error: 'x' })).toBeNull()
  })

  it('plik dnia: zapis i odczyt bez strat (ceny całkowite względem poprzedniego zamknięcia), zwarty', () => {
    const day = '2026-09-22'
    const start = Date.parse(`${day}T00:00:00Z`)
    let p = 1.14645
    const list: Bar[] = []
    for (let i = 0; i < 1440; i++) {
      const o = p
      const c = Math.round((p + Math.sin(i / 17) * 0.00011 + (i % 7) * 0.000003 - 0.000009) * 1e6) / 1e6
      list.push({ t: start + i * MIN, open: o, high: Math.round((Math.max(o, c) + 0.00004) * 1e6) / 1e6, low: Math.round((Math.min(o, c) - 0.000035) * 1e6) / 1e6, close: c })
      p = c
    }
    const d = { ticker: 'EURUSD.FOREX', day, final: true, fetchedAt: '2026-09-23T04:00:00.000Z', bars: list }
    const json = encodeMarketDay(d)
    expect(decodeMarketDay(json)).toEqual(d)
    expect(json.length).toBeLessThan(40_000)
    // Gold: 5 decimals, prices in thousands.
    const gold = { ...d, ticker: 'XAUUSD.FOREX', bars: bars(start, [[4322.61679, 4323.68259, 4322.16227, 4322.3958]]) }
    expect(decodeMarketDay(encodeMarketDay(gold))).toEqual(gold)
    // An empty day (closed market) is a valid file too.
    expect(decodeMarketDay(encodeMarketDay({ ...d, bars: [] }))?.bars).toEqual([])
    expect(decodeMarketDay('{"v":2}')).toBeNull()
    expect(decodeMarketDay('nie json')).toBeNull()
  })

  it('podział na dni i przeliczenie na większy interwał (wyrównany do UTC)', () => {
    const b = bars(Date.parse('2026-09-22T23:58:00Z'), [
      [1, 1.2, 0.9, 1.1],
      [1.1, 1.3, 1.0, 1.2],
      [1.2, 1.25, 1.15, 1.2],
      [1.2, 1.4, 1.1, 1.3]
    ])
    const split = splitByDay(b, ['2026-09-22', '2026-09-23', '2026-09-24'])
    expect([...split.values()].map((x) => x.length)).toEqual([2, 2, 0])
    const m5 = resampleBars(b, 5)
    expect(m5).toEqual([
      { t: Date.parse('2026-09-22T23:55:00Z'), open: 1, high: 1.3, low: 0.9, close: 1.2 },
      { t: Date.parse('2026-09-23T00:00:00Z'), open: 1.2, high: 1.4, low: 1.1, close: 1.3 }
    ])
    expect(resampleBars(b, 1)).toEqual(b)
  })
})

describe('transakcja na świecach M1', () => {
  const OPTS = { ticker: 'EURUSD.FOREX', pipSize: 0.0001, marginPips: 1, now: '2026-09-23T00:00:00.000Z' }
  /** Short at 1.14568, SL 1.14700 (13.2 p), TP1 1.14400 (16.8 p), closed at TP1 at 12:05:20. */
  const short = (over: Partial<Trade> = {}): Trade =>
    createTrade({
      pair: 'EURUSD',
      direction: 'short',
      status: 'closed',
      entryTime: '2026-09-22T12:00:13.000Z',
      prices: { entry: 1.14568, stopLoss: 1.147, takeProfit1: 1.144, takeProfit2: 1.142 },
      exits: [{ id: '01K6H3Z0W8Q4M2N5P7R9S1T3V5', time: '2026-09-22T12:05:20.000Z', price: 1.144, percent: 100, note: '' }],
      ...over
    })
  // 12:00 entry minute (high 1.14590 – before the entry? it does not reach the SL), 12:02 up to 1.14641 (MAE −7.3 p),
  // 12:04 down to 1.14450 (MFE 11.8 p), 12:05 exit minute reaching 1.14390 (beyond TP – capped at TP1).
  const series = bars(T0, [
    [1.1456, 1.1459, 1.1455, 1.14565],
    [1.14565, 1.1461, 1.1456, 1.146],
    [1.146, 1.14641, 1.1459, 1.1462],
    [1.1462, 1.1462, 1.1452, 1.1453],
    [1.1453, 1.1454, 1.1445, 1.1446],
    [1.1446, 1.1447, 1.1439, 1.1441],
    [1.1441, 1.1442, 1.1430, 1.1432] // after the exit – not measured
  ])

  it('MAE / MFE, w R, kiedy, osiągnięte poziomy przed wyjściem', () => {
    const m = marketStatsFor(short(), series, OPTS)
    expect(m).toMatchObject({
      ticker: 'EURUSD.FOREX',
      maePips: -7.3,
      mfePips: 16.8, // capped at TP1, the level that closed the trade
      maeR: -0.55,
      mfeR: 1.27,
      maeAt: '2026-09-22T12:02:00.000Z',
      mfeAt: '2026-09-22T12:05:00.000Z',
      maeMinutes: 2,
      mfeMinutes: 5,
      reached1R: 'yes',
      reached2R: 'no',
      reachedTp1: 'yes',
      reachedTp2: 'no',
      stopTouched: 'no',
      warnings: []
    })
    expect(m.key).toBe(tradeMarketKey(short()))
    expect(tradeSchema.safeParse({ ...short(), market: m }).success).toBe(true)
  })

  it('SL dotknięty według innego źródła cen: „tak” poza marginesem, „niepewne” w marginesie; zamknięcie na SL = tak', () => {
    // SL 1.14635: price went to 1.14641 (0.6 p beyond) – within the 1-pip margin.
    expect(marketStatsFor(short({ prices: { entry: 1.14568, stopLoss: 1.14635, takeProfit1: 1.144, takeProfit2: null } }), series, OPTS).stopTouched).toBe('near')
    // SL 1.14620: 2.1 p beyond.
    expect(marketStatsFor(short({ prices: { entry: 1.14568, stopLoss: 1.1462, takeProfit1: 1.144, takeProfit2: null } }), series, OPTS).stopTouched).toBe('yes')
    const stopped = short({ exits: [{ id: '01K6H3Z0W8Q4M2N5P7R9S1T3V5', time: '2026-09-22T12:02:30.000Z', price: 1.147, percent: 100, note: '' }] })
    expect(marketStatsFor(stopped, series, OPTS)).toMatchObject({ stopTouched: 'yes', reachedTp1: 'no' })
  })

  it('brak danych z czasu transakcji: podsumowanie bez wartości, z ostrzeżeniem i kluczem (nie liczy się ponownie)', () => {
    const m = marketStatsFor(short(), bars(T0 + 3600_000, [[1, 1, 1, 1]]), OPTS)
    expect(m).toMatchObject({ maePips: null, mfePips: null, warnings: ['Brak świec M1 z czasu transakcji w danych rynkowych.'] })
    expect(needsMarketStats({ ...short(), market: m })).toBe(false)
  })

  it('luki w danych są zgłaszane', () => {
    const gappy = series.filter((_, i) => i === 0 || i === 5)
    expect(marketStatsFor(short(), gappy, OPTS).warnings[0]).toMatch(/luki: 33% minut/)
  })

  it('kiedy liczyć: tylko zamknięte z wejściem i czasem wyjścia; zmiana cen albo czasów = ponownie', () => {
    expect(tradeMarketWindow(short())).toEqual({ fromMs: T0, toMs: T0 + 6 * MIN })
    expect(needsMarketStats(short())).toBe(true)
    expect(needsMarketStats(short({ status: 'open' }))).toBe(false)
    expect(needsMarketStats(short({ exits: [{ id: '01K6H3Z0W8Q4M2N5P7R9S1T3V5', time: null, price: 1.144, percent: 100, note: '' }] }))).toBe(false)
    const done = withMarketStats(short(), marketStatsFor(short(), series, OPTS))
    expect(needsMarketStats(done)).toBe(false)
    expect(needsMarketStats({ ...done, prices: { ...done.prices, stopLoss: 1.148 } })).toBe(true)
    // MAE / MFE typed by hand (or from a screen) stay; the summary is kept beside them.
    expect(needsMarketStats({ ...done, notes: 'inna notatka', maePips: -5 })).toBe(false)
  })

  it('wypełnia tylko puste MAE / MFE; różnica z wpisanymi wartościami jest wykrywana', () => {
    const m = marketStatsFor(short(), series, OPTS)
    expect(withMarketStats(short(), m)).toMatchObject({ maePips: -7.3, mfePips: 16.8 })
    const typed = withMarketStats(short({ maePips: -9, mfePips: 16.8 }), m)
    expect(typed).toMatchObject({ maePips: -9, mfePips: 16.8, market: { maePips: -7.3 } })
    expect(marketDiffers(typed, 1)).toBe(true)
    expect(marketDiffers({ ...typed, maePips: -7.9 }, 1)).toBe(false)
  })
})
