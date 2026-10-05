import { describe, expect, it } from 'vitest'
import { metricsContext, tradeMetrics } from '@shared/calc/trade'
import { createTrade } from '@shared/defaults'
import { historicalRate, historyNeeds, historyUses, mergeHistory, parseNbpHistory, transactionDate, type FxHistory } from '@shared/fxHistory'
import { settingsSchema, type Settings } from '@shared/schema'

// Table A: Mon 28.09 – Fri 02.10.2026 (no tables on the weekend).
const USD = { '2026-09-28': 3.95, '2026-09-29': 3.92, '2026-09-30': 3.9, '2026-10-01': 3.88, '2026-10-02': 3.8881 }
const EUR = { '2026-09-28': 4.39, '2026-09-29': 4.38, '2026-09-30': 4.37, '2026-10-01': 4.36, '2026-10-02': 4.3745 }
const HISTORY: FxHistory = {
  USD: { from: '2026-09-20', to: '2026-10-04', rates: USD },
  EUR: { from: '2026-09-20', to: '2026-10-04', rates: EUR }
}
const settings = (history: FxHistory = HISTORY, accountCurrency = 'PLN'): Settings =>
  settingsSchema.parse({
    risk: { accountCurrency },
    fx: { history, nbp: { no: '192/A/NBP/2026', effectiveDate: '2026-10-02', fetchedAt: '2026-10-02T12:15:00.000Z', rates: { USD: 3.8881, EUR: 4.3745 } } }
  })

