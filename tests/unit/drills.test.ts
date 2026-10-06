import { describe, expect, it } from 'vitest'
import { createDefaultJournal } from '@shared/defaults'
import { newId } from '@shared/ids'
import { metricsContext, tradeMetrics } from '@shared/calc/trade'
import { answerCard, cardHistory, drillCandidates, drillStats, isDrillable, pickDrillCards, scoreCard, tally, truthOf, type DrillRow } from '@shared/calc/drills'
import { drillSessionSchema, type DrillCard, type DrillSession, type ScreenRef, type Trade } from '@shared/schema'
import { closedTradeAt } from './helpers/trades'

const ctx = metricsContext(createDefaultJournal().settings)
const screen = (phase: ScreenRef['phase']): ScreenRef => ({
  id: newId(),
  path: 'screens/2026/09/x.webp',
  thumbPath: 'screens/2026/09/x.thumb.webp',
  phase,
  timeframe: 'M5',
  caption: '',
  width: 100,
  height: 50,
  bytes: 1,
  createdAt: '2026-09-01T00:00:00.000Z',
  annotations: []
})
const row = (t: Trade): DrillRow => ({ trade: t, m: tradeMetrics(t, ctx) })
const withBefore = (entry: string, r: number, over: Partial<Trade> = {}) => row(closedTradeAt(entry, r, { screens: [screen('before'), screen('after')], ...over }))

