import { describe, expect, it } from 'vitest'
import { PNL_PRESETS, presetPipValue, profitLoss, type PnlPresetId } from '@shared/calc/pnl'
import { settingsSchema } from '@shared/schema'

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

describe('ustawienia', () => {
  it('starszy journal.json bez nowych pól dostaje wartości domyślne', () => {
    const s = settingsSchema.parse({ risk: { accountCurrency: 'USD' } })
    expect(s.risk.pipValues).toEqual({})
    expect(s.risk.customInstrument).toEqual({ name: '', minLot: null })
  })
})
