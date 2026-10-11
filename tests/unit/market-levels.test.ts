import { describe, expect, it } from 'vitest'
import { DateTime } from 'luxon'
import { createTrade } from '@shared/defaults'
import { daySession, dayLevels, levelSessions, levelsWindow, liquidityNameMatches, liquidityTakenBefore, previousTradingDay, weekSession } from '@shared/calc/marketLevels'
import { MARKET_STATS_VERSION, marketStatsFor, missedHorizon, missedOutcomeFor, needsMarketStats, sessionDateOf, withMarketStats } from '@shared/calc/marketStats'
import { sessionSpans } from '@shared/calc/sessionSpans'
import { createDefaultJournal } from '@shared/defaults'
import type { Bar } from '@shared/market'
import type { Trade } from '@shared/schema'

const MIN = 60_000
const NY = 'America/New_York'
const ny = (s: string) => DateTime.fromISO(s, { zone: NY }).toMillis()

/** Flat M1 bars at `price` over [from, to) with a few spikes { at: price }. */
function bars(from: number, to: number, price: number, spikes: Record<number, number> = {}): Bar[] {
  const out: Bar[] = []
  for (let t = from; t < to; t += MIN) {
    const s = spikes[t]
    out.push({ t, open: price, close: price, high: s != null && s > price ? s : price + 0.00005, low: s != null && s < price ? s : price - 0.00005 })
  }
  return out
}

