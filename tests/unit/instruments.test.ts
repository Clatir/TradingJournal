import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { simulateForecast } from '@shared/calc/forecast'
import { createForecast } from '@shared/defaults'
import { depositsByMonth, firstMonthParts, forecastInputFrom } from '@shared/forecast-input'
import {
  calculatedPipValue,
  findInstrument,
  instrumentIdFromName,
  instrumentPipValue,
  manualPipValue,
  missingPipValue,
  restoreDefaultInstruments,
  selectableInstruments
} from '@shared/instruments'
import { newId } from '@shared/ids'
import { presetInstruments, settingsSchema, type Forecast, type Instrument, type Settings } from '@shared/schema'

const NBP = { no: '192/A/NBP/2026', effectiveDate: '2026-10-02', fetchedAt: '2026-10-02T12:15:00.000Z', rates: { USD: 3.8881, EUR: 4.3745, GBP: 5.1353, AUD: 2.699 } }

const settingsWith = (risk: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): Settings => settingsSchema.parse({ risk, ...extra })
const inst = (s: Settings, id: string): Instrument => s.instruments.find((i) => i.id === id)!

describe('instrumenty: zasianie listy', () => {
  it('pusta lista (dziennik z 1.2.x) dostaje presety kalkulatora i instrument własny', () => {
    const s = settingsWith({ customInstrument: { name: 'US30', minLot: 0.1 }, pipValuesPerLot: { CUSTOM: 5, WTI: 1 } })
    expect(s.instruments.map((i) => i.id)).toEqual(['AUDUSD', 'EURGBP', 'EURUSD', 'EURAUD', 'WTI', 'CUSTOM'])
    expect(inst(s, 'EURGBP')).toMatchObject({ name: 'EURGBP', pipSize: 0.0001, contractSize: null, quoteCurrency: 'GBP', minLot: null, archived: false })
    expect(inst(s, 'EURAUD').quoteCurrency).toBe('AUD')
    expect(inst(s, 'AUDUSD').quoteCurrency).toBe('USD')
    expect(inst(s, 'WTI')).toMatchObject({ pipSize: 0.01, contractSize: 1000, quoteCurrency: 'USD' })
    expect(inst(s, 'WTI').description).toContain('1000 baryłek')
    expect(inst(s, 'CUSTOM')).toEqual({ id: 'CUSTOM', name: 'US30', pipSize: null, contractSize: null, quoteCurrency: null, minLot: 0.1, description: '', archived: false })
    // hand-entered pip values keep working under the same ids
    expect(instrumentPipValue(inst(s, 'CUSTOM'), s, 'USD')?.value).toBe(0.5)
    expect(instrumentPipValue(inst(s, 'WTI'), s, 'USD')?.value).toBe(0.01)
  })

  it('instrument własny bez nazwy nazywa się „Własny”; istniejąca lista zostaje bez zmian', () => {
    expect(inst(settingsWith(), 'CUSTOM')).toMatchObject({ name: 'Własny', minLot: null })
    const own: Instrument = { id: 'XAUUSD', name: 'Złoto', pipSize: 0.1, contractSize: 100, quoteCurrency: 'USD', minLot: null, description: '', archived: false }
    const s = settingsSchema.parse({ instruments: [own] })
    expect(s.instruments).toEqual([own])
    expect(settingsSchema.parse(s).instruments).toEqual([own])
  })

  it('schemat instrumentu odrzuca złe dane', () => {
    const ok = { id: 'US30', name: 'US30' }
    expect(settingsSchema.safeParse({ instruments: [ok] }).success).toBe(true)
    for (const bad of [{ ...ok, id: 'u' }, { ...ok, id: 'us30' }, { ...ok, id: 'X'.repeat(17) }, { ...ok, name: '' }, { ...ok, name: 'x'.repeat(25) }, { ...ok, pipSize: 0 }, { ...ok, quoteCurrency: 'usd' }, { ...ok, minLot: -1 }])
      expect(settingsSchema.safeParse({ instruments: [bad] }).success).toBe(false)
  })
})

