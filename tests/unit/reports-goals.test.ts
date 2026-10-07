import { describe, expect, it } from 'vitest'
import { createDefaultJournal, createTrade } from '@shared/defaults'
import { metricsContext, tradeMetrics } from '@shared/calc/trade'
import { validateTrade } from '@shared/calc/validator'
import { breakdowns, calendarDays, type AnalyzedTrade } from '@shared/calc/analytics'
import { goalState, type GoalEntry } from '@shared/calc/goals'
import { monthRange, periodMetrics, previousRange, quarterRange, rangeLabel, yearRange } from '@shared/calc/periods'
import { plnByTrade } from '@shared/calc/plnCurve'
import { taxSummary } from '@shared/calc/tax'
import { buildReport, monthlyReportMarkdown, reportSections, REPORT_SECTIONS } from '@shared/export/monthlyReport'
import type { JournalFile, Trade } from '@shared/schema'

function analyze(journal: JournalFile, trades: Trade[]): AnalyzedTrade[] {
  const ctx = metricsContext(journal.settings)
  return trades.map((t) => {
    const m = tradeMetrics(t, ctx)
    return { trade: t, m, v: validateTrade(t, m, journal.settings, null) }
  })
}

// Long, entry 1.1, SL 10 pips below: exit 1.102 = +2R, 1.099 = −1R.
function t(entryTime: string, pair: string, exit: number, extra: Partial<Trade> = {}): Trade {
  return createTrade({
    pair,
    direction: 'long',
    entryTime,
    prices: { entry: 1.1, stopLoss: 1.099, takeProfit1: 1.102, takeProfit2: null },
    exits: [{ id: '01K6H3Z0W8Q4M2N5P7R9S1T3V5', time: null, price: exit, percent: 100, note: '' }],
    ...extra
  })
}

const base = createDefaultJournal()
const journal: JournalFile = {
  ...base,
  settings: {
    ...base.settings,
    risk: { ...base.settings.risk, accountCurrency: 'PLN' },
    fx: {
      ...base.settings.fx,
      manual: { 'USD>PLN': 4 },
      history: { USD: { from: '2025-12-01', to: '2026-03-31', rates: { '2025-12-30': 3.6, '2026-03-16': 3.7 } } }
    }
  }
}

describe('cele i alerty', () => {
  const s = (goals: Partial<JournalFile['settings']['goals']>, risk: Partial<JournalFile['settings']['risk']> = {}) => ({
    ...base.settings,
    risk: { ...base.settings.risk, dailyLossLimitR: null, dailyMaxTrades: null, ...risk },
    goals: { ...base.settings.goals, ...goals }
  })
  const e = (tradingDate: string, resultR: number, riskPercent: number | null = 1, status: GoalEntry['status'] = 'closed'): GoalEntry => ({ status, tradingDate, resultR, riskPercent })
  // Wednesday 2026-10-07: the week 05–11.10, the month of October.
  const entries = [e('2026-10-05', 2), e('2026-10-06', -1, 0.5), e('2026-10-07', -1.5, 1), e('2026-10-07', -0.5, null), e('2026-09-30', 4), e('2026-10-07', -1, 1, 'missed')]

  it('dzienny limit w % konta (Σ R × ryzyko %, bez ryzyka – domyślne), tydzień i miesiąc względem celów', () => {
    const g = goalState('2026-10-07', entries, s({ dailyLossPercent: 1.5, weeklyTargetR: 1, monthlyTargetR: 3, weeklyLossLimitR: 2 }, { defaultRiskPercent: 0.5 }))
    expect(g.dailyPercent).toBeCloseTo(-1.5 - 0.25, 9)
    expect(g.dailyPercentHit).toBe(true)
    expect(g.week).toMatchObject({ from: '2026-10-05', to: '2026-10-11', targetR: 1, targetReached: false, lossLimitHit: false })
    expect(g.week.totalR).toBeCloseTo(-1, 9)
    expect(g.month.totalR).toBeCloseTo(-1, 9)
    expect(g.month.targetReached).toBe(false)
    expect(g.alerts).toEqual(['Dzienny limit straty w % konta: -1.75% (limit −1.5%).'])
  })

  it('tygodniowy limit straty, cele osiągnięte, dzienne limity z ryzyka w alertach; bez celów – brak alertów', () => {
    const g = goalState('2026-10-07', entries, s({ weeklyLossLimitR: 1, weeklyTargetR: 0.5 }, { dailyLossLimitR: 2, dailyMaxTrades: 2 }))
    expect(g.alerts).toEqual(['Dzienny limit straty: -2.00R (limit −2R).', 'Limit transakcji na dziś: 2 z 2.', 'Tygodniowy limit straty: -1.00R (limit −1R).'])
    const sep = goalState('2026-09-30', entries, s({ monthlyTargetR: 4 }))
    expect(sep.month.targetReached).toBe(true)
    expect(goalState('2026-10-07', entries, s({})).alerts).toEqual([])
  })
})

