import { describe, expect, it } from 'vitest'
import { partialPlan } from '@shared/calc/partials'
import { effectiveTargets, optimalSplit, type OptimalInput } from '@shared/calc/partialsOptimal'

/** EURUSD on a USD account: 10 USD per pip for 1 lot; SL 20, +30 now; targets +60 (70%) and +100 (40%). */
const base = (over: Partial<OptimalInput> = {}): OptimalInput => ({
  lots: 1,
  lotStep: 0.01,
  minLot: 0.01,
  pipValueMinLot: 0.1,
  stopPips: 20,
  nowPips: 30,
  breakevenAfterFirst: false,
  targets: [
    { pips: 60, probability: 70 },
    { pips: 100, probability: 40 }
  ],
  criterion: 'ev',
  ...over
})

function split(i: OptimalInput) {
  const out = optimalSplit(i)
  if (!out.ok) throw new Error(out.error)
  return out
}

describe('optymalny podział', () => {
  it('wartość każdego celu: p·(x + S) − S na 1 lot i próg szansy względem zamknięcia teraz', () => {
    const out = split(base())
    expect(out.nowPerLot).toBe(300)
    expect(out.targets.map((t) => [t.pips, t.probability, Number(t.evPerLot.toFixed(6)), Number(t.breakEven!.toFixed(6))])).toEqual([
      [60, 0.7, 360, 0.625], // (30 + 20) / (60 + 20)
      [100, 0.4, 280, Number((50 / 120).toFixed(6))]
    ])
  })

  it('maksymalny oczekiwany wynik: jedno wyjście – całość na celu o największym p·(x + S)', () => {
    const s = split(base()).split
    expect(s.parts).toEqual([{ mode: 'target', pips: 60, lots: 1, percent: 100, probability: 0.7 }])
    expect(s.expected).toBeCloseTo(360, 6)
    expect(s.worst).toBeCloseTo(-200, 6)
    expect(s.vsNow).toBeCloseTo(60, 6)
    // Below the threshold of 62.5% closing everything now is better.
    const low = split(base({ targets: [{ pips: 60, probability: 60 }] })).split
    expect(low.parts).toEqual([{ mode: 'now', pips: 30, lots: 1, percent: 100, probability: 1 }])
    expect(low.expected).toBeCloseTo(300, 6)
  })

  it('bez straty: najmniejsza część teraz, która pokrywa resztę na SL – S / (teraz + S) = 40%', () => {
    const s = split(base({ criterion: 'noLoss' })).split
    expect(s.parts.map((p) => [p.mode, p.pips, p.lots])).toEqual([
      ['now', 30, 0.4],
      ['target', 60, 0.6]
    ])
    expect(s.expected).toBeCloseTo(336, 6)
    expect(s.worst).toBeCloseTo(0, 6)
  })

  it('strata najwyżej 0.5R: 20% teraz, 80% na +60', () => {
    const s = split(base({ criterion: 'maxLoss', maxLossR: 0.5 })).split
    expect(s.parts.map((p) => [p.mode, p.lots])).toEqual([
      ['now', 0.2],
      ['target', 0.8]
    ])
    expect(s.expected).toBeCloseTo(348, 6)
    expect(s.worstR).toBeCloseTo(-0.5, 6)
  })

  it('wynik jest zgodny z kalkulatorem partiali (te same części → ten sam oczekiwany wynik i najgorszy przypadek)', () => {
    for (const criterion of ['ev', 'noLoss', 'maxLoss'] as const) {
      for (const breakevenAfterFirst of [false, true]) {
        const i = base({ criterion, maxLossR: 0.3, breakevenAfterFirst, targets: [{ pips: 45, probability: 85 }, { pips: 60, probability: 70 }, { pips: 100, probability: 40 }] })
        const s = split(i).split
        const p = partialPlan({ ...i, parts: s.specs })
        if (!p.ok) throw new Error(p.error)
        expect(p.plan.expected.amount).toBeCloseTo(s.expected, 6)
        expect(Math.min(...p.plan.scenarios.filter((x) => x.probability > 1e-9).map((x) => x.amount))).toBeCloseTo(s.worst, 6)
      }
    }
  })

  it('SL na BE: remis z zamknięciem teraz rozstrzyga bezpieczniejszy wariant', () => {
    // 50% on +60 with break-even: any split with a part now gives 300 = closing now; the safer one is closing now.
    const s = split(base({ breakevenAfterFirst: true, targets: [{ pips: 60, probability: 50 }] })).split
    expect(s.parts.map((p) => p.mode)).toEqual(['now'])
    expect(s.expected).toBeCloseTo(300, 6)
  })

  it('cele: tylko dalej niż obecny wynik, te same poziomy scalone, szanse nierosnące', () => {
    expect(
      effectiveTargets(30, [
        { pips: 25, probability: 90 },
        { pips: 80, probability: 70 },
        { pips: 60, probability: 50 },
        { pips: 60, probability: 60 },
        { pips: 120, probability: null }
      ])
    ).toEqual([
      { pips: 60, probability: 0.5 },
      { pips: 80, probability: 0.5 },
      { pips: 120, probability: 0.5 }
    ])
  })

  it('duża pozycja i 4 cele: siatka zgrubna, wynik w krokach lota; błędy wejścia', () => {
    const big = split(
      base({
        lots: 7.3,
        criterion: 'noLoss',
        targets: [
          { pips: 45, probability: 85 },
          { pips: 60, probability: 70 },
          { pips: 80, probability: 55 },
          { pips: 100, probability: 40 }
        ]
      })
    ).split
    expect(big.parts.reduce((a, p) => a + p.lots, 0)).toBeCloseTo(7.3, 9)
    for (const p of big.parts) expect(Math.abs(p.lots * 100 - Math.round(p.lots * 100))).toBeLessThan(1e-6)
    expect(big.worst).toBeGreaterThanOrEqual(-0.005)
    expect(optimalSplit(base({ criterion: 'noLoss', nowPips: -5 }))).toMatchObject({ ok: false })
    expect(optimalSplit(base({ stopPips: 0 }))).toMatchObject({ ok: false, error: 'Wpisz stop loss w pipsach (większy od zera).' })
  })
})