describe('instrumenty: wartość pipsa najmniejszego lota', () => {
  it('wyliczona: pips × kontrakt × najmniejszy lot × kurs waluty instrumentu', () => {
    const usd = settingsWith({ accountCurrency: 'USD' })
    expect(instrumentPipValue(inst(usd, 'EURUSD'), usd, 'USD')).toEqual({ value: 0.1, base: 0.1, currency: 'USD', rate: 1, rateSource: 'same', source: 'calculated', minLot: 0.01 })
    expect(instrumentPipValue(inst(usd, 'WTI'), usd, 'USD')?.value).toBe(0.1)
    // PLN scenario, rate from the NBP table (0.10 USD × 3.8881)
    const withNbp = settingsWith({ accountCurrency: 'USD' }, { fx: { nbp: NBP } })
    expect(instrumentPipValue(inst(withNbp, 'EURUSD'), withNbp, 'PLN')).toEqual({ value: 0.38881, base: 0.1, currency: 'USD', rate: 3.8881, rateSource: 'nbp', source: 'calculated', minLot: 0.01 })
    // the instrument's own smallest lot and contract size
    const own: Instrument = { id: 'XAUUSD', name: 'Złoto', pipSize: 0.1, contractSize: 100, quoteCurrency: 'USD', minLot: 0.1, description: '', archived: false }
    expect(calculatedPipValue(own, usd, 'USD')?.value).toBe(1)
    // the account lot step and contract size are used when the instrument has none
    const fine = settingsWith({ accountCurrency: 'USD', lotStep: 0.001, contractSize: 10000 })
    expect(instrumentPipValue(inst(fine, 'EURUSD'), fine, 'USD')?.value).toBe(0.001)
  })

  it('ręczna (na 1 lot w walucie konta) ma pierwszeństwo i jest przeliczana na walutę docelową', () => {
    const s = settingsWith({ accountCurrency: 'USD', pipValuesPerLot: { WTI: 1 } }, { fx: { nbp: NBP } })
    expect(instrumentPipValue(inst(s, 'WTI'), s, 'USD')).toMatchObject({ value: 0.01, source: 'manual', currency: 'USD', rate: 1 })
    expect(manualPipValue(inst(s, 'WTI'), s, 'PLN')).toMatchObject({ value: 0.038881, base: 0.01, rate: 3.8881, rateSource: 'nbp' })
    expect(calculatedPipValue(inst(s, 'WTI'), s, 'USD')?.value).toBe(0.1)
  })

  it('brak kursu albo wartości pipsa: co trzeba wpisać', () => {
    const s = settingsWith({ accountCurrency: 'USD' })
    expect(instrumentPipValue(inst(s, 'EURGBP'), s, 'USD')).toBeNull()
    expect(missingPipValue(inst(s, 'EURGBP'), s, 'USD')).toEqual({ kind: 'rate', from: 'GBP', to: 'USD' })
    expect(missingPipValue(inst(s, 'EURUSD'), s, 'PLN')).toEqual({ kind: 'rate', from: 'USD', to: 'PLN' })
    expect(missingPipValue(inst(s, 'CUSTOM'), s, 'USD')).toEqual({ kind: 'pip' })
    const manual = settingsWith({ accountCurrency: 'USD', pipValuesPerLot: { CUSTOM: 5 } })
    expect(missingPipValue(inst(manual, 'CUSTOM'), manual, 'PLN')).toEqual({ kind: 'rate', from: 'USD', to: 'PLN' })
    expect(missingPipValue(inst(manual, 'CUSTOM'), manual, 'USD')).toBeNull()
    // a hand-entered GBP rate makes EURGBP work
    const rated = settingsWith({ accountCurrency: 'USD', conversionRates: { GBP: 1.35 } })
    expect(instrumentPipValue(inst(rated, 'EURGBP'), rated, 'USD')).toMatchObject({ value: 0.135, rateSource: 'manual' })
  })
})

describe('instrumenty: lista', () => {
  it('identyfikator z nazwy: wielkie litery i cyfry', () => {
    expect(instrumentIdFromName('us30')).toBe('US30')
    expect(instrumentIdFromName('Złoto XAU/USD')).toBe('ZLOTOXAUUSD')
    expect(instrumentIdFromName('DAX 40 (CFD) – mini kontrakt')).toBe('DAX40CFDMINIKONT')
    expect(instrumentIdFromName('—')).toBe('')
  })

  it('wybór: niezarchiwizowane, plus używany instrument zarchiwizowany albo usunięty', () => {
    const s = settingsWith()
    const archived = { ...s, instruments: s.instruments.map((i) => (i.id === 'WTI' ? { ...i, archived: true } : i)) }
    expect(selectableInstruments(archived).map((i) => i.id)).not.toContain('WTI')
    expect(selectableInstruments(archived, 'WTI').map((i) => i.id)).toContain('WTI')
    const removed = { ...s, instruments: s.instruments.filter((i) => i.id !== 'EURAUD') }
    expect(findInstrument(removed, 'EURAUD')?.quoteCurrency).toBe('AUD') // a preset still resolves
    expect(selectableInstruments(removed, 'EURAUD').map((i) => i.id)).toContain('EURAUD')
    expect(findInstrument(removed, 'NOPE')).toBeNull()
  })

  it('„Przywróć domyślne” dodaje brakujące presety i pokazuje zarchiwizowane', () => {
    const own: Instrument = { id: 'US30', name: 'US30', pipSize: null, contractSize: null, quoteCurrency: null, minLot: 0.1, description: '', archived: false }
    const list = [{ ...presetInstruments()[2]!, archived: true }, own]
    const restored = restoreDefaultInstruments(list)
    expect(restored.map((i) => i.id)).toEqual(['EURUSD', 'US30', 'AUDUSD', 'EURGBP', 'EURAUD', 'WTI'])
    expect(restored.every((i) => !i.archived)).toBe(true)
  })
})

