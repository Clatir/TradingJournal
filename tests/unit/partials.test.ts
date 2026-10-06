import { describe, expect, it } from 'vitest'
import { partialPercents, partialPlan, type PartialPlanInput, type PartialSpec } from '@shared/calc/partials'

/** EURUSD on a USD account: 0.10 USD per pip for 0.01 lot = 10 USD per pip for 1 lot. */
const base = (parts: PartialSpec[], over: Partial<PartialPlanInput> = {}): PartialPlanInput => ({
  lots: 1,
  lotStep: 0.01,
  minLot: 0.01,
  pipValueMinLot: 0.1,
  stopPips: 20,
  nowPips: 30,
  breakevenAfterFirst: false,
  parts,
  ...over
})
const now = (percent: number | null): PartialSpec => ({ mode: 'now', percent, targetPips: null })
const target = (percent: number | null, targetPips: number | null): PartialSpec => ({ mode: 'target', percent, targetPips })

function plan(i: PartialPlanInput) {
  const out = partialPlan(i)
  if (!out.ok) throw new Error(out.error)
  return out.plan
}

describe('partiale: zamknąć całość teraz czy podzielić', () => {
  it('połowa teraz, połowa na celu: wynik każdej części, najlepszy i najgorszy przypadek', () => {
    const p = plan(base([now(50), target(null, 60)]))
    expect(p.riskAmount).toBeCloseTo(200, 9) // 20 pips × 10 USD × 1 lot = 1R
    expect(p.closeNow).toEqual({ pips: 30, amount: 300, r: 1.5 })
    expect(p.rows.map((r) => [r.n, r.mode, r.lots, r.pips, r.amount])).toEqual([
      [1, 'now', 0.5, 30, 150],
      [2, 'target', 0.5, 60, 300]
    ])
    // Back to the stop before the target: 150 locked − 0.5 lota × 20 pips × 10 USD.
    expect(p.worst).toMatchObject({ reached: 0, restPips: -20, amount: 50, r: 0.25, vsNow: -250 })
    expect(p.best).toMatchObject({ reached: 1, restPips: null, amount: 450, r: 2.25, vsNow: 150 })
    expect(p.beatsNowAfter).toBe(1)
  })

  it('SL na BE po pierwszym partialu w zysku: reszta wraca na 0 pips', () => {
    const p = plan(base([now(50), target(null, 60)], { breakevenAfterFirst: true }))
    expect(p.worst).toMatchObject({ restPips: 0, amount: 150, vsNow: -150 })
    // In a loss now there is no break-even for the rest until the first target is reached.
    const losing = plan(base([now(50), target(null, 10)], { breakevenAfterFirst: true, nowPips: -5 }))
    expect(losing.worst).toMatchObject({ restPips: -20, amount: -25 - 100 })
    expect(losing.best).toMatchObject({ amount: -25 + 50 })
  })

  it('cztery części: cele w kolejności odległości, każdy scenariusz po osiągnięciu kolejnego celu', () => {
    const p = plan(base([target(25, 80), now(25), target(25, 40), target(null, 120)], { lots: 0.4 }))
    expect(p.rows.map((r) => r.lots)).toEqual([0.1, 0.1, 0.1, 0.1])
    // locked now: 0.1 × 30 × 10 = 30; targets 40 / 80 / 120 → 40 / 80 / 120; at the stop −20 each.
    expect(p.scenarios.map((s) => [s.reached, s.amount])).toEqual([
      [0, 30 - 60],
      [1, 30 + 40 - 40],
      [2, 30 + 40 + 80 - 20],
      [3, 30 + 40 + 80 + 120]
    ])
    expect(p.closeNow.amount).toBeCloseTo(120, 9)
    expect(p.beatsNowAfter).toBe(2) // 130 ≥ 120
  })

  it('loty zaokrąglane w dół do kroku, reszta w ostatniej części', () => {
    expect(partialPercents([now(25), now(25), now(25), now(80)])).toEqual([25, 25, 25, 25])
    const p = plan(base([now(25), target(25, 40), target(25, 80), target(null, 120)], { lots: 0.1 }))
    expect(p.rows.map((r) => r.lots)).toEqual([0.02, 0.02, 0.02, 0.04])
    expect(p.rows.map((r) => r.percent)).toEqual([20, 20, 20, 40])
  })

  it('wszystko teraz = zamknięcie całości (jeden scenariusz)', () => {
    const p = plan(base([now(60), now(null)]))
    expect(p.scenarios).toHaveLength(1)
    expect(p.best.amount).toBeCloseTo(300, 9)
    expect(p.best.vsNow).toBeCloseTo(0, 9)
    expect(p.beatsNowAfter).toBe(0)
  })

  it('ile celów trzeba osiągnąć, żeby plan dał więcej niż zamknięcie teraz', () => {
    // Targets just above the current +30: at the stop before them the plan loses, both reached = +315 > +300.
    const p = plan(base([target(50, 31), target(null, 32)]))
    expect(p.scenarios.map((s) => s.amount)).toEqual([-200, 155 - 100, 155 + 160])
    expect(p.beatsNowAfter).toBe(2)
  })

  it('błędy: suma części, cel nie dalej niż teraz, za mała pozycja, wynik za stopem, brak danych', () => {
    const err = (i: PartialPlanInput) => {
      const out = partialPlan(i)
      return out.ok ? null : out.error
    }
    expect(err(base([now(60), now(40), now(null)]))).toBe('Części 1–2 zabierają 100% pozycji – na ostatnią nic nie zostaje.')
    expect(err(base([now(0), now(null)]))).toBe('Wpisz udział części 1 (więcej niż 0%).')
    expect(err(base([now(50), target(null, 30)]))).toBe('Cel części 2 (30 pips) nie jest dalej niż obecny wynik (30 pips) – wybierz „teraz”.')
    expect(err(base([now(50), target(null, null)]))).toBe('Wpisz cel części 2 w pipsach.')
    expect(err(base([now(50), now(null)], { lots: 0.01 }))).toBe('Pozycja 0.01 lota jest za mała na taki podział: część 1 wychodzi poniżej kroku lota 0.01.')
    expect(err(base([now(null)], { nowPips: -20 }))).toBe('Obecny wynik jest na stop lossie albo za nim – pozycja byłaby już zamknięta.')
    expect(err(base([now(null)], { stopPips: 0 }))).toBe('Wpisz stop loss w pipsach (większy od zera).')
    expect(err(base([now(null)], { lots: 0 }))).toBe('Wpisz wielkość pozycji.')
    expect(err(base([]))).toBe('Od 1 do 4 części.')
    expect(err(base([now(10), now(10), now(10), now(10), now(null)]))).toBe('Od 1 do 4 części.')
  })
})