describe('poziomy dnia z danych rynkowych', () => {
  const sessions = levelSessions({ start: '20:00', end: '00:00' }, createDefaultJournal().settings.killzones)

  it('dzień handlowy 17:00–17:00 NY, poprzedni dzień w poniedziałek = piątek, tydzień od niedzieli 17:00, dzień transakcji po 17:00 = następny', () => {
    expect(previousTradingDay('2026-09-21')).toBe('2026-09-18') // Monday → Friday
    expect(previousTradingDay('2026-09-23')).toBe('2026-09-22')
    expect(daySession('2026-09-22')).toEqual({ from: ny('2026-09-21T17:00'), to: ny('2026-09-22T17:00') })
    expect(weekSession('2026-09-23', 1)).toEqual({ from: ny('2026-09-13T17:00'), to: ny('2026-09-18T17:00') })
    expect(levelsWindow('2026-09-23')).toEqual({ fromMs: ny('2026-09-13T17:00'), toMs: ny('2026-09-23T17:00') })
    expect(sessionDateOf('2026-09-22T20:59:00.000Z')).toBe('2026-09-22') // 16:59 NY
    expect(sessionDateOf('2026-09-22T21:00:00.000Z')).toBe('2026-09-23') // 17:00 NY
    // London from the killzone named London; DST: the same New York hours in winter.
    expect(sessions.london).toEqual({ start: '02:00', end: '05:00' })
    expect(daySession('2026-12-15')).toEqual({ from: Date.parse('2026-12-14T22:00:00Z'), to: Date.parse('2026-12-15T22:00:00Z') })
  })

  it('PDH/PDL, PWH/PWL, Azja, Londyn, otwarcia – z czasami ekstremów i momentem, od którego są znane', () => {
    const d = '2026-09-23'
    const w = levelsWindow(d)
    const b = bars(w.fromMs, w.toMs, 1.15, {
      [ny('2026-09-22T09:30')]: 1.152, // PDH (22.09 session)
      [ny('2026-09-22T03:10')]: 1.148, // PDL
      [ny('2026-09-16T10:00')]: 1.16, // PWH
      [ny('2026-09-14T04:00')]: 1.14, // PWL
      [ny('2026-09-22T21:15')]: 1.1512, // Asia high (22.09 20:00 → 23.09 00:00)
      [ny('2026-09-22T23:40')]: 1.1494, // Asia low
      [ny('2026-09-23T03:30')]: 1.1508, // London high (02:00–05:00)
      [ny('2026-09-23T04:45')]: 1.1496 // London low
    })
    const lv = dayLevels(d, b, sessions)
    const get = (id: string) => lv.find((l) => l.id === id)!
    expect(get('pdh')).toMatchObject({ price: 1.152, at: ny('2026-09-22T09:30'), knownFrom: ny('2026-09-22T17:00'), side: 'high' })
    expect(get('pdl')).toMatchObject({ price: 1.148, at: ny('2026-09-22T03:10') })
    expect(get('pwh')).toMatchObject({ price: 1.16, knownFrom: ny('2026-09-18T17:00') })
    expect(get('pwl').price).toBe(1.14)
    expect(get('asiaH')).toMatchObject({ price: 1.1512, knownFrom: ny('2026-09-23T00:00') })
    expect(get('asiaL').price).toBe(1.1494)
    expect(get('londonH')).toMatchObject({ price: 1.1508, knownFrom: ny('2026-09-23T05:00') })
    expect(get('londonL').price).toBe(1.1496)
    expect(lv.filter((l) => l.side === 'open').map((l) => [l.id, l.at])).toEqual([
      ['dayOpen', ny('2026-09-22T17:00')],
      ['midnight', ny('2026-09-23T00:00')],
      ['open0830', ny('2026-09-23T08:30')]
    ])
    // Liquidity before an entry at 09:40 NY: 09:05 up to 1.1514 (Asia high and London high taken), 09:20 down to
    // 1.14945 (London low taken, Asia low within the 1-pip margin). PDH / PDL / PWH / PWL untouched; a bar after the
    // entry does not count.
    const after = [
      ...b.filter((x) => x.t < ny('2026-09-23T09:00')),
      { t: ny('2026-09-23T09:05'), open: 1.15, high: 1.1514, low: 1.1499, close: 1.15 },
      { t: ny('2026-09-23T09:20'), open: 1.15, high: 1.1501, low: 1.14945, close: 1.1497 },
      { t: ny('2026-09-23T09:45'), open: 1.15, high: 1.1530, low: 1.1470, close: 1.15 }
    ]
    const taken = liquidityTakenBefore(lv, after, ny('2026-09-23T09:40'), 0.0001)
    expect(taken.map((t) => [t.id, t.touch, t.at])).toEqual([
      ['asiaH', 'yes', ny('2026-09-23T09:05')],
      ['asiaL', 'near', ny('2026-09-23T09:20')],
      ['londonH', 'yes', ny('2026-09-23T09:05')],
      ['londonL', 'yes', ny('2026-09-23T09:20')]
    ])
    expect(liquidityNameMatches('asiaL', 'Asia low')).toBe(true)
    expect(liquidityNameMatches('pdh', ' pdh ')).toBe(true)
    expect(liquidityNameMatches('pdh', 'PDL')).toBe(false)
  })

  it('sesje (killzone’y) w UTC dla okna, także przez północ', () => {
    const kz = createDefaultJournal().settings.killzones
    const spans = sessionSpans(ny('2026-09-23T00:00'), ny('2026-09-23T12:00'), kz)
    const london = spans.find((s) => /london/i.test(s.name))!
    expect([london.from, london.to]).toEqual([ny('2026-09-23T02:00'), ny('2026-09-23T05:00')])
    const overnight = sessionSpans(ny('2026-09-23T00:00'), ny('2026-09-23T03:00'), [{ id: '01K6H3Z0W8Q4M2N5P7R9S1T3V5', name: 'Azja', start: '20:00', end: '00:00', kind: 'killzone', archived: false }])
    expect(overnight.map((s) => [s.date, s.from, s.to])).toEqual([])
    const asia = sessionSpans(ny('2026-09-22T21:00'), ny('2026-09-23T03:00'), [{ id: '01K6H3Z0W8Q4M2N5P7R9S1T3V5', name: 'Azja', start: '20:00', end: '00:00', kind: 'killzone', archived: false }])
    expect(asia.map((s) => [s.date, s.from, s.to])).toEqual([['2026-09-22', ny('2026-09-22T20:00'), ny('2026-09-23T00:00')]])
  })
})

