import { describe, expect, it } from 'vitest'
import { positionSize } from '@shared/calc/position'

const base = { pipSize: 0.0001, contractSize: 100000, lotStep: 0.01 }

describe('kalkulator pozycji', () => {
  it('konto USD, EURUSD (waluta kwotowana = konta): 1% z 10 000, SL 20 pips → 0.50 lota', () => {
    const r = positionSize({ ...base, balance: 10000, riskPercent: 1, stopPips: 20, quoteToAccountRate: 1 })!
    expect(r.riskAmount).toBe(100)
    expect(r.pipValuePerLot).toBeCloseTo(10, 9)
    expect(r.lots).toBe(0.5)
    expect(r.actualRiskAmount).toBeCloseTo(100, 9)
  })

  it('konto USD, EURGBP z kursem GBP→USD 1.27 → zaokrąglenie w dół do 0.39', () => {
    const r = positionSize({ ...base, balance: 10000, riskPercent: 1, stopPips: 20, quoteToAccountRate: 1.27 })!
    expect(r.pipValuePerLot).toBeCloseTo(12.7, 9)
    expect(r.lotsExact).toBeCloseTo(0.3937, 4)
    expect(r.lots).toBe(0.39)
    expect(r.actualRiskAmount).toBeLessThanOrEqual(100)
  })

  it('konto PLN, EURUSD z kursem USD→PLN 3.65, ryzyko 0.5% z 50 000, SL 12.5 pips', () => {
    const r = positionSize({ ...base, balance: 50000, riskPercent: 0.5, stopPips: 12.5, quoteToAccountRate: 3.65 })!
    expect(r.riskAmount).toBe(250)
    expect(r.lots).toBe(0.54)
    expect(r.actualRiskPercent).toBeLessThanOrEqual(0.5)
  })

  it('dokładna wielokrotność kroku nie jest obcinana przez błąd zmiennoprzecinkowy', () => {
    const r = positionSize({ ...base, balance: 3000, riskPercent: 1, stopPips: 10, quoteToAccountRate: 1 })!
    expect(r.lots).toBe(0.3)
  })

  it('krok 0.1 lota', () => {
    const r = positionSize({ ...base, lotStep: 0.1, balance: 10000, riskPercent: 1, stopPips: 15, quoteToAccountRate: 1 })!
    expect(r.lots).toBe(0.6)
  })

  it('niepoprawne dane → null', () => {
    expect(positionSize({ ...base, balance: 10000, riskPercent: 1, stopPips: 0, quoteToAccountRate: 1 })).toBeNull()
    expect(positionSize({ ...base, balance: Number.NaN, riskPercent: 1, stopPips: 10, quoteToAccountRate: 1 })).toBeNull()
  })
})
