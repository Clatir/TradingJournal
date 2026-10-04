import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { percentile, simulateForecast, type ForecastInput, type ForecastPipsInput, type ForecastResult } from '@shared/calc/forecast'
import { completedDraws, createForecast, firstFreeName } from '@shared/defaults'
import { drawUniforms } from '@shared/random'
import { generateSample } from '@shared/sample/generate'
import { FORECAST_MAX_GOALS, FORECAST_MAX_MONTHS, forecastGoalSchema, forecastSchema } from '@shared/schema'

// ---------------------------------------------------------------- reference vectors

interface VectorGoal {
  name: string
  month: number | null
  amount: number | null
  on?: boolean
  flex?: boolean
}
type VectorScenario = Omit<ForecastInput, 'deposits' | 'goals' | 'gain' | 'pct' | 'pips' | 'loss' | 'tax' | 'draws'> & {
  deposits?: Record<string, number>
  goals?: VectorGoal[]
  gain?: ForecastInput['gain']
  pct?: ForecastInput['pct']
  pips?: Partial<ForecastPipsInput> & Pick<ForecastPipsInput, 'pips' | 'lot' | 'pipValueMinLot' | 'minLot'>
  loss?: Partial<ForecastInput['loss']>
  tax?: Partial<ForecastInput['tax']>
  draws?: Partial<ForecastInput['draws']>
}
interface VectorRow {
  k: number
  label: string
  ratePct: number
  deposit: number
  tax: number
  start: number
  profit: number
  payout: number
  pot: number
  buys: Array<{ name: string; amount: number }>
  end: number
  loss: boolean
  head: string | null
  lot?: number
  pips?: number
}
type VectorGoalResult =
  | { month: number; planned: number; amount: number; whole: boolean; empty: boolean; after: string | null }
  | { pending: true; have: number }
  | { blockedBy: string }
interface VectorTest {
  source: string
  description?: string
  scenario: VectorScenario
  rows: VectorRow[]
  goals: Record<string, VectorGoalResult>
  totals: Record<string, number>
}

const fixture = JSON.parse(readFileSync(resolve(__dirname, '../fixtures/forecast-vectors.json'), 'utf8')) as {
  tests: Record<string, VectorTest>
}

/** The three alignments of chapter 5: numeric deposit keys, defaults for missing keys, goal name = id. */
function inputFrom(sc: VectorScenario): ForecastInput {
  return {
    keep: sc.keep,
    payout: sc.payout,
    start: sc.start,
    monthly: sc.monthly,
    horizon: sc.horizon,
    m0: sc.m0,
    y0: sc.y0,
    deposits: Object.fromEntries(Object.entries(sc.deposits ?? {}).map(([k, v]) => [Number(k), v])),
    goals: (sc.goals ?? []).map((g) => ({ id: g.name, name: g.name, month: g.month, amount: g.amount, on: g.on ?? true, flex: g.flex ?? false })),
    gain: sc.gain ?? 'pct',
    pct: { mode: 'fixed', fixed: 11, lo: 7, hi: 10, ...sc.pct },
    pips: sc.pips && {
      pipsMode: 'fixed',
      pipsLo: 100,
      pipsHi: 300,
      lotMode: 'fixed',
      lotPer: 0.01,
      lotPerAmount: 1000,
      riskPct: 1,
      slPips: 20,
      lotMax: null,
      ...sc.pips
    },
    loss: { prob: 0, pctLo: 2, pctHi: 5, pipsLo: 50, pipsHi: 150, ...sc.loss },
    tax: { on: false, rate: 19, payMonth: 4, ...sc.tax },
    draws: { rate: [], loss: [], lossSize: [], pips: [], ...sc.draws }
  }
}

const MONEY = 0.005 + 1e-9
const FINE = 0.00005 + 1e-9