describe('okresy i porównanie', () => {
  it('zakresy, poprzedni okres tej samej długości, nazwy', () => {
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(previousRange(monthRange('2026-03'))).toEqual(monthRange('2026-02'))
    expect(previousRange(quarterRange(2026, 1))).toEqual(quarterRange(2025, 4))
    expect(previousRange(yearRange(2026))).toEqual(yearRange(2025))
    expect(previousRange({ from: '2026-10-05', to: '2026-10-11' })).toEqual({ from: '2026-09-28', to: '2026-10-04' })
    expect(rangeLabel(monthRange('2026-03'))).toBe('marzec 2026')
    expect(rangeLabel(quarterRange(2026, 4))).toBe('IV kw. 2026')
    expect(rangeLabel(yearRange(2026))).toBe('2026')
    expect(rangeLabel({ from: '2026-03-02', to: '2026-03-20' })).toBe('2026-03-02 – 2026-03-20')
  })

  it('metryki okresu z PLN', () => {
    const rows = analyze(journal, [
      t('2026-03-16T07:30:00.000Z', 'EURUSD', 1.102, { riskAmount: 100, amountCurrency: 'PLN' }),
      t('2026-03-17T07:30:00.000Z', 'EURUSD', 1.099),
      t('2026-02-10T07:30:00.000Z', 'EURUSD', 1.099, { riskAmount: 100, amountCurrency: 'PLN' })
    ])
    const plnOf = plnByTrade(rows, journal, false)
    const m = periodMetrics(rows, monthRange('2026-03'), 0.1, plnOf)
    expect(m).toMatchObject({ trades: 2, wins: 1, losses: 1, winRate: 0.5, plnTrades: 1 })
    expect(m.pln).toBeCloseTo(200, 6)
    expect(m.totalR).toBeCloseTo(1, 9)
    expect(periodMetrics(rows, monthRange('2026-02'), 0.1, plnOf).pln).toBeCloseTo(-100, 6)
  })
})

describe('PLN w rozbiciach i kalendarzu', () => {
  it('Σ PLN grupy i dnia tylko z transakcji z wynikiem w PLN', () => {
    const rows = analyze(journal, [
      t('2026-03-16T07:30:00.000Z', 'EURUSD', 1.102, { riskAmount: 100, amountCurrency: 'PLN' }),
      t('2026-03-16T08:30:00.000Z', 'EURUSD', 1.099, { riskAmount: 50, amountCurrency: 'USD' }), // −50 × 4 (no table for 16.03 → manual)
      t('2026-03-17T07:30:00.000Z', 'AUDUSD', 1.099)
    ])
    const plnOf = plnByTrade(rows, journal, false)
    const pair = breakdowns(rows, journal, plnOf).pair
    expect(pair.find((g) => g.key === 'EURUSD')).toMatchObject({ plnCount: 2, count: 2 })
    expect(pair.find((g) => g.key === 'EURUSD')!.pln).toBeCloseTo(0, 6)
    expect(pair.find((g) => g.key === 'AUDUSD')).toMatchObject({ pln: null, plnCount: 0 })
    expect(breakdowns(rows, journal).pair[0]!.pln).toBeNull()
    const cal = calendarDays(rows, plnOf)
    expect(cal.get('2026-03-16')!.pln).toBeCloseTo(0, 9)
    expect(cal.get('2026-03-17')!.pln).toBeNull()
  })
})

