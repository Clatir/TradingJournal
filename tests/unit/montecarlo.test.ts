import { describe, expect, it } from 'vitest'
import { simulateForecast, type ForecastInput } from '@shared/calc/forecast'
import { hasRandomness, runMonteCarlo, startMonteCarlo, summarizeMonteCarlo } from '@shared/calc/montecarlo'

const base: ForecastInput = {
  keep: 'cash',
  payout: 10,
  start: 10000,
  monthly: 2000,
  horizon: 50,
  m0: 10,
  y0: 2026,
  deposits: {},
  goals: [
    { id: 'a', name: 'Cel 1', month: 6, amount: 2000, on: true, flex: false },
    { id: 'b', name: 'Cel 2', month: 12, amount: null, on: true, flex: false },
    { id: 'c', name: 'Poza', month: 60, amount: null, on: true, flex: false }
  ],
  gain: 'pct',
  pct: { mode: 'random', fixed: 11, lo: 7, hi: 10 },
  loss: { prob: 0, pctLo: 2, pctHi: 5, pipsLo: 50, pipsHi: 150 },
  tax: { on: false, rate: 19, payMonth: 4 },
  draws: { rate: [], loss: [], lossSize: [], pips: [] }
}

describe('rozrzut wyników', () => {
  it('losowość: zwrot losowy, pipsy losowe albo miesiące stratne', () => {
    expect(hasRandomness(base)).toBe(true)
    expect(hasRandomness({ ...base, pct: { ...base.pct, mode: 'fixed' } })).toBe(false)
    expect(hasRandomness({ ...base, pct: { ...base.pct, mode: 'fixed' }, loss: { ...base.loss, prob: 10 } })).toBe(true)
    const pips = { pipsMode: 'fixed' as const, pips: 200, pipsLo: 100, pipsHi: 300, lotMode: 'fixed' as const, lot: 0.1, lotPer: 0.01, lotPerAmount: 1000, riskPct: 1, slPips: 20, lotMax: null, pipValueMinLot: 0.1, minLot: 0.01 }
    expect(hasRandomness({ ...base, gain: 'pips', pips })).toBe(false)
    expect(hasRandomness({ ...base, gain: 'pips', pips: { ...pips, pipsMode: 'random' } })).toBe(true)
  })

  it('percentyle przebiegów, cele, miesiące; liczone w kawałkach', () => {
    const state = startMonteCarlo(base)
    runMonteCarlo(state, 150)
    runMonteCarlo(state, 50)
    const s = summarizeMonteCarlo(state)
    expect(s.runs).toBe(200)
    expect(s.end.p5).toBeLessThanOrEqual(s.end.p50)
    expect(s.end.p50).toBeLessThanOrEqual(s.end.p95)
    // 7–10% a month: between the fixed 7% and the fixed 10% runs
    const at = (fixed: number) => simulateForecast({ ...base, pct: { ...base.pct, mode: 'fixed', fixed } }).totals.end
    expect(s.end.p5).toBeGreaterThan(at(7))
    expect(s.end.p95).toBeLessThan(at(10))
    expect(s.monthly).toHaveLength(50)
    expect(s.monthly[49]).toEqual({ k: 50, ...s.end })
    expect(s.belowPaidInPct).toBe(0)
    expect(s.goals.map((g) => g.id)).toEqual(['a', 'b']) // the goal outside the table is not in the queue
    expect(s.goals[0]).toMatchObject({ name: 'Cel 1', boughtPct: 100 })
    expect(s.goals[0]!.typicalMonth).toBeGreaterThanOrEqual(6)
    expect(s.goals[0]!.monthRange![0]).toBeLessThanOrEqual(s.goals[0]!.monthRange![1])
    expect(s.goals[1]).toMatchObject({ boughtPct: 100, typicalMonth: 12, monthRange: [12, 12] })
  })

  it('deterministyczne losowania: percentyl v[round(q × (R − 1))]; strata poniżej wpłat', () => {
    // draws 0, 0.25, 0.5, 0.75 … per run: run i uses the constant u_i in every month
    const us = [0, 0.25, 0.5, 0.75, 0.999]
    let call = 0
    const draw = (n: number) => {
      const u = us[Math.floor(call / 4)]!
      call++
      return Array.from({ length: n }, () => u)
    }
    const losing = { ...base, goals: [], pct: { mode: 'random' as const, fixed: 0, lo: -10, hi: 10 } }
    const state = runMonteCarlo(startMonteCarlo(losing), 5, draw)
    const s = summarizeMonteCarlo(state)
    const end = (u: number) => simulateForecast({ ...losing, draws: { rate: Array(50).fill(u), loss: [], lossSize: [], pips: [] } }).totals.end
    expect(s.end.p5).toBe(end(0)) // round(0.05 × 4) = 0
    expect(s.end.p50).toBe(end(0.5)) // round(2) = 2
    expect(s.end.p95).toBe(end(0.999)) // round(3.8) = 4
    expect(s.belowPaidInPct).toBe(40) // −10% and −5% a month lose money
  })

})