/** Every difference from the vector, so a failing test shows all of them at once. */
function differences(t: VectorTest, result: ForecastResult, cash: ForecastResult | null): string[] {
  const out: string[] = []
  const near = (path: string, actual: number | null | undefined, expected: number, tol = MONEY) => {
    if (typeof actual !== 'number' || !(Math.abs(actual - expected) <= tol)) out.push(`${path}: ${actual} ≠ ${expected}`)
  }
  const same = (path: string, actual: unknown, expected: unknown) => {
    if (actual !== expected) out.push(`${path}: ${JSON.stringify(actual)} ≠ ${JSON.stringify(expected)}`)
  }

  same('rows.length', result.rows.length, t.rows.length)
  t.rows.forEach((e, i) => {
    const a = result.rows[i]
    if (!a) return
    const at = `rows[${e.k}]`
    same(`${at}.k`, a.k, e.k)
    same(`${at}.label`, a.label, e.label)
    near(`${at}.ratePct`, a.rate * 100, e.ratePct)
    near(`${at}.deposit`, a.deposit, e.deposit)
    near(`${at}.tax`, a.tax, e.tax)
    near(`${at}.start`, a.start, e.start)
    near(`${at}.profit`, a.profit, e.profit)
    near(`${at}.payout`, a.payout, e.payout)
    near(`${at}.pot`, a.pot, e.pot)
    near(`${at}.end`, a.end, e.end)
    same(`${at}.loss`, a.loss, e.loss)
    same(`${at}.head`, a.head, e.head)
    same(`${at}.buys.length`, a.buys.length, e.buys.length)
    e.buys.forEach((b, j) => {
      same(`${at}.buys[${j}].name`, a.buys[j]?.name, b.name)
      same(`${at}.buys[${j}].goalId`, a.buys[j]?.goalId, b.name)
      near(`${at}.buys[${j}].amount`, a.buys[j]?.amount, b.amount)
    })
    if (e.lot !== undefined) near(`${at}.lot`, a.lot, e.lot, FINE)
    else same(`${at}.lot`, a.lot, null)
    if (e.pips !== undefined) near(`${at}.pips`, a.pips, e.pips, FINE)
    else same(`${at}.pips`, a.pips, null)
  })

  same('goals', Object.keys(result.goals).sort().join(','), Object.keys(t.goals).sort().join(','))
  for (const [name, e] of Object.entries(t.goals)) {
    const a = result.goals[name]
    const at = `goals[${name}]`
    if (!a) continue
    if ('blockedBy' in e) same(`${at}.blockedBy`, 'blockedBy' in a ? a.blockedBy : undefined, e.blockedBy)
    else if ('pending' in e) {
      same(`${at}.pending`, 'pending' in a ? a.pending : undefined, true)
      near(`${at}.have`, 'have' in a ? a.have : undefined, e.have)
    } else {
      if (!('month' in a)) {
        out.push(`${at}: not bought, expected a purchase in month ${e.month}`)
        continue
      }
      same(`${at}.month`, a.month, e.month)
      same(`${at}.planned`, a.planned, e.planned)
      near(`${at}.amount`, a.amount, e.amount)
      same(`${at}.whole`, a.whole, e.whole)
      same(`${at}.empty`, a.empty, e.empty)
      same(`${at}.after`, a.after, e.after)
    }
  }

  for (const [key, e] of Object.entries(t.totals)) {
    const at = `totals.${key}`
    if (key === 'lossMonths') same(at, result.totals.lossMonths, e)
    else if (key === 'meanRatePct') near(at, result.totals.meanRate * 100, e)
    else if (key === 'fundGain') near(at, cash ? result.totals.profit - cash.totals.profit : undefined, e)
    else if (key in result.totals) near(at, result.totals[key as keyof ForecastResult['totals']], e)
    else out.push(`${at}: missing in the result`)
  }
  if (t.scenario.keep === 'fund' && !('fundGain' in t.totals)) out.push('totals.fundGain: missing in the vector')
  return out
}

