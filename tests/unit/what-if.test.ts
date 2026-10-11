import { describe, expect, it } from 'vitest'
import { DateTime } from 'luxon'
import { createDefaultJournal, createTrade } from '@shared/defaults'
import { atrBefore, volatilityFor, volatilityWindowFrom, whatIfFor, whatIfHorizon } from '@shared/calc/whatIf'
import { daySession, previousTradingDay, sessionDateOf } from '@shared/calc/marketLevels'
import { MARKET_STATS_VERSION, marketStatsFor, needsMarketStats } from '@shared/calc/marketStats'
import { excursionTiming, regimes, volatilityBreakdown, whatIfSummary } from '@shared/calc/marketAnalytics'
import { metricsContext, tradeMetrics } from '@shared/calc/trade'
import { validateTrade } from '@shared/calc/validator'
import type { AnalyzedTrade } from '@shared/calc/analytics'
import { buildMonthlyReport, monthlyReportMarkdown } from '@shared/export/monthlyReport'
import { tradeMarketSchema, type Trade } from '@shared/schema'
import type { Bar } from '@shared/market'

const MIN = 60_000
const ny = (s: string) => DateTime.fromISO(s, { zone: 'America/New_York' }).toMillis()

/** Long EURUSD at 09:00 NY: risk 10 pips, TP1 = 2R, TP2 = 4R, closed at TP1 at 10:00 NY. */
const trade = (over: Partial<Trade> = {}): Trade =>
  createTrade({
    pair: 'EURUSD',
    direction: 'long',
    status: 'closed',
    entryTime: '2026-09-23T13:00:00.000Z',
    prices: { entry: 1.15, stopLoss: 1.149, takeProfit1: 1.152, takeProfit2: 1.154 },
    exits: [{ id: '01K6H3Z0W8Q4M2N5P7R9S1T3V5', time: '2026-09-23T14:00:00.000Z', price: 1.152, percent: 100, note: '' }],
    ...over
  })

const start = Date.parse('2026-09-23T13:00:00Z')
const at = (min: number) => start + min * MIN

/** Flat M1 bars (±0.5 pip) from the entry to the horizon at `price(minute)`; spikes { minute: price }. */
function series(until: number, spikes: Record<number, number> = {}, priceAt: (min: number) => number = () => 1.15): Bar[] {
  const out: Bar[] = []
  for (let t = start; t < until; t += MIN) {
    const min = (t - start) / MIN
    const price = priceAt(min)
    const s = spikes[min]
    out.push({ t, open: price, close: price, high: s != null && s > price ? s : price + 0.00005, low: s != null && s < price ? s : price - 0.00005 })
  }
  return out
}

