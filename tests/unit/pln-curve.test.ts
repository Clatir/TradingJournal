import { describe, expect, it } from 'vitest'
import { createDefaultJournal } from '@shared/defaults'
import { metricsContext, tradeMetrics } from '@shared/calc/trade'
import { validateTrade } from '@shared/calc/validator'
import { plnCurve } from '@shared/calc/plnCurve'
import type { JournalFile, Trade } from '@shared/schema'
import { closedTradeAt } from './helpers/trades'

function journalWith(over: { account?: string; balance?: number | null } = {}): JournalFile {
  const j = createDefaultJournal()
  j.settings.risk.accountCurrency = over.account ?? 'PLN'
  j.settings.risk.accountBalance = over.balance === undefined ? 20000 : over.balance
  // USD → PLN: the table before 2026-03-17 is 3.72; otherwise the manual rate 4.
  j.settings.fx.history = { USD: { from: '2026-03-01', to: '2026-03-31', rates: { '2026-03-16': 3.72 } } }
  j.settings.fx.manual = { 'USD>PLN': 4 }
  return j
}

const rows = (trades: Trade[], journal: JournalFile) => {
  const ctx = metricsContext(journal.settings)
  return trades.map((trade) => {
    const m = tradeMetrics(trade, ctx)
    return { trade, m, v: validateTrade(trade, m, journal.settings, null) }
  })
}

describe('krzywa zarobków w PLN', () => {
  it('kwoty w PLN, w USD po kursie NBP z dnia przed zamknięciem albo dzisiejszym, kolejność zamknięć, drawdown', () => {
    const j = journalWith()
    const trades = [
      closedTradeAt('2026-03-17T09:00:00.000Z', 2, { pnlAmountOverride: 100, amountCurrency: 'USD' }), // 3.72 → 372
      closedTradeAt('2026-03-10T09:00:00.000Z', -1, { pnlAmountOverride: -50, amountCurrency: 'PLN' }),
      closedTradeAt('2026-04-02T09:00:00.000Z', -1, { pnlAmountOverride: -25, amountCurrency: 'USD' }) // no table → 4 → −100
    ]
    const c = plnCurve(rows(trades, j), j, { estimates: true })
    expect(c.points.map((p) => Number(p.pln.toFixed(2)))).toEqual([-50, 372, -100])
    expect(c.points.map((p) => Number(p.equity.toFixed(2)))).toEqual([-50, 322, 222])
    expect(c.points.map((p) => Number(p.drawdown.toFixed(2)))).toEqual([-50, 0, -100])
    expect(c.total).toBeCloseTo(222, 6)
    expect(c.maxDrawdown).toBeCloseTo(100, 6)
    expect(c).toMatchObject({ closed: 3, exact: 3, estimated: 0, historical: 1, current: 1, noAmount: 0, withoutRate: 0 })
    expect(c.best).toBeCloseTo(372, 6)
    expect(c.worst).toBeCloseTo(-100, 6)
    expect(c.avgLoss).toBeCloseTo(-75, 6)
    // Strictly increasing times.
    expect(c.points.every((p, i) => i === 0 || p.time > c.points[i - 1]!.time)).toBe(true)
  })

  it('szacunek R × ryzyko % × saldo (w walucie konta, przeliczony na PLN), wyłączany; brak danych i kursu – pominięte', () => {
    const pln = journalWith()
    const trades = [
      closedTradeAt('2026-03-10T09:00:00.000Z', 1.5, { riskPercent: 0.5 }), // 1.5 × 0.5% × 20 000 = 150
      closedTradeAt('2026-03-11T09:00:00.000Z', -1, { riskPercent: null })
    ]
    expect(plnCurve(rows(trades, pln), pln, { estimates: true })).toMatchObject({ total: 150, estimated: 1, exact: 0, noAmount: 1 })
    expect(plnCurve(rows(trades, pln), pln, { estimates: false })).toMatchObject({ total: 0, estimated: 0, noAmount: 2, points: [] })
    // Account in USD: the estimate is in USD and converted (table before 2026-03-17 → 3.72).
    const usd = journalWith({ account: 'USD', balance: 10000 })
    const est = plnCurve(rows([closedTradeAt('2026-03-17T09:00:00.000Z', 1, { riskPercent: 1 })], usd), usd, { estimates: true })
    expect(est.total).toBeCloseTo(372, 6)
    expect(est.points[0]!.estimated).toBe(true)
    // An amount in a currency without any rate to PLN is left out and named.
    const noRate = journalWith()
    const left = plnCurve(rows([closedTradeAt('2026-03-10T09:00:00.000Z', 1, { pnlAmountOverride: 10, amountCurrency: 'CHF' })], noRate), noRate, { estimates: true })
    expect(left).toMatchObject({ withoutRate: 1, missingRates: ['CHF'], points: [] })
  })
})