describe('prognoza wypłat – wartości wzorcowe', () => {
  const names = Object.keys(fixture.tests)

  it('plik wektorów ma T1–T10 i E1–E20', () => {
    const expected = [...Array.from({ length: 10 }, (_, i) => `T${i + 1}`), ...Array.from({ length: 20 }, (_, i) => `E${i + 1}`)]
    expect(names).toEqual(expected)
  })

  it.each(names)('%s', (name) => {
    const t = fixture.tests[name]!
    const input = inputFrom(t.scenario)
    const result = simulateForecast(input)
    const cash = input.keep === 'fund' ? simulateForecast({ ...input, keep: 'cash' }) : null
    expect(differences(t, result, cash)).toEqual([])
  })

  it('punkty kontrolne z rozdz. 18 (T1, T2, T7)', () => {
    const t1 = simulateForecast(inputFrom(fixture.tests.T1!.scenario))
    expect(t1.rows[0]!.profit).toBeCloseTo(1100, 6)
    expect(t1.rows[0]!.payout).toBeCloseTo(110, 6)
    expect(t1.rows[0]!.end).toBeCloseTo(10990, 6)
    expect(t1.rows[1]!.start).toBeCloseTo(12990, 6)
    expect(t1.rows[1]!.profit).toBeCloseTo(1428.9, 6)
    expect(t1.rows[0]!.label).toBe('11-2026')
    expect(t1.rows[2]!.label).toBe('1-2027')
    const t2 = simulateForecast(inputFrom(fixture.tests.T2!.scenario))
    expect(t2.rows[0]!.end).toBeCloseTo(11100, 6)
    expect(t2.rows[1]!.profit).toBeCloseTo(1441, 6)
    const t7 = simulateForecast(inputFrom(fixture.tests.T7!.scenario))
    for (const row of t7.rows) expect(row.profit).toBeCloseTo(777.62, 6)
  })

  it('nie zmienia wejścia', () => {
    const input = inputFrom(fixture.tests.E10!.scenario)
    const copy = structuredClone(input)
    simulateForecast(input)
    expect(input).toEqual(copy)
  })

  it('brak liczby w losowaniach: miesiąc nie jest stratny, pozostałe tablice liczą się jako 0', () => {
    const input = inputFrom(fixture.tests.E8!.scenario)
    const result = simulateForecast({ ...input, draws: { rate: [], loss: [], lossSize: [], pips: [] } })
    expect(result.totals.lossMonths).toBe(0)
    for (const row of result.rows) expect(row.rate).toBeCloseTo(0.07, 12) // lo of 7–10% with draw 0
  })

  it('240 miesięcy liczy się poniżej 50 ms', () => {
    const base = inputFrom(fixture.tests.E10!.scenario)
    const draws = { rate: drawUniforms(240), loss: drawUniforms(240), lossSize: drawUniforms(240), pips: drawUniforms(240) }
    const pct: ForecastInput = { ...base, horizon: 240, draws }
    const pips: ForecastInput = { ...inputFrom(fixture.tests.E9!.scenario), horizon: 240, draws, tax: { on: true, rate: 19, payMonth: 4 } }
    const t0 = performance.now()
    const a = simulateForecast(pct)
    const t1 = performance.now()
    const b = simulateForecast(pips)
    const t2 = performance.now()
    expect(a.rows).toHaveLength(240)
    expect(b.rows).toHaveLength(240)
    expect(t1 - t0).toBeLessThan(50)
    expect(t2 - t1).toBeLessThan(50)
  })
})

// ---------------------------------------------------------------- percentile