function seeded(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

function session(cards: Array<Partial<DrillCard> & { tradeId: string }>, startedAt = '2026-09-20T10:00:00.000Z'): DrillSession {
  return drillSessionSchema.parse({
    schemaVersion: 1,
    id: newId(),
    createdAt: startedAt,
    updatedAt: startedAt,
    startedAt,
    cards
  })
}

describe('karty treningowe', () => {
  it('karta = zamknięta albo missed z wynikiem i screenem „przed”', () => {
    expect(isDrillable(withBefore('2026-09-01T12:00:00.000Z', 2))).toBe(true)
    expect(isDrillable(row(closedTradeAt('2026-09-01T12:00:00.000Z', 2, { screens: [screen('after')] })))).toBe(false)
    expect(isDrillable(withBefore('2026-09-01T12:00:00.000Z', 2, { status: 'open', exits: [] }))).toBe(false)
    const missed = withBefore('2026-09-01T12:00:00.000Z', 0, { status: 'missed', exits: [], missed: { reasonId: null, hypotheticalOutcome: 'tp1' } as Trade['missed'] })
    expect(isDrillable(missed)).toBe(true)
    expect(truthOf(missed)).toMatchObject({ status: 'missed', outcome: 'win', resultR: expect.closeTo(3, 9), direction: 'long' })
    const noOutcome = withBefore('2026-09-01T12:00:00.000Z', 0, { status: 'missed', exits: [], missed: { reasonId: null, hypotheticalOutcome: null } as Trade['missed'] })
    expect(isDrillable(noOutcome)).toBe(false)
  })

  it('ocena: kierunek, decyzja wobec wyniku, błąd SL', () => {
    const win = truthOf(withBefore('2026-09-01T12:00:00.000Z', 2))!
    const loss = truthOf(withBefore('2026-09-01T12:00:00.000Z', -1))!
    const be = truthOf(withBefore('2026-09-01T12:00:00.000Z', 0))!
    const card = (answer: DrillCard['answer'], truth: DrillCard['truth'], slPips: number | null = null): DrillCard => ({ tradeId: newId(), pair: 'EURUSD', answer, slPips, answeredAt: '2026-09-20T10:00:00.000Z', truth })
    expect(scoreCard(card('long', win, 11))).toEqual({ direction: true, decision: true, slError: expect.closeTo(1, 9), slClose: true })
    expect(scoreCard(card('short', win))).toMatchObject({ direction: false, decision: false, slError: null, slClose: null })
    expect(scoreCard(card('skip', win))).toMatchObject({ direction: null, decision: false })
    expect(scoreCard(card('skip', loss, 20))).toMatchObject({ direction: null, decision: true, slClose: false })
    expect(scoreCard(card('long', loss))).toMatchObject({ direction: true, decision: false })
    expect(scoreCard(card('long', be))).toMatchObject({ direction: true, decision: null })
    expect(scoreCard(card(null, win))).toBeNull()
    expect(scoreCard(card('long', null))).toBeNull()
    // 25% of a 40-pip stop = 10 pips.
    expect(scoreCard(card('long', { ...win, riskPips: 40 }, 50))?.slClose).toBe(true)
    expect(scoreCard(card('long', { ...win, riskPips: 40 }, 51))?.slClose).toBe(false)
  })

  it('wybór kart: najpierw nowe, potem błędne, potem najdawniej powtarzane; filtr pary i wieku', () => {
    const a = withBefore('2026-08-03T12:00:00.000Z', 2)
    const b = withBefore('2026-08-04T12:00:00.000Z', -1)
    const c = withBefore('2026-08-05T12:00:00.000Z', 3)
    const d = withBefore('2026-08-06T12:00:00.000Z', 1, { pair: 'GBPUSD' })
    const recent = withBefore('2026-09-28T12:00:00.000Z', 2)
    const rows = [a, b, c, d, recent]
    const past = [
      session([{ tradeId: a.trade.id, pair: 'EURUSD', answer: 'long', answeredAt: '2026-09-01T10:00:00.000Z', truth: truthOf(a) }], '2026-09-01T10:00:00.000Z'),
      session([{ tradeId: b.trade.id, pair: 'EURUSD', answer: 'long', answeredAt: '2026-09-10T10:00:00.000Z', truth: truthOf(b) }], '2026-09-10T10:00:00.000Z'),
      session([{ tradeId: c.trade.id, pair: 'EURUSD', answer: 'long', answeredAt: '2026-08-20T10:00:00.000Z', truth: truthOf(c) }], '2026-08-20T10:00:00.000Z')
    ]
    const opts = { pair: null, minAgeDays: 7, today: '2026-10-01', random: seeded(7) }
    expect(drillCandidates(rows, opts).map((r) => r.trade.id)).not.toContain(recent.trade.id)
    expect(drillCandidates(rows, { ...opts, minAgeDays: 0 }).map((r) => r.trade.id)).toContain(recent.trade.id)
    expect(drillCandidates(rows, { ...opts, pair: 'GBPUSD' }).map((r) => r.trade.id)).toEqual([d.trade.id])
    const h = cardHistory(past)
    expect(h.get(b.trade.id)).toMatchObject({ count: 1, lastWrong: true }) // took a loser
    expect(h.get(a.trade.id)?.lastWrong).toBe(false)
    // 1 card: the never-answered d; 2 cards: d and the wrong b; 3: + c (answered longest ago).
    expect(pickDrillCards(rows, past, { ...opts, count: 1 })).toEqual([d.trade.id])
    expect(new Set(pickDrillCards(rows, past, { ...opts, count: 2 }))).toEqual(new Set([d.trade.id, b.trade.id]))
    expect(new Set(pickDrillCards(rows, past, { ...opts, count: 3 }))).toEqual(new Set([d.trade.id, b.trade.id, c.trade.id]))
    expect(pickDrillCards(rows, past, { ...opts, count: 10 })).toHaveLength(4)
  })

  it('odpowiedź zapisuje prawdę z chwili odpowiedzi; statystyki per miesiąc i para', () => {
    const w = withBefore('2026-08-03T12:00:00.000Z', 2)
    const l = withBefore('2026-08-04T12:00:00.000Z', -1, { pair: 'GBPUSD' })
    const s1 = session([
      answerCard({ tradeId: w.trade.id, pair: 'EURUSD', answer: null, slPips: null, answeredAt: null, truth: null }, 'long', 10, w, '2026-08-20T10:00:00.000Z'),
      answerCard({ tradeId: l.trade.id, pair: 'GBPUSD', answer: null, slPips: null, answeredAt: null, truth: null }, 'long', 0, l, '2026-08-20T10:01:00.000Z')
    ])
    expect(s1.cards[0]).toMatchObject({ answer: 'long', slPips: 10, truth: { outcome: 'win', direction: 'long' } })
    expect(s1.cards[1]!.slPips).toBeNull()
    const s2 = session([
      answerCard({ tradeId: l.trade.id, pair: 'GBPUSD', answer: null, slPips: null, answeredAt: null, truth: null }, 'skip', null, l, '2026-09-02T10:00:00.000Z'),
      { tradeId: w.trade.id, pair: 'EURUSD' } // not answered
    ])
    expect(tally(s1.cards)).toMatchObject({ answered: 2, directionN: 2, directionOk: 2, decisionN: 2, decisionOk: 1, slN: 1, slClose: 1 })
    const st = drillStats([s1, s2])
    expect(st.total).toMatchObject({ answered: 3, decisionN: 3, decisionOk: 2 })
    expect(st.tradesSeen).toBe(2)
    expect(st.months.map((m) => [m.month, m.tally.answered, m.tally.decisionOk])).toEqual([
      ['2026-08', 2, 1],
      ['2026-09', 1, 1]
    ])
    expect(st.pairs.map((p) => [p.pair, p.tally.answered])).toEqual([
      ['GBPUSD', 2],
      ['EURUSD', 1]
    ])
  })
})