describe('missed trade z danych rynkowych', () => {
  const missed = (over: Partial<Trade> = {}): Trade =>
    createTrade({
      pair: 'EURUSD',
      direction: 'long',
      status: 'missed',
      entryTime: '2026-09-23T13:00:00.000Z', // 09:00 NY
      prices: { entry: 1.15, stopLoss: 1.149, takeProfit1: 1.152, takeProfit2: 1.154 },
      ...over
    })
  const start = Date.parse('2026-09-23T13:00:00Z')
  const until = missedHorizon(missed())!
  const series = (spikes: Record<number, number>) => bars(start, until, 1.15, spikes)
  const at = (min: number) => start + min * MIN
  const m = 0.0001

  it('horyzont do 17:00 NY dnia handlowego', () => {
    expect(until).toBe(ny('2026-09-23T17:00'))
    expect(missedHorizon(missed({ entryTime: '2026-09-23T21:30:00.000Z' }))).toBe(ny('2026-09-24T17:00'))
  })

  it('co pierwsze: TP1, potem TP2 przed SL = TP2; SL pierwszy; nic; ta sama minuta = niepewne; blisko poziomu = niepewne', () => {
    expect(missedOutcomeFor(missed(), series({ [at(10)]: 1.1525 }), until, m)).toEqual({ outcome: 'tp1', certain: true, at: at(10) })
    expect(missedOutcomeFor(missed(), series({ [at(10)]: 1.1525, [at(40)]: 1.1545 }), until, m)).toEqual({ outcome: 'tp2', certain: true, at: at(40) })
    expect(missedOutcomeFor(missed(), series({ [at(10)]: 1.1525, [at(20)]: 1.1485, [at(40)]: 1.1545 }), until, m)).toEqual({ outcome: 'tp1', certain: true, at: at(10) })
    expect(missedOutcomeFor(missed(), series({ [at(5)]: 1.1485, [at(10)]: 1.1525 }), until, m)).toEqual({ outcome: 'sl', certain: true, at: at(5) })
    expect(missedOutcomeFor(missed(), series({}), until, m)).toEqual({ outcome: 'none', certain: true, at: null })
    // The same minute: a bar touching both the stop and the target.
    const both = series({})
    both[15] = { ...both[15]!, high: 1.1525, low: 1.1485 }
    expect(missedOutcomeFor(missed(), both, until, m)).toMatchObject({ outcome: 'sl', certain: false })
    // Within the margin of the stop first, then TP1: uncertain.
    expect(missedOutcomeFor(missed(), series({ [at(5)]: 1.14905, [at(10)]: 1.1525 }), until, m)).toMatchObject({ outcome: 'tp1', certain: false })
    // The entry minute (part of it before the entry) is not counted; nothing after the horizon either.
    expect(missedOutcomeFor(missed(), series({ [at(0)]: 1.1485 }), until, m).outcome).toBe('none')
    expect(missedOutcomeFor(missed(), [...series({}), { t: until, open: 1.15, high: 1.16, low: 1.15, close: 1.15 }], until, m).outcome).toBe('none')
    // Short: mirrored.
    const short = missed({ direction: 'short', prices: { entry: 1.15, stopLoss: 1.151, takeProfit1: 1.148, takeProfit2: null } })
    expect(missedOutcomeFor(short, series({ [at(30)]: 1.1475 }), until, m)).toMatchObject({ outcome: 'tp1', certain: true })
  })

  it('podsumowanie missed: dopiero po horyzoncie, wynik ustawiany tylko pusty i pewny; stare podsumowanie (1.8.0) liczone ponownie', () => {
    const t = missed()
    expect(needsMarketStats(t, until - 1)).toBe(false)
    expect(needsMarketStats(t, until + 1)).toBe(true)
    const s = marketStatsFor(t, series({ [at(10)]: 1.1525 }), { ticker: 'EURUSD.FOREX', pipSize: 0.0001, marginPips: 1, now: '' })
    expect(s).toMatchObject({ v: MARKET_STATS_VERSION, maePips: null, missed: { outcome: 'tp1', certain: true, at: new Date(at(10)).toISOString(), until: new Date(until).toISOString() } })
    expect(withMarketStats(t, s).missed.hypotheticalOutcome).toBe('tp1')
    expect(withMarketStats({ ...t, missed: { ...t.missed, hypotheticalOutcome: 'sl' } }, s).missed.hypotheticalOutcome).toBe('sl')
    expect(withMarketStats(t, { ...s, missed: { ...s.missed!, certain: false } }).missed.hypotheticalOutcome).toBeNull()
    expect(needsMarketStats(withMarketStats(t, s), until + 1)).toBe(false)
    expect(needsMarketStats({ ...withMarketStats(t, s), market: { ...s, v: 1 } }, until + 1)).toBe(true)
  })
})
