import { describe, expect, it } from 'vitest'
import { PNL_PRESETS, pipValueForMinLot, pipValuePerLotFrom, presetPipValue, profitLoss, type PnlPresetId } from '@shared/calc/pnl'
import { lotDecimals, shownDecimals, stepDecimals } from '@shared/calc/position'
import { settingsSchema } from '@shared/schema'
import { switchAccountCurrency } from '@shared/risk'

const preset = (id: PnlPresetId) => PNL_PRESETS.find((p) => p.id === id)!
const usd = { minLot: 0.01, fxContractSize: 100_000, quoteToAccountRate: 1 }

describe('wartość pipsa dla najmniejszego lota', () => {
  it('pary z USD jako walutą kwotowaną: 0.10 USD za pips przy 0.01 lota', () => {
    expect(presetPipValue(preset('EURUSD'), usd)).toBe(0.1)
    expect(presetPipValue(preset('AUDUSD'), usd)).toBe(0.1)
  })

  it('EURGBP i EURAUD przez kurs waluty kwotowanej', () => {
    expect(presetPipValue(preset('EURGBP'), { ...usd, quoteToAccountRate: 1.34 })).toBe(0.134)
    expect(presetPipValue(preset('EURAUD'), { ...usd, quoteToAccountRate: 0.66 })).toBe(0.066)
    expect(presetPipValue(preset('EURGBP'), { ...usd, quoteToAccountRate: null })).toBeNull()
  })

  it('WTI: 1 lot = 1000 baryłek, pips = 0.01 → 0.10 USD przy 0.01 lota, niezależnie od lota forex', () => {
    expect(presetPipValue(preset('WTI'), { ...usd, fxContractSize: 10_000 })).toBe(0.1)
  })

  it('konto w innej walucie: przeliczenie przez kurs USD → waluta konta', () => {
    expect(presetPipValue(preset('EURUSD'), { ...usd, quoteToAccountRate: 3.65 })).toBe(0.365)
  })
})

describe('zysk / strata', () => {
  it('loty × pipsy × wartość pipsa najmniejszego lota', () => {
    expect(profitLoss({ lots: 0.5, pips: 20, pipValueMinLot: 0.1, minLot: 0.01 })).toEqual({
      amount: 100,
      pipValuePosition: 5,
      pipValuePerLot: 10,
      minLots: 50,
      wholeLots: true
    })
    expect(profitLoss({ lots: 1, pips: -30, pipValueMinLot: 0.1, minLot: 0.01 })?.amount).toBe(-300)
    expect(profitLoss({ lots: 0.07, pips: 15, pipValueMinLot: 0.134, minLot: 0.01 })?.amount).toBeCloseTo(14.07, 8)
  })

  it('instrument własny z innym najmniejszym lotem', () => {
    const r = profitLoss({ lots: 0.3, pips: 40, pipValueMinLot: 0.5, minLot: 0.1 })
    expect(r?.amount).toBe(60)
    expect(r?.pipValuePerLot).toBe(5)
  })

  it('pozycja niebędąca wielokrotnością najmniejszego lota jest liczona, ale oznaczona', () => {
    const r = profitLoss({ lots: 0.015, pips: 10, pipValueMinLot: 0.1, minLot: 0.01 })
    expect(r?.amount).toBeCloseTo(1.5, 8)
    expect(r?.wholeLots).toBe(false)
  })

  it('brak wyniku dla niepoprawnych danych', () => {
    expect(profitLoss({ lots: 0, pips: 10, pipValueMinLot: 0.1, minLot: 0.01 })).toBeNull()
    expect(profitLoss({ lots: 1, pips: 10, pipValueMinLot: 0, minLot: 0.01 })).toBeNull()
    expect(profitLoss({ lots: 1, pips: Number.NaN, pipValueMinLot: 0.1, minLot: 0.01 })).toBeNull()
  })
})

