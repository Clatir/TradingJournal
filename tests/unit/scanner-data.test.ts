import { describe, expect, it } from 'vitest'
import { DateTime } from 'luxon'
import { instrumentPreset, usdPair } from '@shared/scanner/instruments'
import { defaultScannerSettings, scannerSettingsSchema } from '@shared/scanner/settings'
import { subscriptionPlan } from '@shared/scanner/subscription'
import {
  maskToken,
  parseIntraday,
  parseSymbolList,
  parseUser,
  parseWsMessage,
  splitRange,
  subscribeMessage,
  intradayPath
} from '@shared/scanner/eodhd'
import { M1Builder } from '@shared/scanner/m1'
import { tvCsvCandles } from '@shared/scanner/csv'
import { syntheticValue } from '@shared/scanner/synthetic'
import { journalSchema } from '@shared/schema'
import { createDefaultJournal } from '@shared/defaults'

const ny = (s: string): number => DateTime.fromISO(s, { zone: 'America/New_York' }).toSeconds()

describe('instrument presets', () => {
  it('FX, JPY, gold (pip 0.1 USD, max SL 65 USD) and WTI without REST history', () => {
    expect(instrumentPreset('EURUSD')).toMatchObject({ rest: 'EURUSD.FOREX', pipSize: 0.0001, priceDecimals: 5, contractSize: 100000, quoteCurrency: 'USD' })
    expect(instrumentPreset('usdjpy')).toMatchObject({ symbol: 'USDJPY', pipSize: 0.01, priceDecimals: 3, quoteCurrency: 'JPY' })
    expect(instrumentPreset('EURGBP').quoteCurrency).toBe('GBP')
    const xau = instrumentPreset('XAUUSD')
    expect(xau).toMatchObject({ pipSize: 0.1, contractSize: 100, maxStopPips: 650 })
    expect(xau.maxStopPips! * xau.pipSize).toBeCloseTo(65)
    expect(instrumentPreset('WTIUSD')).toMatchObject({ label: 'WTI', rest: null, pipSize: 0.01, contractSize: 1000 })
  })

  it('USD conversion pairs follow market convention', () => {
    expect(['PLN', 'EUR', 'GBP', 'CHF', 'JPY', 'AUD', 'USD'].map(usdPair)).toEqual(['USDPLN', 'EURUSD', 'GBPUSD', 'USDCHF', 'USDJPY', 'AUDUSD', null])
  })
})

describe('settings.scanner', () => {
  it('defaults: start list, bid, 400 days, max SL 30 pips, spec correlation map', () => {
    const s = defaultScannerSettings()
    expect(s.instruments.map((i) => i.symbol)).toEqual(['AUDUSD', 'EURAUD', 'EURGBP', 'EURUSD', 'USDCHF', 'XAUUSD', 'WTIUSD'])
    expect(s).toMatchObject({ price: 'bid', depthDays: 400, componentDepthDays: 120, maxStopPips: 30, synthetic: { DXY: true, EURX: true } })
    expect(s.correlations).toHaveLength(9)
  })

  it('is part of journal.json, keeps unknown fields, repairs bad values, drops duplicate instruments', () => {
    const j = createDefaultJournal()
    expect(j.settings.scanner.instruments).toHaveLength(7)
    const raw = {
      ...JSON.parse(JSON.stringify(j)),
      settings: {
        ...JSON.parse(JSON.stringify(j.settings)),
        scanner: {
          price: 'ask',
          depthDays: 5,
          future: { x: 1 },
          instruments: [instrumentPreset('EURUSD'), { ...instrumentPreset('EURUSD'), enabled: false }]
        }
      }
    }
    const parsed = journalSchema.parse(raw)
    const sc = parsed.settings.scanner as typeof parsed.settings.scanner & { future?: unknown }
    expect(sc.price).toBe('bid')
    expect(sc.depthDays).toBe(400)
    expect(sc.future).toEqual({ x: 1 })
    expect(sc.instruments).toHaveLength(1)
    expect(sc.instruments[0]!.enabled).toBe(true)
  })
})