describe('percentyl', () => {
  it('v[round(q × (R − 1))] z tablicy posortowanej rosnąco', () => {
    const v = [1, 2, 3, 4, 5]
    expect(percentile(v, 0)).toBe(1)
    expect(percentile(v, 0.5)).toBe(3)
    expect(percentile(v, 1)).toBe(5)
    expect(percentile(v, 0.05)).toBe(1) // round(0.2) = 0
    expect(percentile(v, 0.95)).toBe(5) // round(3.8) = 4
    const thousand = Array.from({ length: 1000 }, (_, i) => i * 10)
    expect(percentile(thousand, 0.05)).toBe(500) // round(49.95) = 50
    expect(percentile(thousand, 0.5)).toBe(5000) // round(499.5) = 500
    expect(percentile(thousand, 0.95)).toBe(9490) // round(949.05) = 949
    expect(percentile([42], 0.95)).toBe(42)
    expect(percentile([], 0.5)).toBeNaN()
  })
})

// ---------------------------------------------------------------- random numbers

describe('drawUniforms', () => {
  it('liczby z przedziału [0, 1), także powyżej limitu jednego wywołania getRandomValues', () => {
    expect(drawUniforms(0)).toEqual([])
    const v = drawUniforms(20000) // 40000 words: three chunks
    expect(v).toHaveLength(20000)
    expect(v.every((x) => x >= 0 && x < 1)).toBe(true)
    expect(new Set(v).size).toBeGreaterThan(19990)
    const mean = v.reduce((s, x) => s + x, 0) / v.length
    expect(mean).toBeGreaterThan(0.45)
    expect(mean).toBeLessThan(0.55)
    // the last chunk is filled too (an unfilled one would leave zeros)
    expect(v.slice(-100).some((x) => x > 0)).toBe(true)
  })
})

// ---------------------------------------------------------------- schema

const NOW = '2026-11-15T10:00:00.000Z'
const minimal = {
  schemaVersion: 1,
  id: '01JAAAAAAAAAAAAAAAAAAAAAAA',
  createdAt: NOW,
  updatedAt: NOW,
  name: 'Scenariusz 1',
  currency: 'PLN',
  firstMonth: '2026-11'
}
const goalId = '01JBBBBBBBBBBBBBBBBBBBBBBB'

