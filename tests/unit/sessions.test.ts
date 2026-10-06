import { describe, expect, it } from 'vitest'
import { createDayPlan, createDefaultJournal } from '@shared/defaults'
import { metricsContext, tradeMetrics } from '@shared/calc/trade'
import {
  activeSession,
  isPaused,
  isRunning,
  pairMinutes,
  pauseSession,
  pendingReviews,
  resumeSession,
  selectionStats,
  sessionMinutes,
  setPairField,
  startSession,
  stopSession,
  switchPair
} from '@shared/calc/sessions'
import type { AnalysisSession, DayPlan } from '@shared/schema'
import { closedTradeAt } from './helpers/trades'

const at = (hhmm: string, date = '2026-10-05') => `${date}T${hhmm}:00.000Z`

describe('stoper sesji analizy', () => {
  it('start, para, pauza, wznowienie, stop: czas sesji i czas na parę', () => {
    let s = startSession('Przed Londynem', ['EURUSD', 'GBPUSD', 'AUDUSD'], at('05:00'), 'PC-A')
    expect(isRunning(s)).toBe(true)
    s = switchPair(s, 'EURUSD', at('05:10')) // 10 min unmarked
    s = switchPair(s, 'GBPUSD', at('05:30')) // 20 min EURUSD
    s = pauseSession(s, at('05:40')) // 10 min GBPUSD
    expect(isPaused(s)).toBe(true)
    expect(sessionMinutes(s, at('06:00'))).toBe(40) // the pause does not count
    s = resumeSession(s, at('06:00')) // continues on GBPUSD
    s = stopSession(s, at('06:05'))
    expect(isRunning(s)).toBe(false)
    expect(isPaused(s)).toBe(false)
    expect(s.endedAt).toBe(at('06:05'))
    expect(sessionMinutes(s, at('07:00'))).toBe(45)
    // EURUSD 20 + 10/3, GBPUSD 15 + 10/3, AUDUSD 10/3.
    const m = pairMinutes(s, at('07:00'))
    expect(m.get('EURUSD')).toBeCloseTo(20 + 10 / 3, 9)
    expect(m.get('GBPUSD')).toBeCloseTo(15 + 10 / 3, 9)
    expect(m.get('AUDUSD')).toBeCloseTo(10 / 3, 9)
    expect([...m.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(45, 9)
  })

  it('czas wpisany ręcznie: suma sesji i minuty pary', () => {
    let s = startSession('HTF', ['EURUSD', 'GBPUSD'], at('05:00'), null)
    s = stopSession(s, at('05:30'))
    s = { ...s, minutesOverride: 60 }
    s = setPairField(s, 'EURUSD', 'minutes', 45)
    const m = pairMinutes(s, at('08:00'))
    expect(sessionMinutes(s, at('08:00'))).toBe(60)
    expect([m.get('EURUSD'), m.get('GBPUSD')]).toEqual([45, 15])
  })

  it('aktywna sesja: biegnąca albo wstrzymana, nie zakończona', () => {
    const running = startSession('A', ['EURUSD'], at('05:00'), null)
    const ended = stopSession(startSession('B', ['EURUSD'], at('04:00'), null), at('04:30'))
    const day = { ...createDayPlan('2026-10-05', ['EURUSD'], []), sessions: [ended, running] }
    expect(activeSession([day])?.session.id).toBe(running.id)
    expect(activeSession([{ ...day, sessions: [ended] }])).toBeNull()
    const paused = pauseSession(running, at('05:20'))
    expect(activeSession([{ ...day, sessions: [paused] }])?.session.id).toBe(running.id)
  })
})

function sessionWith(start: string, end: string, decisions: Array<[string, AnalysisSession['pairs'][number]['decision'], string[]?, ('setup' | 'noSetup' | 'unknown' | null)?]>): AnalysisSession {
  let s = startSession('Przed NY', decisions.map(([p]) => p), start, null)
  s = stopSession(s, end)
  for (const [pair, decision, reasons, review] of decisions) {
    s = setPairField(s, pair, 'decision', decision)
    s = setPairField(s, pair, 'reasonIds', reasons ?? [])
    s = setPairField(s, pair, 'review', review ?? null)
  }
  return s
}

describe('pytanie o odrzucone pary', () => {
  it('pytamy po 3 h od końca sesji albo następnego dnia; tylko odrzucone bez odpowiedzi', () => {
    const s = sessionWith(at('05:00'), at('06:00'), [
      ['EURUSD', 'trade'],
      ['GBPUSD', 'reject', ['R1']],
      ['AUDUSD', 'reject', ['R2'], 'noSetup']
    ])
    const day: DayPlan = { ...createDayPlan('2026-10-05', [], []), sessions: [s] }
    expect(pendingReviews([day], at('08:00'), '2026-10-05')).toEqual([])
    expect(pendingReviews([day], at('09:01'), '2026-10-05').map((r) => r.pair)).toEqual(['GBPUSD'])
    expect(pendingReviews([day], at('06:30', '2026-10-06'), '2026-10-06').map((r) => [r.date, r.pair, r.reasonIds])).toEqual([['2026-10-05', 'GBPUSD', ['R1']]])
  })
})

describe('statystyki selekcji', () => {
  it('lejek, koszt czasu, trafność odrzuceń, pary, czas a wynik dnia', () => {
    const journal = createDefaultJournal()
    const ctx = metricsContext(journal.settings)
    const day1: DayPlan = {
      ...createDayPlan('2026-10-05', [], []),
      sessions: [
        sessionWith(at('05:00'), at('06:00'), [
          ['EURUSD', 'trade'],
          ['GBPUSD', 'reject', ['R1'], 'noSetup'],
          ['AUDUSD', 'reject', ['R1', 'R2'], 'setup']
        ])
      ]
    }
    const day2: DayPlan = {
      ...createDayPlan('2026-10-06', [], []),
      sessions: [sessionWith(at('05:00', '2026-10-06'), at('05:20', '2026-10-06'), [['EURUSD', 'watch'], ['GBPUSD', null]])]
    }
    // 05.10: EURUSD +2R (selected); 06.10: GBPUSD −1R (not selected); 07.10: a trade on a day without sessions.
    const trades = [
      closedTradeAt('2026-10-05T12:00:00.000Z', 2, { pair: 'EURUSD' }),
      closedTradeAt('2026-10-06T12:00:00.000Z', -1, { pair: 'GBPUSD' }),
      closedTradeAt('2026-10-07T12:00:00.000Z', 3, { pair: 'EURUSD' })
    ]
    const rows = trades.map((trade) => ({ trade, m: tradeMetrics(trade, ctx) }))
    const st = selectionStats([day1, day2], rows, { now: at('12:00', '2026-10-08') })
    expect(st).toMatchObject({ sessions: 2, minutes: 80, analysed: 5, decisions: { trade: 1, watch: 1, reject: 2, none: 1 } })
    expect(st).toMatchObject({ trades: 2, fromSelection: 1, wins: 1 })
    expect(st.totalR).toBeCloseTo(1, 9)
    expect(st.minutesPerTrade).toBe(40)
    expect(st.minutesPerR).toBeCloseTo(80, 9)
    expect(st.rejectAccuracy).toBe(0.5) // GBPUSD correctly rejected, AUDUSD gave a setup
    expect(st.reasons.map((r) => [r.reasonId, r.rejected, r.noSetup, r.setup])).toEqual([
      ['R1', 2, 1, 1],
      ['R2', 1, 0, 1]
    ])
    const eur = st.pairs.find((p) => p.pair === 'EURUSD')!
    expect(eur).toMatchObject({ analysed: 2, selected: 2, trades: 1 })
    expect(eur.minutes).toBeCloseTo(60 / 3 + 20 / 2, 9)
    expect(st.buckets.map((b) => [b.label, b.days, b.avgR == null ? null : Number(b.avgR.toFixed(6))])).toEqual([
      ['< 30 min', 1, -1],
      ['30–60 min', 0, null],
      ['60–90 min', 1, 2],
      ['≥ 90 min', 0, null]
    ])
    // Date range.
    expect(selectionStats([day1, day2], rows, { from: '2026-10-06', now: at('12:00', '2026-10-08') }).sessions).toBe(1)
  })
})
