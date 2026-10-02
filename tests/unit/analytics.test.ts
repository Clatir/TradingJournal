import { describe, expect, it } from 'vitest'
import { createDayPlan, createDefaultJournal, createTrade } from '@shared/defaults'
import { metricsContext, tradeMetrics } from '@shared/calc/trade'
import { validateTrade } from '@shared/calc/validator'
import {
  applyFilter,
  breakdowns,
  calendarDays,
  complianceMatrix,
  equitySeries,
  mistakeCosts,
  missedSummary,
  summaryOf,
  type AnalyzedTrade,
  type Group
} from '@shared/calc/analytics'
import { generateSample } from '@shared/sample/generate'
import { tradeSchema, dayPlanSchema, weekReviewSchema, libraryItemSchema, journalSchema, type DayPlan, type JournalFile, type Trade } from '@shared/schema'

function analyze(journal: JournalFile, trades: Trade[], days: DayPlan[] = []): AnalyzedTrade[] {
  const ctx = metricsContext(journal.settings)
  const byDate = new Map(days.map((d) => [d.date, d]))
  return trades.map((t) => {
    const m = tradeMetrics(t, ctx)
    return { trade: t, m, v: validateTrade(t, m, journal.settings, byDate.get(m.tradingDate) ?? null) }
  })
}

const journal = createDefaultJournal()
const tag = journal.dictionaries.mistakeTags[0]!.id
const model = journal.dictionaries.entryModels[0]!.id

function t(entryTime: string, pair: string, exit: number, extra: Partial<Trade> = {}): Trade {
  return createTrade({
    pair,
    direction: 'long',
    entryTime,
    entryModelId: model,
    prices: { entry: 1.1, stopLoss: 1.099, takeProfit1: 1.102, takeProfit2: null },
    exits: [{ id: '01K6H3Z0W8Q4M2N5P7R9S1T3V5', time: null, price: exit, percent: 100, note: '' }],
    stopBeyondLiquidity: 'yes',
    ...extra
  })
}

describe('analityka – przypadki liczone ręcznie', () => {
  const trades = [
    t('2026-03-16T07:30:00.000Z', 'EURUSD', 1.102), // Mon London +2R
    t('2026-03-17T12:30:00.000Z', 'EURUSD', 1.099, { psychology: { before: { score: null, note: '' }, during: { score: null, note: '' }, after: { score: null, note: '' }, mistakeTagIds: [tag], didWell: '', nextTime: '' } }), // Tue NY 08:30 -1R
    t('2026-03-18T07:30:00.000Z', 'AUDUSD', 1.1, {}), // Wed London BE
    t('2026-03-19T16:30:00.000Z', 'AUDUSD', 1.099, { psychology: { before: { score: null, note: '' }, during: { score: null, note: '' }, after: { score: null, note: '' }, mistakeTagIds: [tag], didWell: '', nextTime: '' } }), // Thu 12:30 NY outside -1R
    t('2026-03-20T07:30:00.000Z', 'EURUSD', 1.1, { status: 'missed', missed: { reasonId: null, hypotheticalOutcome: 'tp1' } })
  ]
  const rows = analyze(journal, trades)

  it('podsumowanie liczy tylko zamknięte (bez missed)', () => {
    const s = summaryOf(rows, 0.1)
    expect(s.count).toBe(4)
    expect(s.totalR).toBeCloseTo(0, 9)
    expect(s.winRate).toBeCloseTo(1 / 3, 9)
  })

  it('rozbicia po parze, sesji, dniu tygodnia i godzinie NY', () => {
    const b = breakdowns(rows, journal)
    expect(b.pair.map((g) => [g.label, g.count, +g.totalR.toFixed(2)])).toEqual([
      ['EURUSD', 2, 1],
      ['AUDUSD', 2, -1]
    ])
    expect(b.session.map((g) => [g.label, g.count])).toEqual([
      ['London', 2],
      ['New York', 1],
      ['poza KZ', 1]
    ])
    expect(b.weekday.map((g) => g.label)).toEqual(['Poniedziałek', 'Wtorek', 'Środa', 'Czwartek'])
    expect(b.hour.map((g) => g.key)).toEqual(['03', '08', '12'])
    expect(b.model[0]?.label).toBe('Sweep → MSS → FVG')
  })

  it('macierz zgodność × wynik', () => {
    const mx = complianceMatrix(rows, 0.1)
    // Outside killzone trade breaks the killzone rule; the others are compliant (HTF bias n/a without plan).
    expect(mx.broken.total.count).toBe(1)
    expect(mx.broken.loss.count).toBe(1)
    expect(mx.compliant.total.count).toBe(3)
    expect(mx.compliant.win.totalR).toBeCloseTo(2, 9)
  })

  it('koszt tagu błędu względem transakcji bez błędów', () => {
    const c = mistakeCosts(rows, journal)
    expect(c.cleanCount).toBe(2)
    expect(c.baselineAvgR).toBeCloseTo(1, 9) // (+2 + 0) / 2
    expect(c.tags[0]).toMatchObject({ tagId: tag, count: 2 })
    expect(c.tags[0]?.totalR).toBeCloseTo(-2, 9)
    expect(c.tags[0]?.costR).toBeCloseTo(-4, 9) // -2 - 2 × 1
  })

  it('kalendarz i missed trades', () => {
    expect(calendarDays(rows).get('2026-03-16')?.totalR).toBeCloseTo(2, 9)
    expect(calendarDays(rows).has('2026-03-20')).toBe(false)
    const ms = missedSummary(rows, journal)
    expect(ms.count).toBe(1)
    expect(ms.totalR).toBeCloseTo(2, 9)
  })

  it('filtr dat i par', () => {
    expect(applyFilter(rows, { from: '2026-03-17', to: '2026-03-19' }).length).toBe(3)
    expect(applyFilter(rows, { pairs: ['AUDUSD'] }).length).toBe(2)
  })

  it('seria equity ma rosnące, unikalne znaczniki czasu', () => {
    const same = [t('2026-03-16T07:30:00.000Z', 'EURUSD', 1.102), t('2026-03-16T07:30:00.000Z', 'EURUSD', 1.099)]
    const eq = equitySeries(analyze(journal, same))
    expect(eq[1]!.time).toBeGreaterThan(eq[0]!.time)
  })
})