describe('schemat scenariusza', () => {
  it('wartości domyślne', () => {
    const f = forecastSchema.parse(minimal)
    expect(f).toMatchObject({
      payoutPercent: 50,
      gain: 'pct',
      pct: { mode: 'random', fixed: 11, lo: 7, hi: 10 },
      pips: {
        instrumentId: 'EURUSD',
        pipsMode: 'fixed',
        pips: 200,
        pipsLo: 100,
        pipsHi: 300,
        lotMode: 'fixed',
        lot: 0.1,
        lotPer: 0.01,
        lotPerAmount: 1000,
        riskPercent: 1,
        stopPips: 20,
        lotMax: null
      },
      loss: { probability: 0, pctLo: 2, pctHi: 5, pipsLo: 50, pipsHi: 150 },
      startCapital: 10000,
      monthlyDeposit: 0,
      months: 50,
      deposits: {},
      keep: 'fund',
      goals: [],
      tax: { enabled: false, ratePercent: 19, payMonth: 4 },
      draws: { rate: [], loss: [], lossSize: [], pips: [] },
      monteCarloRuns: 1000,
      notes: ''
    })
    expect(forecastGoalSchema.parse({ id: goalId })).toEqual({ id: goalId, name: '', month: null, amount: null, enabled: true, flexible: false })
  })

  it('zachowuje nieznane pola (także w obiektach zagnieżdżonych i celach)', () => {
    const f = forecastSchema.parse({ ...minimal, future: 1, pct: { extra: 'x' }, goals: [{ id: goalId, color: 'red' }] })
    expect(f).toMatchObject({ future: 1, pct: { extra: 'x', mode: 'random' }, goals: [{ color: 'red', enabled: true }] })
  })

  it('przyjmuje wartości graniczne', () => {
    const ok = {
      ...minimal,
      months: FORECAST_MAX_MONTHS,
      payoutPercent: 100,
      pct: { fixed: -100, lo: 100, hi: -100 },
      deposits: { '1': -1e12, '240': 1e12 },
      goals: Array.from({ length: FORECAST_MAX_GOALS }, (_, i) => ({ id: goalId, month: i + 1, amount: 1e12 })),
      draws: { rate: Array.from({ length: 240 }, () => 0.9999999), loss: [0] },
      monteCarloRuns: 10000,
      tax: { payMonth: 12 }
    }
    expect(forecastSchema.safeParse(ok).success).toBe(true)
  })

  it.each([
    ['brak nazwy', { name: '' }],
    ['nazwa dłuższa niż 60 znaków', { name: 'x'.repeat(61) }],
    ['waluta małymi literami', { currency: 'pln' }],
    ['waluta z 4 liter', { currency: 'PLNX' }],
    ['miesiąc 13', { firstMonth: '2026-13' }],
    ['miesiąc bez zera', { firstMonth: '2026-1' }],
    ['brak pierwszego miesiąca', { firstMonth: undefined }],
    ['0 miesięcy', { months: 0 }],
    ['241 miesięcy', { months: 241 }],
    ['miesiące ułamkowe', { months: 1.5 }],
    ['wypłata ponad 100%', { payoutPercent: 101 }],
    ['wypłata ujemna', { payoutPercent: -1 }],
    ['nieznany tryb zysku', { gain: 'abc' }],
    ['zwrot ponad 100%', { pct: { fixed: 101 } }],
    ['zwrot poniżej −100%', { pct: { lo: -101 } }],
    ['lot 0', { pips: { lot: 0 } }],
    ['ryzyko ponad 100%', { pips: { riskPercent: 101 } }],
    ['maks. lot 0', { pips: { lotMax: 0 } }],
    ['szansa na stratę ponad 100%', { loss: { probability: 101 } }],
    ['ujemna strata w pipsach', { loss: { pipsLo: -1 } }],
    ['ujemny kapitał', { startCapital: -1 }],
    ['ujemna dopłata', { monthlyDeposit: -1 }],
    ['wpłata pod kluczem tekstowym', { deposits: { abc: 1 } }],
    ['wpłata pod kluczem 4-cyfrowym', { deposits: { '1234': 1 } }],
    ['wpłata ponad 1e12', { deposits: { '1': 2e12 } }],
    ['nieznany tryb odkładania', { keep: 'bank' }],
    ['11 celów', { goals: Array.from({ length: 11 }, () => ({ id: goalId })) }],
    ['cel bez id', { goals: [{ name: 'Cel 1' }] }],
    ['cel z kwotą 0', { goals: [{ id: goalId, amount: 0 }] }],
    ['cel z miesiącem 241', { goals: [{ id: goalId, month: 241 }] }],
    ['cel z nazwą ponad 40 znaków', { goals: [{ id: goalId, name: 'x'.repeat(41) }] }],
    ['podatek płatny w 13. miesiącu', { tax: { payMonth: 13 } }],
    ['stawka podatku ponad 100%', { tax: { ratePercent: 101 } }],
    ['losowanie równe 1', { draws: { rate: [1] } }],
    ['losowanie ujemne', { draws: { loss: [-0.1] } }],
    ['241 losowań', { draws: { pips: Array.from({ length: 241 }, () => 0.5) } }],
    ['99 przebiegów', { monteCarloRuns: 99 }],
    ['10001 przebiegów', { monteCarloRuns: 10001 }]
  ])('odrzuca: %s', (_label, patch) => {
    expect(forecastSchema.safeParse({ ...minimal, ...patch }).success).toBe(false)
  })
})

// ---------------------------------------------------------------- new scenario