describe('co by było, gdyby', () => {
  const until = whatIfHorizon(trade())!
  const m = 0.0001

  it('horyzont: 17:00 NY dnia handlowego, a gdy wyjście było później – minuta po wyjściu', () => {
    expect(until).toBe(ny('2026-09-23T17:00'))
    const late = trade({
      entryTime: '2026-09-23T20:00:00.000Z', // 16:00 NY
      exits: [{ id: '01K6H3Z0W8Q4M2N5P7R9S1T3V5', time: '2026-09-23T21:30:00.000Z', price: 1.152, percent: 100, note: '' }]
    })
    expect(whatIfHorizon(late)).toBe(Date.parse('2026-09-23T21:31:00Z'))
    expect(whatIfHorizon(trade({ status: 'open', exits: [] }))).toBeNull()
  })

  // Up to 1.5R, held at +0.5R, a spike to 2.5R, then the stop.
  const held = (min: number) => (min > 10 ? 1.1505 : 1.15)

  it('plany na tych samych świecach: 1,5R → 2,5R → SL', () => {
    const b = series(until, { 10: 1.1515, 30: 1.1525, 60: 1.1485 }, held)
    expect(whatIfFor(trade(), b, until, m)).toEqual({
      tp1: { r: 2, uncertain: false },
      tp2: { r: -1, uncertain: false },
      be1R_tp2: { r: 0, uncertain: false }, // the stop moved to the entry after the 1.5R bar
      r2: { r: 2, uncertain: false },
      r3: { r: -1, uncertain: false },
      half1R_tp2: { r: 0.5, uncertain: false } // half banked at 1R, the rest stopped at the entry
    })
    // Back to the entry right after 1R: the stop on the entry is hit within the margin – uncertain.
    expect(whatIfFor(trade(), series(until, { 10: 1.1515, 60: 1.1485 }), until, m)!.be1R_tp2).toEqual({ r: 0, uncertain: true })
  })

  it('bez rozstrzygnięcia – zamknięcie po ostatniej cenie; ta sama minuta SL i cel = SL niepewny; cel w marginesie = niepewny', () => {
    // Up to 1.5R, then at +0.5R until 17:00 NY.
    const r = whatIfFor(trade(), series(until, { 10: 1.1515 }, held), until, m)!
    expect(r.tp1).toEqual({ r: 0.5, uncertain: false })
    expect(r.half1R_tp2).toEqual({ r: 0.75, uncertain: false }) // 0.5 × 1R + 0.5 × 0.5R
    const both = series(until)
    both[15] = { ...both[15]!, high: 1.1525, low: 1.1485 }
    expect(whatIfFor(trade(), both, until, m)!.tp1).toEqual({ r: -1, uncertain: true })
    expect(whatIfFor(trade(), series(until, { 10: 1.15205 }), until, m)!.r2).toEqual({ r: 2, uncertain: true })
    // The entry minute is not replayed (part of it was before the entry), nor anything from the horizon on.
    expect(whatIfFor(trade(), series(until, { 0: 1.1485 }), until, m)!.r2).toEqual({ r: 0, uncertain: false })
  })

  it('short lustrzanie; bez TP2 plany z TP2 = null; bez SL – brak wyników', () => {
    const short = trade({ direction: 'short', prices: { entry: 1.15, stopLoss: 1.151, takeProfit1: 1.148, takeProfit2: null } })
    const r = whatIfFor(short, series(until, { 30: 1.1475 }), until, m)!
    expect(r).toMatchObject({ tp1: { r: 2, uncertain: false }, tp2: null, be1R_tp2: null, half1R_tp2: null, r2: { r: 2 } })
    expect(r.r3).toEqual({ r: 0, uncertain: false })
    expect(whatIfFor(trade({ prices: { entry: 1.15, stopLoss: null, takeProfit1: 1.152, takeProfit2: null } }), series(until), until, m)).toBeNull()
    expect(whatIfFor(trade(), [], until, m)).toBeNull()
  })

  it('podsumowanie: plany czekają na koniec dnia handlowego (whatIfAfter), potem liczone ponownie', () => {
    const t = trade()
    const b = series(until, { 10: 1.1515, 30: 1.1525, 60: 1.1485 }, held)
    const opts = { ticker: 'EURUSD.FOREX', pipSize: 0.0001, marginPips: 1 }
    const early = marketStatsFor(t, b, { ...opts, now: '2026-09-23T15:00:00.000Z' })
    expect(early).toMatchObject({ v: MARKET_STATS_VERSION, whatIf: null, whatIfAfter: new Date(until).toISOString() })
    const saved = { ...t, market: early }
    expect(needsMarketStats(saved, until - 1)).toBe(false)
    expect(needsMarketStats(saved, until)).toBe(true)
    const done = marketStatsFor(t, b, { ...opts, now: '2026-09-24T00:00:00.000Z' })
    expect(done.whatIfAfter).toBeNull()
    expect(done.whatIf).toMatchObject({ horizon: new Date(until).toISOString(), results: { tp1: { r: 2 }, r3: { r: -1 } } })
    expect(needsMarketStats({ ...t, market: done }, until + 1)).toBe(false)
  })
})