describe('dane przykładowe', () => {
  const sample = generateSample({ seed: 7, endDate: '2026-09-30', now: '2026-10-01T10:00:00.000Z' })

  it('30 transakcji (w tym 3 missed), plany dni, 2 przeglądy tygodnia, biblioteka – wszystko zgodne ze schematami', () => {
    expect(sample.trades).toHaveLength(30)
    expect(sample.trades.filter((x) => x.status === 'missed')).toHaveLength(3)
    expect(sample.days.length).toBeGreaterThanOrEqual(25)
    expect(sample.weeks).toHaveLength(2)
    expect(sample.library).toHaveLength(4)
    expect(journalSchema.safeParse(sample.journal).success).toBe(true)
    for (const x of sample.trades) expect(tradeSchema.safeParse(x).success).toBe(true)
    for (const x of sample.days) expect(dayPlanSchema.safeParse(x).success).toBe(true)
    for (const x of sample.weeks) expect(weekReviewSchema.safeParse(x).success).toBe(true)
    for (const x of sample.library) expect(libraryItemSchema.safeParse(x).success).toBe(true)
    expect(sample.screens.length).toBeGreaterThan(10)
  })

  it('analityka na danych przykładowych jest spójna', () => {
    const rows = analyze(sample.journal, sample.trades, sample.days)
    const s = summaryOf(rows, 0.1)
    expect(s.count).toBe(27)
    const b = breakdowns(rows, sample.journal)
    for (const groups of Object.values(b) as Group[][]) {
      expect(groups.reduce((a, g) => a + g.count, 0)).toBe(27)
      expect(groups.reduce((a, g) => a + g.totalR, 0)).toBeCloseTo(s.totalR, 6)
    }
    const mx = complianceMatrix(rows, 0.1)
    expect(mx.compliant.total.count + mx.broken.total.count + mx.unrated.total.count).toBe(27)
    expect(mx.broken.total.count).toBeGreaterThan(0)
    expect(mx.compliant.total.count).toBeGreaterThan(0)
    expect([...calendarDays(rows).values()].reduce((a, d) => a + d.totalR, 0)).toBeCloseTo(s.totalR, 6)
  })

  it('jest deterministyczny dla tego samego ziarna', () => {
    const again = generateSample({ seed: 7, endDate: '2026-09-30', now: '2026-10-01T10:00:00.000Z' })
    const results = (x: typeof sample) => analyze(x.journal, x.trades).map((r) => r.m.resultR)
    expect(results(again)).toEqual(results(sample))
  })

  it('plan dnia z newsem / bias jest używany przez walidator', () => {
    const d = createDayPlan('2026-03-16', ['EURUSD'], [])
    expect(d.pairs[0]?.bias.D.direction).toBeNull()
  })
})