describe('partiale: szansa osiągnięcia celów, oczekiwany wynik i sugestia', () => {
  const chance = (percent: number | null, targetPips: number, probability: number | null): PartialSpec => ({ mode: 'target', percent, targetPips, probability })

  it('domyślnie 100%: oczekiwany wynik = wszystkie cele osiągnięte, sugestia podziału', () => {
    const p = plan(base([now(50), target(null, 60)]))
    expect(p.rows.map((r) => r.probability)).toEqual([1, 1])
    expect(p.scenarios.map((s) => s.probability)).toEqual([0, 1])
    expect(p.expected).toEqual({ amount: 450, r: 2.25, vsNow: 150 })
    expect(p.suggestion).toBe('split')
  })

  it('szansa 50%: oczekiwany wynik = średnia ważona scenariuszy; poniżej progu opłaca się zamknąć teraz', () => {
    // 50 / 50 between +50 (back to the stop) and +450: expected 250 < 300 now.
    const half = plan(base([now(50), chance(null, 60, 50)]))
    expect(half.scenarios.map((s) => [s.amount, s.probability])).toEqual([
      [50, 0.5],
      [450, 0.5]
    ])
    expect(half.expected.amount).toBeCloseTo(250, 9)
    expect(half.expected.vsNow).toBeCloseTo(-50, 9)
    expect(half.suggestion).toBe('now')
    // Break-even: 150 or 450 → at 50% the expected 300 equals closing now; at 60% the split is better.
    expect(plan(base([now(50), chance(null, 60, 50)], { breakevenAfterFirst: true })).suggestion).toBe('equal')
    expect(plan(base([now(50), chance(null, 60, 60)], { breakevenAfterFirst: true })).suggestion).toBe('split')
  })

  it('kilka celów: szansa dokładnie k celów = szansa k-tego − szansa (k+1)-ego; dalszy cel nie bardziej prawdopodobny', () => {
    // Parts given out of order; targets 40 (80%), 80 (50%), 120 (typed 70% → lowered to 50%).
    const p = plan(base([chance(25, 80, 50), now(25), chance(25, 40, 80), chance(null, 120, 70)], { lots: 0.4 }))
    expect(p.rows.map((r) => [r.pips, r.probability, r.probabilityLowered])).toEqual([
      [80, 0.5, false],
      [30, 1, false],
      [40, 0.8, false],
      [120, 0.5, true]
    ])
    const probs = p.scenarios.map((s) => Number(s.probability.toFixed(9)))
    expect(probs).toEqual([0.2, 0.3, 0, 0.5])
    expect(probs.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9)
    // Amounts −30 / 30 / 130 / 270 (see the four-part case above).
    expect(p.expected.amount).toBeCloseTo(0.2 * -30 + 0.3 * 30 + 0 * 130 + 0.5 * 270, 9)
    expect(p.suggestion).toBe('split') // 138 > 120
  })

  it('wszystko teraz = tyle samo; szansa spoza 0–100% jest odrzucana', () => {
    expect(plan(base([now(50), now(null)])).suggestion).toBe('equal')
    const bad = partialPlan(base([now(50), chance(null, 60, 120)]))
    expect(bad).toEqual({ ok: false, error: 'Szansa osiągnięcia celu części 2 musi być od 0 do 100%.' })
    // 0%: the target is never reached – the split is the worst case.
    const never = plan(base([now(50), chance(null, 60, 0)]))
    expect(never.expected.amount).toBeCloseTo(never.worst.amount, 9)
  })
})