describe('zmienność: ATR 14 dni handlowych przed dniem transakcji', () => {
  const t = trade()
  /** One bar per trading day (15 before the trade's day): range 10 + k pips around 1.15. */
  function daily(days = 15, gap?: { k: number; close: number }): Bar[] {
    const dates: string[] = []
    let d = sessionDateOf(t.entryTime)
    for (let i = 0; i < days; i++) dates.unshift((d = previousTradingDay(d)))
    return dates.map((date, k) => {
      const r = 0.001 + 0.0001 * k
      const close = gap && gap.k === k ? gap.close : 1.15
      return { t: daySession(date).from + 6 * 60 * MIN, open: 1.15, high: 1.15 + r / 2, low: 1.15 - r / 2, close }
    })
  }

  it('okno od 15 dni handlowych wstecz (poniedziałek → piątek), ATR = średnia 14 TR', () => {
    expect(volatilityWindowFrom(t)).toBe(daySession('2026-09-02').from)
    expect(atrBefore(t, daily())).toBeCloseTo(0.00175, 10) // TR of days 1…14 = 11…24 pips
    // A gap: the true range reaches back to the previous close.
    expect(atrBefore(t, daily(15, { k: 13, close: 1.16 }))).toBeCloseTo((0.00175 * 14 - 0.0024 + (1.16 - (1.15 - 0.0012))) / 14, 10)
    // Fewer than 11 days with bars: no ATR.
    expect(atrBefore(t, daily().slice(5))).toBeNull()
    // Bars of the trade's own day do not count.
    expect(atrBefore(t, [...daily(), { t: start, open: 1.15, high: 1.2, low: 1.1, close: 1.15 }])).toBeCloseTo(0.00175, 10)
  })

  it('w pipsach, SL w ATR, zakres Azji', () => {
    expect(volatilityFor(t, daily(), 0.0001, 0.0015)).toEqual({ atrPips: 17.5, slAtr: 0.57, asiaRangePips: 15 })
    expect(volatilityFor(t, [], 0.0001, null)).toEqual({ atrPips: null, slAtr: null, asiaRangePips: null })
  })
})