describe('adapter scenariusz → wejście obliczeń', () => {
  const fixture = JSON.parse(readFileSync(resolve(__dirname, '../fixtures/forecast-vectors.json'), 'utf8')) as {
    tests: Record<string, { rows: Array<{ profit: number; payout: number; end: number }>; totals: { end: number; payout: number } }>
  }
  const settings = settingsWith({ accountCurrency: 'USD' }, { fx: { nbp: NBP } })
  const scenario = (over: Partial<Forecast> = {}): Forecast => ({
    ...createForecast({ accountCurrency: 'PLN', accountBalance: 10000 }, [], '2026-11-02T09:00:00.000Z'),
    payoutPercent: 10,
    monthlyDeposit: 2000,
    firstMonth: '2026-11',
    months: 50,
    keep: 'cash',
    goals: [
      { id: newId(), name: 'Cel 1', month: 6, amount: null, enabled: true, flexible: false },
      { id: newId(), name: 'Cel 2', month: 12, amount: null, enabled: true, flexible: false },
      { id: newId(), name: 'Cel 3', month: 19, amount: null, enabled: true, flexible: false }
    ],
    ...over
  })

  it('tryb procentowy: pola scenariusza pod nazwami wejścia (T1)', () => {
    const f = scenario({ pct: { mode: 'fixed', fixed: 11, lo: 7, hi: 10 }, deposits: { '3': 5000, '250': 1, '0': 1 } })
    const out = forecastInputFrom(f, settings)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.input).toMatchObject({ keep: 'cash', payout: 10, start: 10000, monthly: 2000, horizon: 50, m0: 10, y0: 2026, deposits: { 3: 5000 }, gain: 'pct' })
    expect(out.input.pips).toBeUndefined()
    expect(out.input.goals[0]).toEqual({ id: f.goals[0]!.id, name: 'Cel 1', month: 6, amount: null, on: true, flex: false })
    expect(out.input.loss).toEqual({ prob: 0, pctLo: 2, pctHi: 5, pipsLo: 50, pipsHi: 150 })
    expect(out.input.tax).toEqual({ on: false, rate: 19, payMonth: 4 })
    expect(out.input.draws.rate).toBe(f.draws.rate)
    const t1 = simulateForecast({ ...out.input, deposits: {} })
    expect(t1.totals.end).toBeCloseTo(fixture.tests.T1!.totals.end, 2)
  })

  it('tryb pipsowy: wartość pipsa przeliczona na walutę scenariusza (T7: EURUSD, 0.10 USD × 3.8881)', () => {
    const f = scenario({ gain: 'pips', pips: { ...scenario().pips, instrumentId: 'EURUSD', pips: 200, lot: 0.1 } })
    const out = forecastInputFrom(f, settings)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.input.pips).toMatchObject({ pipsMode: 'fixed', pips: 200, lotMode: 'fixed', lot: 0.1, riskPct: 1, slPips: 20, lotMax: null, pipValueMinLot: 0.38881, minLot: 0.01 })
    expect(out.pip).toMatchObject({ base: 0.1, currency: 'USD', rate: 3.8881, rateSource: 'nbp' })
    const r = simulateForecast(out.input)
    expect(r.rows[0]!.profit).toBeCloseTo(777.62, 6)
    expect(r.totals.end).toBeCloseTo(fixture.tests.T7!.totals.end, 2)
  })

  it('tryb pipsowy bez kursu, bez wartości pipsa albo bez instrumentu', () => {
    const noRate = settingsWith({ accountCurrency: 'USD' })
    const pips = (instrumentId: string) => scenario({ gain: 'pips', pips: { ...scenario().pips, instrumentId } })
    expect(forecastInputFrom(pips('EURUSD'), noRate)).toMatchObject({ ok: false, reason: 'rate', from: 'USD', to: 'PLN' })
    expect(forecastInputFrom(pips('CUSTOM'), noRate)).toMatchObject({ ok: false, reason: 'pip' })
    expect(forecastInputFrom(pips('NOPE'), noRate)).toEqual({ ok: false, reason: 'instrument', instrumentId: 'NOPE' })
    // a hand-entered USD → PLN rate (fx.manual, not the account currency)
    const manual = settingsWith({ accountCurrency: 'USD' }, { fx: { manual: { 'USD>PLN': 4 } } })
    const out = forecastInputFrom(pips('EURUSD'), manual)
    expect(out.ok && out.input.pips?.pipValueMinLot).toBe(0.4)
  })

  it('pomocnicze: pierwszy miesiąc i wpłaty', () => {
    expect(firstMonthParts('2027-01')).toEqual({ m0: 0, y0: 2027 })
    expect(firstMonthParts('2026-12')).toEqual({ m0: 11, y0: 2026 })
    expect(depositsByMonth({ '1': 100, '240': -5, '241': 1, '0': 2, '12': 0 })).toEqual({ 1: 100, 240: -5, 12: 0 })
  })
})