describe('subscription budget', () => {
  it('start list with a PLN account = 16 of 50 symbols', () => {
    const plan = subscriptionPlan(defaultScannerSettings(), 'PLN')
    expect([...plan.symbols].sort()).toEqual(
      ['AUDUSD', 'EURAUD', 'EURCHF', 'EURGBP', 'EURJPY', 'EURSEK', 'EURUSD', 'GBPUSD', 'NZDUSD', 'USDCAD', 'USDCHF', 'USDJPY', 'USDPLN', 'USDSEK', 'WTIUSD', 'XAUUSD'].sort()
    )
    expect(plan.limit).toBe(50)
    expect(plan.over).toBe(false)
    expect(plan.reasons.EURUSD).toEqual(['instrument', 'DXY', 'EURX', 'SMT']) // SMT partner of USDCHF
    expect(plan.reasons.NZDUSD).toEqual(['SMT'])
    expect(plan.reasons.USDPLN).toEqual(['conversion'])
  })

  it('without synthetic indices and with a USD account only instruments, SMT partners and quote conversions remain', () => {
    const s = scannerSettingsSchema.parse({ synthetic: { DXY: false, EURX: false } })
    const plan = subscriptionPlan(s, 'USD')
    expect([...plan.symbols].sort()).toEqual(['AUDUSD', 'EURAUD', 'EURGBP', 'EURUSD', 'GBPUSD', 'NZDUSD', 'USDCHF', 'WTIUSD', 'XAUUSD'])
  })
})

describe('EODHD protocol', () => {
  it('parses ticks, authorization, auth failure, symbol limit and errors', () => {
    expect(parseWsMessage('{"s":"EURUSD","a":1.12031,"b":1.12009,"dc":"0.1","dd":"0.001","ppms":false,"t":1791577901536}')).toEqual({
      kind: 'tick',
      symbol: 'EURUSD',
      bid: 1.12009,
      ask: 1.12031,
      t: 1791577901536
    })
    expect(parseWsMessage('{"s":"BTC-USD","p":"82986","q":"0.1","t":1791667254826}')).toMatchObject({ kind: 'tick', bid: 82986, ask: 82986 })
    expect(parseWsMessage('{"status_code":200,"message":"Authorized"}')).toEqual({ kind: 'authorized' })
    expect(parseWsMessage('{"status":403,"message":"Server error"}')).toMatchObject({ kind: 'auth-failed' })
    expect(parseWsMessage('{"status_code":422,"message":"Symbols limit reached"}')).toMatchObject({ kind: 'symbol-limit' })
    expect(parseWsMessage('{"status_code":422,"message":"Action and symbols should be string"}')).toMatchObject({ kind: 'error', code: 422 })
    expect(parseWsMessage('not json')).toEqual({ kind: 'unknown' })
    expect(subscribeMessage(['EURUSD', 'XAUUSD'])).toBe('{"action":"subscribe","symbols":"EURUSD,XAUUSD"}')
  })

  it('parses 1m bars, dropping empty rows and bad ticks', () => {
    const rows = [
      { timestamp: 1791147660, gmtoffset: 0, datetime: '2026-10-04 21:01:00', open: 1.12541, high: 1.1259, low: 1.12535, close: 1.12558, volume: 559 },
      { timestamp: 1791147600, gmtoffset: 0, datetime: '2026-10-04 21:00:00', open: 1.12583, high: 1.12594, low: 1.12538, close: 1.1254, volume: 518 },
      { timestamp: 1791147720, open: null, high: null, low: null, close: null, volume: null },
      { timestamp: 1791147780, open: 1.1255, high: 1.1256, low: 0.0001, close: 1.1255 },
      { timestamp: 1791147600, open: 1.12583, high: 1.12594, low: 1.12538, close: 1.1254 }
    ]
    const r = parseIntraday(rows)
    expect(r.rejected).toBe(2)
    expect(r.candles.map((c) => c.t)).toEqual([1791147600, 1791147660])
    expect(r.candles[0]).toEqual({ t: 1791147600, o: 1.12583, h: 1.12594, l: 1.12538, c: 1.1254 })
    expect(parseIntraday({ error: 'x' })).toEqual({ candles: [], rejected: 0 })
  })

  it('keeps no personal data from the user endpoint and masks the token', () => {
    const u = parseUser({ name: 'Jan', email: 'jan@example.com', subscriptionType: 'monthly', subscriptionMode: 'paid', apiRequests: 12, dailyRateLimit: 100000, availableDataFeeds: ['Intraday Data API'] })
    expect(JSON.stringify(u)).not.toMatch(/Jan|example/)
    expect(u).toMatchObject({ subscriptionMode: 'paid', apiRequests: 12, dailyRateLimit: 100000, feeds: ['Intraday Data API'] })
    expect(maskToken('GET /x?api_token=abc123&y=abc123', 'abc123')).toBe('GET /x?api_token=***&y=***')
    expect(parseSymbolList([{ Code: 'EURUSD', Name: 'EUR/USD', Type: 'Currency' }, { Name: 'x' }])).toEqual([{ code: 'EURUSD', name: 'EUR/USD', type: 'Currency' }])
  })

  it('splits long ranges into requests of at most 100 days', () => {
    const parts = splitRange({ from: 0, to: 250 * 86400 })
    expect(parts.map((p) => (p.to - p.from) / 86400)).toEqual([100, 100, 50])
    expect(intradayPath('EURUSD.FOREX', 1.5, 99)).toBe('/intraday/EURUSD.FOREX?interval=1m&from=1&to=99&fmt=json')
  })
})