describe('analityka danych rynkowych', () => {
  const journal = createDefaultJournal()
  const ctx = metricsContext(journal.settings)
  const market = (over: Record<string, unknown>) => tradeMarketSchema.parse({ v: MARKET_STATS_VERSION, ticker: 'EURUSD.FOREX', ...over })
  const res = (r: number, uncertain = false) => ({ r, uncertain })
  let n = 0
  const row = (pair: string, exit: number, over: Partial<Trade> = {}): AnalyzedTrade => {
    n++
    const tr = createTrade({
      pair,
      direction: 'long',
      entryTime: `2026-09-${String(n).padStart(2, '0')}T13:00:00.000Z`,
      prices: { entry: 1.1, stopLoss: 1.099, takeProfit1: 1.102, takeProfit2: null },
      exits: [{ id: '01K6H3Z0W8Q4M2N5P7R9S1T3V5', time: `2026-09-${String(n).padStart(2, '0')}T14:00:00.000Z`, price: exit, percent: 100, note: '' }],
      ...over
    })
    const m = tradeMetrics(tr, ctx)
    return { trade: tr, m, v: validateTrade(tr, m, journal.settings, null) }
  }
  const whatIf = (results: Record<string, { r: number; uncertain: boolean } | null>) => ({ horizon: '2026-09-01T21:00:00.000Z', results })

  it('co by było, gdyby: te same transakcje, różnica wobec rzeczywistego wyniku, niepewne', () => {
    const rows = [
      row('EURUSD', 1.102, { market: market({ whatIf: whatIf({ tp1: res(2), r2: res(2), r3: res(-1) }) }) }), // +2R
      row('EURUSD', 1.099, { market: market({ whatIf: whatIf({ tp1: res(-1), r2: res(-1), r3: res(-1, true) }) }) }), // −1R
      row('EURUSD', 1.1005, { market: market({ whatIf: whatIf({ tp1: res(2), r2: res(2), r3: res(3) }) }) }), // +0.5R
      row('EURUSD', 1.102, { market: market({}) }), // no replay
      row('EURUSD', 1.1, { status: 'missed', missed: { reasonId: null, hypotheticalOutcome: 'tp1' }, market: market({ whatIf: whatIf({ tp1: res(2) }) }) })
    ]
    const s = whatIfSummary(rows, 0.1)
    expect(s.trades).toBe(3)
    const get = (id: string) => s.lines.find((l) => l.id === id)!
    expect(get('actual')).toMatchObject({ count: 3, maxDrawdownR: 1, deltaR: 0 })
    expect(get('actual').totalR).toBeCloseTo(1.5, 9)
    expect(get('tp1')).toMatchObject({ count: 3, totalR: 3, uncertain: 0 })
    expect(get('tp1').deltaR).toBeCloseTo(1.5, 9)
    expect(get('r3')).toMatchObject({ count: 3, totalR: 1, maxDrawdownR: 2, uncertain: 1 })
    expect(get('r3').deltaR).toBeCloseTo(-0.5, 9)
    expect(get('tp2')).toMatchObject({ count: 0, totalR: 0, deltaR: 0 })
    expect(s.lines.map((l) => l.id)).toEqual(['actual', 'tp1', 'tp2', 'be1R_tp2', 'r2', 'r3', 'half1R_tp2'])
  })

  it('reżimy wg percentyli ATR pary (min. 4 transakcje), SL w ATR, czasy MAE / MFE', () => {
    const vol = (atrPips: number, slAtr: number | null) => market({ vol: { atrPips, slAtr, asiaRangePips: null } })
    const rows = [
      row('EURUSD', 1.102, { market: { ...vol(50, 0.1), maePips: -3, mfePips: 25, reached1R: 'yes', reached2R: 'yes', mfeMinutes: 40 } }),
      row('EURUSD', 1.099, { market: { ...vol(60, 0.15), maePips: -10, mfePips: 2, reached1R: 'no', maeMinutes: 12, stopTouched: 'yes' } }),
      row('EURUSD', 1.102, { market: { ...vol(70, 0.3), maePips: -2, mfePips: 21, reached1R: 'yes', reached2R: 'near', mfeMinutes: 60 } }),
      row('EURUSD', 1.1, { market: { ...vol(80, 0.5), maePips: -12, mfePips: 4, reached1R: 'no', stopTouched: 'yes' } }), // BE although the stop was touched
      row('EURUSD', 1.099, { market: vol(90, 0) }),
      row('AUDUSD', 1.102, { market: vol(10, 0.2) })
    ]
    const reg = regimes(rows)
    expect(rows.map((r) => reg.get(r.trade.id) ?? null)).toEqual(['calm', 'calm', 'normal', 'hot', 'hot', null])
    const v = volatilityBreakdown(rows, 0.1)
    expect(v.measured).toBe(6)
    expect(v.regimes.map((g) => [g.id, g.count, Math.round(g.totalR * 1e6) / 1e6])).toEqual([
      ['calm', 2, 1],
      ['normal', 1, 2],
      ['hot', 2, -1]
    ])
    expect(v.stops.map((g) => [g.id, g.count])).toEqual([
      ['sl1', 1],
      ['sl2', 2],
      ['sl3', 1],
      ['sl4', 1]
    ])
    const tm = excursionTiming(rows, 0.1)
    expect(tm).toEqual({ measured: 4, reached1R: 0.5, reached2R: 0.25, mfeMinutesWinners: 50, maeMinutesLosers: 12, stopTouchedSurvived: 1 })
    expect(excursionTiming([], 0.1)).toMatchObject({ measured: 0, reached1R: null, mfeMinutesWinners: null })
  })

  it('raport: sekcja danych rynkowych tylko z danymi', () => {
    const plain = createTrade({
      pair: 'EURUSD',
      direction: 'long',
      entryTime: '2026-09-10T13:00:00.000Z',
      prices: { entry: 1.1, stopLoss: 1.099, takeProfit1: 1.102, takeProfit2: null },
      exits: [{ id: '01K6H3Z0W8Q4M2N5P7R9S1T3V5', time: '2026-09-10T14:00:00.000Z', price: 1.102, percent: 100, note: '' }]
    })
    const rows = (trades: Trade[]) =>
      trades.map((tr) => {
        const m = tradeMetrics(tr, ctx)
        return { trade: tr, m, v: validateTrade(tr, m, journal.settings, null) }
      })
    const without = monthlyReportMarkdown(buildMonthlyReport(rows([plain]), [], journal, '2026-09'))
    expect(without).not.toContain('Co by było, gdyby')
    const withData = monthlyReportMarkdown(buildMonthlyReport(rows([{ ...plain, market: market({ whatIf: whatIf({ tp1: res(2), r2: res(2), r3: res(-1) }), vol: { atrPips: 60, slAtr: 0.17, asiaRangePips: 20 } }) }]), [], journal, '2026-09'))
    expect(withData).toContain('Co by było, gdyby (transakcje z danymi rynkowymi: 1)')
    expect(withData).toContain('| Stały cel 3R | 1 | 0.0% | −1.00R | −3.00R | 1.00R |')
    expect(withData).not.toContain('Trzymanie do TP2') // no trade with a TP2
    expect(withData).toContain('Wielkość SL względem ATR')
  })
})