describe('ręczna wartość pipsa', () => {
  it('zapisywana na 1 lot, pokazywana na najmniejszy lot – zmiana kroku lota nie zmienia znaczenia', () => {
    const perLot = pipValuePerLotFrom(0.01, 0.01) // WTI, broker with 100 barrels per lot
    expect(perLot).toBe(1)
    expect(pipValueForMinLot(perLot, 0.01)).toBe(0.01)
    expect(pipValueForMinLot(perLot, 0.1)).toBe(0.1)
    // The same position gives the same result whatever the smallest lot.
    const a = profitLoss({ lots: 1, pips: 30, pipValueMinLot: pipValueForMinLot(perLot, 0.01), minLot: 0.01 })
    const b = profitLoss({ lots: 1, pips: 30, pipValueMinLot: pipValueForMinLot(perLot, 0.1), minLot: 0.1 })
    expect(a?.amount).toBe(30)
    expect(b?.amount).toBe(30)
  })

  it('bez szumu zmiennoprzecinkowego (strzałki ↑/↓ dodają 0.01)', () => {
    expect(pipValuePerLotFrom(0.134 + 0.01, 0.01)).toBe(14.4)
    expect(pipValueForMinLot(14.4, 0.01)).toBe(0.144)
    expect(pipValuePerLotFrom(0.07, 0.01)).toBe(7)
  })
})

describe('liczba miejsc po przecinku', () => {
  it('nie ukrywa wpisanych cyfr', () => {
    expect(stepDecimals(0.01)).toBe(2)
    expect(stepDecimals(0.015)).toBe(3)
    expect(stepDecimals(0.1 + 0.2)).toBe(1)
    expect(stepDecimals(12)).toBe(0)
    expect(lotDecimals(0.01)).toBe(2)
    expect(lotDecimals(0.1)).toBe(2)
    expect(lotDecimals(0.001)).toBe(3)
    expect(shownDecimals(0.015, 2)).toBe(3)
    expect(shownDecimals(12.25, 1)).toBe(2)
    expect(shownDecimals(20, 1)).toBe(1)
    expect(shownDecimals(null, 2)).toBe(2)
  })
})

describe('ustawienia', () => {
  it('starszy journal.json bez nowych pól dostaje wartości domyślne', () => {
    const s = settingsSchema.parse({ risk: { accountCurrency: 'USD' } })
    expect(s.risk.pipValues).toEqual({})
    expect(s.risk.pipValuesPerLot).toEqual({})
    expect(s.risk.customInstrument).toEqual({ name: '', minLot: null })
  })

  it('wartości z 1.2.0 (na najmniejszy lot) są przeliczane na 1 lot przy wczytaniu', () => {
    const s = settingsSchema.parse({
      risk: { lotStep: 0.01, pipValues: { WTI: 0.01, EURGBP: 0.134, CUSTOM: 0.5 }, customInstrument: { name: 'US30', minLot: 0.1 } }
    })
    expect(s.risk.pipValues).toEqual({})
    expect(s.risk.pipValuesPerLot).toEqual({ WTI: 1, EURGBP: 13.4, CUSTOM: 5 })
    // Already converted values win; parsing again changes nothing.
    const again = settingsSchema.parse({ ...s, risk: { ...s.risk, pipValues: { WTI: 0.5 } } })
    expect(again.risk.pipValuesPerLot.WTI).toBe(1)
    expect(settingsSchema.parse(s).risk).toEqual(s.risk)
  })
})

describe('zmiana waluty konta', () => {
  it('kursy i ręczne wartości pipsa zostają przy swojej walucie konta', () => {
    const usd = settingsSchema.parse({ risk: { accountCurrency: 'USD', conversionRates: { GBP: 1.35 }, pipValuesPerLot: { WTI: 1 } } }).risk
    const pln = switchAccountCurrency(usd, 'PLN')
    expect(pln.accountCurrency).toBe('PLN')
    expect(pln.conversionRates).toEqual({})
    expect(pln.pipValuesPerLot).toEqual({})
    const plnWithRate = { ...pln, conversionRates: { USD: 3.65 } }
    const back = switchAccountCurrency(plnWithRate, 'USD')
    expect(back.conversionRates).toEqual({ GBP: 1.35 })
    expect(back.pipValuesPerLot).toEqual({ WTI: 1 })
    expect(back.byAccountCurrency).toEqual({ PLN: { conversionRates: { USD: 3.65 }, pipValuesPerLot: {} } })
    expect(switchAccountCurrency(back, 'USD')).toBe(back)
    expect(settingsSchema.parse({ risk: back }).risk).toEqual(back)
  })

  it('kwoty transakcji zapisane bez waluty należą do pierwszej waluty konta (zapamiętanej raz)', () => {
    const usd = settingsSchema.parse({ risk: { accountCurrency: 'USD' } }).risk
    expect(usd.legacyAmountCurrency).toBeNull()
    const pln = switchAccountCurrency(usd, 'PLN')
    expect(pln.legacyAmountCurrency).toBe('USD')
    expect(switchAccountCurrency(switchAccountCurrency(pln, 'EUR'), 'USD').legacyAmountCurrency).toBe('USD')
  })
})