describe('M1 from stream ticks', () => {
  const t0 = ny('2026-10-13T09:30') * 1000
  const tick = (dt: number, bid: number, ask = bid + 0.0002) => ({ symbol: 'EURUSD', bid, ask, t: t0 + dt })

  it('builds bid OHLC, closes a minute on the next minute tick or after the grace period', () => {
    const b = new M1Builder('bid')
    expect(b.tick(tick(1000, 1.1), t0 + 1000)).toEqual([])
    b.tick(tick(20_000, 1.102), t0 + 20_000)
    b.tick(tick(40_000, 1.099), t0 + 40_000)
    const closed = b.tick(tick(61_000, 1.101), t0 + 61_000)
    expect(closed).toEqual([{ symbol: 'EURUSD', candle: { t: t0 / 1000, o: 1.1, h: 1.102, l: 1.099, c: 1.099 } }])
    expect(b.flush(t0 + 121_000)).toEqual([])
    expect(b.flush(t0 + 122_000)).toHaveLength(1)
    expect(b.stats.get('EURUSD')).toMatchObject({ accepted: 4, closed: 2 })
  })

  it('mid mode, stale snapshot, weekend and late ticks', () => {
    const b = new M1Builder('mid')
    b.tick(tick(0, 1.1, 1.1002), t0)
    expect(b.forming('EURUSD')!.o).toBeCloseTo(1.1001, 10)
    // Snapshot after subscribing: last quote from long ago.
    b.tick({ symbol: 'EURUSD', bid: 1.2, ask: 1.2, t: t0 - 3_600_000 }, t0)
    // Saturday quote.
    const sat = ny('2026-10-10T12:00') * 1000
    b.tick({ symbol: 'EURUSD', bid: 1.2, ask: 1.2, t: sat }, sat)
    b.tick(tick(60_500, 1.1), t0 + 60_500)
    b.tick(tick(59_000, 1.3), t0 + 60_600) // late tick of the closed minute
    expect(b.stats.get('EURUSD')).toMatchObject({ stale: 2, late: 1 })
    expect(b.forming('EURUSD')!.h).toBeLessThan(1.2)
  })
})

describe('TradingView CSV import', () => {
  const csv = (step: number, n: number, start = ny('2026-10-13T08:00')) =>
    ['time,open,high,low,close', ...Array.from({ length: n }, (_, i) => `${start + i * step},1.1,1.1005,1.0995,1.1001`)].join('\n')

  it('recognises 1-minute and 1-hour exports and skips weekend rows', () => {
    expect(tvCsvCandles(csv(60, 30))).toMatchObject({ interval: 'M1', skipped: 0, weekend: 0 })
    // Thursday 08:00 … Sunday 17:00 NY: 33 hours before the Friday close, 48 weekend hours, the Sunday open.
    const h1 = tvCsvCandles(csv(3600, 82, ny('2026-10-08T08:00')))
    expect(h1.interval).toBe('H1')
    expect(h1.weekend).toBe(48)
    expect(h1.candles).toHaveLength(34)
    expect(h1.candles.at(-1)!.t).toBe(ny('2026-10-11T17:00'))
  })

  it('rejects other intervals with an instruction', () => {
    expect(() => tvCsvCandles(csv(86400, 10))).toThrow(/1 minuta albo 1 godzina/)
  })
})

describe('synthetic indices', () => {
  it('DXY and EURX from pair prices; missing component = null', () => {
    const p = { EURUSD: 1.12035, USDJPY: 152, GBPUSD: 1.32, USDCAD: 1.42, USDSEK: 10, USDCHF: 0.83, EURGBP: 0.848, EURJPY: 170.3, EURCHF: 0.93, EURSEK: 11.2 }
    const dxy = syntheticValue('DXY', p)!
    expect(dxy).toBeCloseTo(50.14348112 * 1.12035 ** -0.576 * 152 ** 0.136 * 1.32 ** -0.119 * 1.42 ** 0.091 * 10 ** 0.042 * 0.83 ** 0.036, 10)
    expect(dxy).toBeGreaterThan(90)
    expect(dxy).toBeLessThan(110)
    expect(syntheticValue('EURX', p)).toBeGreaterThan(100)
    expect(syntheticValue('DXY', { ...p, USDSEK: undefined })).toBeNull()
  })
})