describe('kurs NBP z dnia poprzedzającego transakcję', () => {
  it('tabela z ostatniego dnia publikacji przed datą transakcji', () => {
    const s = settings()
    expect(historicalRate('USD', 'PLN', '2026-10-05', s)).toEqual({ rate: 3.8881, tableDate: '2026-10-02' }) // Monday → Friday
    expect(historicalRate('USD', 'PLN', '2026-10-02', s)).toEqual({ rate: 3.88, tableDate: '2026-10-01' })
    expect(historicalRate('USD', 'PLN', '2026-10-04', s)).toEqual({ rate: 3.8881, tableDate: '2026-10-02' }) // Sunday
    expect(historicalRate('PLN', 'USD', '2026-10-02', s)).toEqual({ rate: Number((1 / 3.88).toFixed(6)), tableDate: '2026-10-01' })
    expect(historicalRate('EUR', 'USD', '2026-10-01', s)).toEqual({ rate: Number((4.37 / 3.9).toFixed(6)), tableDate: '2026-09-30' })
  })

  it('bez pokrycia dnia poprzedzającego albo z dziurą – brak kursu archiwalnego', () => {
    const s = settings()
    expect(historicalRate('USD', 'PLN', '2026-10-06', s)).toBeNull() // the day before (05.10) is not covered yet
    expect(historicalRate('USD', 'PLN', '2026-09-20', s)).toBeNull() // before the covered range
    expect(historicalRate('USD', 'PLN', '2026-09-26', s)).toBeNull() // covered, but no table within 10 days before
    expect(historicalRate('CHF', 'PLN', '2026-10-02', s)).toBeNull()
    expect(historicalRate('USD', 'USD', '2026-10-02', s)).toBeNull()
  })

  it('data transakcji: ostatnie wyjście (zamknięcie) w kalendarzu warszawskim, inaczej wejście', () => {
    const t = createTrade({ pair: 'EURUSD', direction: 'long', entryTime: '2026-10-01T07:30:00.000Z' })
    expect(transactionDate(t)).toBe('2026-10-01')
    const closed = { ...t, exits: [{ id: 'x', time: '2026-10-02T22:30:00.000Z', price: 1.09, percent: 100, note: '' }] }
    expect(transactionDate(closed)).toBe('2026-10-03') // 00:30 in Warsaw
  })

  it('zakresy do pobrania: od 10 dni przed najwcześniejszą transakcją do dnia przed ostatnią, poza tym, co już jest', () => {
    const uses = [
      { code: 'USD', date: '2026-03-10' },
      { code: 'USD', date: '2026-10-02' },
      { code: 'PLN', date: '2026-10-02' }
    ]
    expect(historyNeeds(uses, {}, '2026-10-05')).toEqual([{ code: 'USD', start: '2026-02-28', end: '2026-10-01' }])
    const covered: FxHistory = { USD: { from: '2026-03-01', to: '2026-09-15', rates: {} } }
    expect(historyNeeds(uses, covered, '2026-10-05')).toEqual([
      { code: 'USD', start: '2026-02-28', end: '2026-02-28' },
      { code: 'USD', start: '2026-09-16', end: '2026-10-01' }
    ])
    expect(historyNeeds(uses, { USD: { from: '2026-02-01', to: '2026-10-04', rates: {} } }, '2026-10-05')).toEqual([])
    // Never beyond today; more than 367 days in requests of at most 367 days.
    expect(historyNeeds([{ code: 'EUR', date: '2026-10-09' }], {}, '2026-10-05')).toEqual([{ code: 'EUR', start: '2026-09-29', end: '2026-10-05' }])
    const long = historyNeeds([{ code: 'USD', date: '2024-01-11' }, { code: 'USD', date: '2026-01-01' }], {}, '2026-10-05')
    expect(long).toEqual([
      { code: 'USD', start: '2024-01-01', end: '2025-01-01' },
      { code: 'USD', start: '2025-01-02', end: '2025-12-31' }
    ])
  })

  it('scalanie zakresów i odczyt odpowiedzi NBP', () => {
    const merged = mergeHistory({ USD: { from: '2026-09-20', to: '2026-10-04', rates: USD } }, 'USD', '2026-10-05', '2026-10-06', { '2026-10-05': 3.87 })
    expect(merged.USD).toEqual({ from: '2026-09-20', to: '2026-10-06', rates: { ...USD, '2026-10-05': 3.87 } })
    expect(mergeHistory({}, 'EUR', '2026-01-01', '2026-01-31', {}).EUR).toEqual({ from: '2026-01-01', to: '2026-01-31', rates: {} })
    expect(
      parseNbpHistory({ table: 'A', currency: 'dolar amerykański', code: 'USD', rates: [{ no: '191/A/NBP/2026', effectiveDate: '2026-10-01', mid: 3.88 }] })
    ).toEqual({ '2026-10-01': 3.88 })
    expect(parseNbpHistory({ rates: 'x' })).toBeNull()
  })

  it('wynik transakcji w USD na koncie PLN: kurs z dnia przed zamknięciem; bez archiwum – dzisiejszy', () => {
    const t = {
      ...createTrade({ pair: 'EURUSD', direction: 'long', entryTime: '2026-10-01T07:30:00.000Z' }),
      status: 'closed' as const,
      prices: { entry: 1.085, stopLoss: 1.0835, takeProfit1: null, takeProfit2: null },
      exits: [{ id: 'x', time: '2026-10-02T09:00:00.000Z', price: 1.0865, percent: 100, note: '' }],
      riskAmount: 50,
      amountCurrency: 'USD'
    }
    const m = tradeMetrics(t, metricsContext(settings()))
    expect(m.pnlAmountOwn).toBeCloseTo(50, 9)
    expect(m.amountRateDate).toBe('2026-10-01') // closed on 02.10 → table of 01.10
    expect(m.pnlAmount).toBeCloseTo(50 * 3.88, 9)
    const today = tradeMetrics(t, metricsContext(settings({})))
    expect(today.amountRateDate).toBeNull()
    expect(today.pnlAmount).toBeCloseTo(50 * 3.8881, 9)
  })

  it('waluty i daty do przeliczeń: kwoty transakcji (ich waluta i waluta konta)', () => {
    const base = createTrade({ pair: 'EURUSD', direction: 'long', entryTime: '2026-10-01T07:30:00.000Z' })
    const s = settingsSchema.parse({ risk: { accountCurrency: 'PLN', legacyAmountCurrency: 'USD' } })
    expect(historyUses([base], s)).toEqual([]) // no amounts
    expect(historyUses([{ ...base, riskAmount: 50 }], s)).toEqual([{ code: 'USD', date: '2026-10-01' }, { code: 'PLN', date: '2026-10-01' }])
    expect(historyUses([{ ...base, riskAmount: 50, amountCurrency: 'PLN' }], s)).toEqual([{ code: 'PLN', date: '2026-10-01' }])
  })

  it('wynik z lotów (bez kwoty ryzyka): pipsy × pipSize × kontrakt × loty w walucie kwotowanej, potem kurs z dnia', () => {
    const t = {
      ...createTrade({ pair: 'EURUSD', direction: 'long', entryTime: '2026-10-01T07:30:00.000Z' }),
      status: 'closed' as const,
      prices: { entry: 1.085, stopLoss: 1.0835, takeProfit1: null, takeProfit2: null },
      exits: [{ id: 'x', time: '2026-10-02T09:00:00.000Z', price: 1.0865, percent: 100, note: '' }],
      lots: 0.5
    }
    const m = tradeMetrics(t, metricsContext(settings()))
    expect(m.amountSource).toBe('lots')
    expect(m.amountCurrency).toBe('USD')
    expect(m.pnlAmountOwn).toBeCloseTo(75, 9) // 15 pips × 0.0001 × 100 000 × 0.5
    expect(m.pnlAmount).toBeCloseTo(75 * 3.88, 9)
    expect(m.amountRateDate).toBe('2026-10-01')
    // A risk amount wins (as before); an open trade or one without lots has no result from lots.
    expect(tradeMetrics({ ...t, riskAmount: 40, amountCurrency: 'PLN' }, metricsContext(settings())).amountSource).toBe('risk')
    expect(tradeMetrics({ ...t, status: 'open' }, metricsContext(settings())).pnlAmountOwn).toBeNull()
    expect(tradeMetrics({ ...t, lots: null }, metricsContext(settings())).amountSource).toBeNull()
    // The archive is fetched for the quote currency of such a trade.
    expect(historyUses([t], settings())).toEqual([{ code: 'USD', date: '2026-10-02' }, { code: 'PLN', date: '2026-10-02' }])
  })
})