describe('createForecast', () => {
  const risk = { accountCurrency: 'PLN', accountBalance: 25000 }

  it('nazwa „Scenariusz N” z pierwszą wolną liczbą', () => {
    expect(firstFreeName('Scenariusz', [])).toBe('Scenariusz 1')
    expect(firstFreeName('Scenariusz', ['Scenariusz 1', 'Scenariusz 2'])).toBe('Scenariusz 3')
    expect(firstFreeName('Scenariusz', ['Scenariusz 1', 'Scenariusz 3', 'Inny'])).toBe('Scenariusz 2')
    expect(createForecast(risk, ['Scenariusz 1']).name).toBe('Scenariusz 2')
  })

  it('waluta konta, kapitał z salda konta (albo 10000), bieżący miesiąc, poprawny rekord', () => {
    const f = createForecast(risk, [], NOW)
    expect(f.currency).toBe('PLN')
    expect(f.startCapital).toBe(25000)
    const d = new Date(NOW)
    expect(f.firstMonth).toBe(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    expect(f.createdAt).toBe(NOW)
    expect(f.updatedAt).toBe(NOW)
    expect(f.schemaVersion).toBe(1)
    expect(forecastSchema.parse(f)).toEqual(f)
    expect(createForecast({ accountCurrency: 'USD', accountBalance: null }, []).startCapital).toBe(10000)
    expect(createForecast({ accountCurrency: 'USD', accountBalance: 0 }, []).startCapital).toBe(0)
    // schema defaults for everything else
    expect(f).toMatchObject({ payoutPercent: 50, gain: 'pct', months: 50, keep: 'fund', goals: [], monteCarloRuns: 1000 })
  })

  it('4 × 240 świeżych losowań, inne w każdym nowym scenariuszu', () => {
    const a = createForecast(risk, [])
    const b = createForecast(risk, [])
    for (const key of ['rate', 'loss', 'lossSize', 'pips'] as const) {
      expect(a.draws[key]).toHaveLength(240)
      expect(a.draws[key].every((x) => x >= 0 && x < 1)).toBe(true)
      expect(a.draws[key]).not.toEqual(b.draws[key])
    }
    expect(a.id).not.toBe(b.id)
  })
})

describe('losowania scenariusza', () => {
  it('krótsze tablice (plik edytowany ręcznie) są uzupełniane do 240 liczb, istniejące zostają', () => {
    const f = createForecast({ accountCurrency: 'PLN', accountBalance: null }, [])
    expect(completedDraws(f.draws)).toBeNull()
    const short = { ...f.draws, rate: f.draws.rate.slice(0, 10), pips: [] }
    const done = completedDraws(short)!
    expect(done.rate).toHaveLength(240)
    expect(done.rate.slice(0, 10)).toEqual(f.draws.rate.slice(0, 10))
    expect(done.pips).toHaveLength(240)
    expect(done.loss).toBe(f.draws.loss)
    expect(done.rate.every((x) => x >= 0 && x < 1)).toBe(true)
  })
})

describe('scenariusz w danych przykładowych', () => {
  it('neutralne nazwy, stałe deterministyczne losowania, poprawny rekord', () => {
    const a = generateSample({ seed: 1234, endDate: '2026-09-30', now: '2026-10-01T10:00:00.000Z' })
    const b = generateSample({ seed: 1234, endDate: '2026-09-30', now: '2026-10-01T10:00:00.000Z' })
    expect(a.forecasts).toHaveLength(1)
    const f = a.forecasts[0]!
    expect(forecastSchema.parse(f)).toEqual(f)
    expect(f).toMatchObject({ name: 'Scenariusz 1', currency: 'USD', firstMonth: '2026-10', months: 36, keep: 'fund' })
    expect(f.goals.map((g) => g.name)).toEqual(['Cel 1', 'Cel 2', 'Cel 3'])
    expect(f.draws.rate).toHaveLength(240)
    expect(f.draws).toEqual(b.forecasts[0]!.draws)
    expect(generateSample({ seed: 99, endDate: '2026-09-30' }).forecasts[0]!.draws.rate).not.toEqual(f.draws.rate)
  })
})
