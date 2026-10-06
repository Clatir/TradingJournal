import { describe, expect, it } from 'vitest'
import { createDefaultJournal, createTrade } from '@shared/defaults'
import { metricsContext, tradeMetrics } from '@shared/calc/trade'
import { validateTrade } from '@shared/calc/validator'
import { positionSize } from '@shared/calc/position'
import { lotValueFor } from '@shared/instruments'
import { isOilSymbol, oilScaleMismatch, pairContractSize, pairMaxStopPips, pairPreset } from '@shared/pairs'
import type { PairConfig, Settings } from '@shared/schema'

function settingsWith(pair: Partial<PairConfig> & { symbol: string }): Settings {
  const s = createDefaultJournal().settings
  const base: PairConfig = { pipSize: 0.0001, priceDecimals: 5, quoteCurrency: 'USD', tvSymbol: '', archived: false, ...pair }
  return { ...s, pairs: [...s.pairs.filter((p) => p.symbol !== pair.symbol), base] }
}

/** The trade from the report: OILWTI short 90.37, SL 90.84, closed at 86.83 (+3.54 USD per barrel). */
const oilTrade = (lots: number | null = null) =>
  createTrade({
    pair: 'OILWTI',
    direction: 'short',
    entryTime: '2026-10-06T10:15:00.000Z',
    lots,
    prices: { entry: 90.37, stopLoss: 90.84, takeProfit1: 86.83, takeProfit2: null },
    exits: [{ id: '01K6H3Z0W8Q4M2N5P7R9S1T3V5', time: '2026-10-06T14:00:00.000Z', price: 86.83, percent: 100, note: '' }]
  })

describe('skala par: ropa i inne instrumenty', () => {
  it('rozpoznaje symbole ropy i podaje ustawienia dla nowej pary', () => {
    for (const s of ['OILWTI', 'OIL.WTI', 'USOIL', 'XTIUSD', 'WTI', 'UKOIL', 'BRENT', 'XBRUSD', 'OIL']) expect(isOilSymbol(s)).toBe(true)
    for (const s of ['EURUSD', 'USDJPY', 'XAUUSD', 'US30']) expect(isOilSymbol(s)).toBe(false)
    expect(pairPreset('OILWTI', 'PLN')).toMatchObject({ pipSize: 0.01, priceDecimals: 2, quoteCurrency: 'USD', contractSize: 1000, tvSymbol: 'TVC:USOIL' })
    expect(pairPreset('UKOIL', null)).toMatchObject({ tvSymbol: 'TVC:UKOIL' })
    expect(pairPreset('USDJPY', 'JPY')).toMatchObject({ pipSize: 0.01, priceDecimals: 3, contractSize: null })
    expect(pairPreset('GBPUSD', null)).toMatchObject({ pipSize: 0.0001, quoteCurrency: 'USD', tvSymbol: 'FX:GBPUSD', contractSize: null })
  })

  it('ropa z pipsem 0.01: 354 pipsy wyniku, SL 47 pipsów, R bez zmian (+7.53R)', () => {
    const wrong = settingsWith({ symbol: 'OILWTI', pipSize: 0.0005 })
    expect(oilScaleMismatch(wrong.pairs.at(-1)!, wrong)).toBe(true)
    const w = tradeMetrics(oilTrade(), metricsContext(wrong))
    expect([w.resultPips, w.riskPips].map((x) => Math.round(x!))).toEqual([7080, 940])
    const s = settingsWith({ symbol: 'OILWTI', pipSize: 0.01, priceDecimals: 2, contractSize: 1000 })
    expect(oilScaleMismatch(s.pairs.at(-1)!, s)).toBe(false)
    const m = tradeMetrics(oilTrade(), metricsContext(s))
    expect(m.resultPips).toBeCloseTo(354, 6)
    expect(m.riskPips).toBeCloseTo(47, 6)
    expect(m.resultR).toBeCloseTo(3.54 / 0.47, 6)
  })

  it('limit SL pary zastępuje ogólny (20 p) w walidatorze', () => {
    const general = settingsWith({ symbol: 'OILWTI', pipSize: 0.01 })
    const g = validateTrade(oilTrade(), tradeMetrics(oilTrade(), metricsContext(general)), general, null)
    expect(g.rules.find((r) => r.id === 'maxStopPips')).toMatchObject({ status: 'fail', detail: 'SL 47.0 p > 20 p' })
    const own = settingsWith({ symbol: 'OILWTI', pipSize: 0.01, maxStopPips: 60 })
    expect(pairMaxStopPips('OILWTI', own)).toBe(60)
    expect(pairMaxStopPips('EURUSD', own)).toBe(20)
    const o = validateTrade(oilTrade(), tradeMetrics(oilTrade(), metricsContext(own)), own, null)
    expect(o.rules.find((r) => r.id === 'maxStopPips')).toMatchObject({ status: 'pass', detail: 'SL 47.0 p ≤ 60 p (limit OILWTI)' })
  })

  it('jednostki w locie pary: kalkulator pozycji i wynik z lotów', () => {
    const s = settingsWith({ symbol: 'OILWTI', pipSize: 0.01, contractSize: 1000 })
    expect(pairContractSize('OILWTI', s)).toBe(1000)
    expect(pairContractSize('EURUSD', s)).toBe(100000)
    expect(lotValueFor('OILWTI', s)).toEqual({ contractSize: 1000, quoteCurrency: 'USD' })
    // 10 000 USD, 1% risk, SL 47 pips: 1 lot = 1000 bbl × 0.01 = 10 USD per pip → 100 / 470 = 0.21 lota (down to the step).
    const pos = positionSize({ balance: 10000, riskPercent: 1, stopPips: 47, pipSize: 0.01, contractSize: pairContractSize('OILWTI', s), quoteToAccountRate: 1, lotStep: 0.01 })
    expect(pos?.lots).toBe(0.21)
    // Result from lots: 354 pips × 0.01 × 1000 × 0.5 lota = 1770 USD.
    const m = tradeMetrics(oilTrade(0.5), metricsContext(s))
    expect(m.amountSource).toBe('lots')
    expect(m.pnlAmountOwn).toBeCloseTo(1770, 6)
  })
})