describe('PIT-38 orientacyjnie', () => {
  const rows = analyze(journal, [
    // Closed 2025-12-31 (Warsaw): last year, not counted for 2026.
    t('2025-12-31T09:00:00.000Z', 'EURUSD', 1.102, { riskAmount: 10, amountCurrency: 'USD' }),
    t('2026-01-02T09:00:00.000Z', 'EURUSD', 1.102, { riskAmount: 50, amountCurrency: 'USD' }), // +100 USD × 3.6 (30.12)
    t('2026-03-17T09:00:00.000Z', 'EURUSD', 1.099, { pnlAmountOverride: -40, amountCurrency: 'USD' }), // −40 × 3.7 (16.03)
    t('2026-03-18T09:00:00.000Z', 'EURUSD', 1.099, { pnlAmountOverride: -20.5, amountCurrency: 'PLN' }),
    t('2026-06-02T09:00:00.000Z', 'EURUSD', 1.102, { pnlAmountOverride: 10, amountCurrency: 'USD' }), // no table → today's 4 (approximate)
    t('2026-06-03T09:00:00.000Z', 'EURUSD', 1.102), // no amount
    t('2026-06-04T09:00:00.000Z', 'EURUSD', 1.102, { pnlAmountOverride: 5, amountCurrency: 'CHF' }) // no rate
  ])
  const tax = taxSummary(rows, journal, yearRange(2026))

  it('przychód = zyski, koszty = straty, kurs NBP z dnia przed zamknięciem, pominięte policzone', () => {
    expect(tax.income).toBeCloseTo(360 + 40, 6)
    expect(tax.costs).toBeCloseTo(148 + 20.5, 6)
    expect(tax.result).toBeCloseTo(400 - 168.5, 6)
    expect(tax.trades.map((x) => [x.date, x.rate, x.rateDate, x.pln])).toEqual([
      ['2026-01-02', 3.6, '2025-12-30', 360],
      ['2026-03-17', 3.7, '2026-03-16', -148],
      ['2026-03-18', 1, null, -20.5],
      ['2026-06-02', 4, null, 40]
    ])
    expect(tax).toMatchObject({ approximate: 1, noAmount: 1, withoutRate: 1, missingRates: ['CHF'] })
    expect(tax.byMonth.map((m) => [m.month, m.trades])).toEqual([
      ['2026-01', 1],
      ['2026-03', 2],
      ['2026-06', 1]
    ])
  })

  it('sekcje raportu: wybór i kolejność, porównanie, PIT-38, lista transakcji; rok po miesiącach', () => {
    const r = buildReport(rows, [], journal, yearRange(2026), '2027-01-02T00:00:00.000Z')
    expect(r.title).toBe('Raport – 2026')
    expect(r.periodUnit).toBe('month')
    expect(r.weeks.map((w) => w.label)).toEqual(['2026-01', '2026-03', '2026-06'])
    const ids = reportSections(r, ['tax', 'summary', 'comparison']).sections.map((s) => s.heading)
    expect(ids[0]).toBe('Podsumowanie')
    expect(ids[1]).toBe('Porównanie z poprzednim okresem (2025)')
    expect(ids[2]).toBe('PIT-38 – zestawienie orientacyjne (2026, wg daty zamknięcia)')
    const md = monthlyReportMarkdown(r, REPORT_SECTIONS.map((s) => s.id))
    expect(md).toContain('| Przychód (suma zysków) | 400.00 PLN |')
    expect(md).toContain('| Koszty (suma strat) | 168.50 PLN |')
    expect(md).toContain('| Dochód / strata | +231.50 PLN |')
    expect(md).toContain('| 2026-01-02 | EURUSD | +100.00 USD | 3.6000 | 2025-12-30 | +360.00 PLN |')
    expect(md).toContain('| 2026-06-02 | EURUSD | +10.00 USD | 4.0000 | bieżący | +40.00 PLN |')
    expect(md).toContain('## Lista transakcji')
    expect(md).toContain('## Dni tygodnia (NY)')
    expect(md).toContain('Pominięte: 1 bez kwoty (wpisz wynik w kwocie albo loty), 1 bez kursu CHF → PLN.')
    expect(monthlyReportMarkdown(r, ['summary'])).not.toContain('## Lista transakcji')
  })
})