describe('partiale: ile tracisz względem zamknięcia całości na ostatnim celu', () => {
  const chance = (percent: number | null, targetPips: number, probability: number | null): PartialSpec => ({ mode: 'target', percent, targetPips, probability })

  it('koszt partiali = całość na ostatnim celu − podział przy wszystkich celach; koszt każdej części', () => {
    const p = plan(base([now(50), target(null, 60)]))
    // Whole position at +60: 1 lot × 60 × 10 = 600 (3R); the split with the target reached: 450.
    expect(p.final).toMatchObject({ pips: 60, amount: 600, r: 3, cost: 150, costR: 0.75, probability: 1, expected: 600 })
    expect(p.final!.splitVsHold).toBeCloseTo(-150, 9)
    expect(p.rows.map((r) => r.costVsFinal)).toEqual([150, 0])

    const four = plan(base([target(25, 80), now(25), target(25, 40), target(null, 120)], { lots: 0.4 }))
    expect(four.final!.amount).toBeCloseTo(480, 9)
    expect(four.final!.cost).toBeCloseTo(480 - 270, 9)
    expect(four.rows.map((r) => Number(r.costVsFinal.toFixed(6)))).toEqual([40, 90, 80, 0])
    expect(four.rows.reduce((s, r) => s + r.costVsFinal, 0)).toBeCloseTo(four.final!.cost, 9)
  })

  it('z szansą ostatniego celu: oczekiwany wynik trzymania całości (reszta szansy = cała pozycja na SL)', () => {
    // 50%: hold 0.5 × 600 + 0.5 × −200 = 200; split 0.5 × 50 + 0.5 × 450 = 250 → the split is 50 better.
    const p = plan(base([now(50), chance(null, 60, 50)]))
    expect(p.final!.expected).toBeCloseTo(200, 9)
    expect(p.final!.expectedR).toBeCloseTo(1, 9)
    expect(p.final!.splitVsHold).toBeCloseTo(50, 9)
    // The chance of the final target is the corrected one (not likelier than a nearer target).
    const capped = plan(base([chance(50, 40, 60), chance(null, 80, 90)]))
    expect(capped.final!.probability).toBeCloseTo(0.6, 9)
  })

  it('bez celów (wszystko teraz) nie ma porównania', () => {
    const p = plan(base([now(50), now(null)]))
    expect(p.final).toBeNull()
    expect(p.rows.map((r) => r.costVsFinal)).toEqual([0, 0])
  })
})
