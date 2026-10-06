/**
 * "Partiale" in the calculator: close the whole open position now, or split it into up to 4 parts – some closed
 * now (at the current result), the others at targets (pips from entry). For the split, every outcome is listed:
 * the price reaches 0, 1, … of the targets and then the rest closes at the stop (or at break-even).
 * Amounts: pips × value of one pip for the smallest lot × lots / smallest lot (as in the P/L calculator).
 * Every target has a chance of being reached (default 100%); with them the split has an expected result, and the
 * plan suggests the more profitable choice: the split or closing everything now.
 */
import { lotDecimals } from './position'
import { profitLoss } from './pnl'

export const MAX_PARTIALS = 4

export interface PartialSpec {
  /** 'now' closes at the current result, 'target' at `targetPips`. */
  mode: 'now' | 'target'
  /** Share of the position in percent; the last part always takes the rest (its own value is ignored). */
  percent: number | null
  /** Result in pips (from entry) where the part closes; only for 'target'. */
  targetPips: number | null
  /** Chance (percent) that the price reaches the target; only for 'target'; null / missing = 100%. */
  probability?: number | null
}

export interface PartialPlanInput {
  lots: number
  lotStep: number
  minLot: number
  /** Value of one pip for `minLot`, in the account currency. */
  pipValueMinLot: number
  /** Distance of the stop loss from entry in pips (> 0). */
  stopPips: number
  /** Result of the position now, in pips (signed). */
  nowPips: number
  /** After the first part is closed in profit, the stop of the rest moves to entry (0 pips). */
  breakevenAfterFirst: boolean
  parts: PartialSpec[]
}

export interface PartialRow {
  /** 1-based number of the part, as entered. */
  n: number
  mode: 'now' | 'target'
  percent: number
  lots: number
  /** Pips where this part closes when its target is reached (or now). */
  pips: number
  amount: number
  r: number
  /** Chance (0–1) that this part closes where planned: 1 for parts closed now; for targets after the
   * correction that a farther target cannot be likelier than a nearer one. */
  probability: number
  /** The typed chance was lowered to the chance of a nearer target. */
  probabilityLowered: boolean
}

export interface PlanScenario {
  /** How many targets were reached (in order of distance) before the rest closed at the stop. */
  reached: number
  /** Pips at which the parts still open close: −stop or 0 (break-even); null when every part is closed. */
  restPips: number | null
  amount: number
  r: number
  /** Difference to closing everything now. */
  vsNow: number
  /** Chance (0–1) of exactly this outcome. */
  probability: number
}

export type PartialSuggestion = 'split' | 'now' | 'equal'

export interface PartialPlan {
  /** Loss of the whole position at the stop (positive amount, = 1R). */
  riskAmount: number
  closeNow: { pips: number; amount: number; r: number }
  rows: PartialRow[]
  /** reached = 0 … number of targets; the last one is "every target reached". */
  scenarios: PlanScenario[]
  best: PlanScenario
  worst: PlanScenario
  /** Fewest targets reached for which the plan gives at least as much as closing now; null = never. */
  beatsNowAfter: number | null
  /** Expected result of the split: Σ chance × result of every outcome. */
  expected: { amount: number; r: number; vsNow: number }
  /** The more profitable choice by the expected result (equal within half a cent). */
  suggestion: PartialSuggestion
}

export type PartialPlanOutcome = { ok: true; plan: PartialPlan } | { ok: false; error: string }

const EPS = 1e-9

/** Requested percentages: the given ones, the last part takes 100 − their sum. */
export function partialPercents(parts: readonly PartialSpec[]): number[] {
  const given = parts.slice(0, -1).map((p) => p.percent ?? 0)
  const rest = 100 - given.reduce((s, x) => s + x, 0)
  return [...given, Number(rest.toFixed(6))]
}

export function partialPlan(i: PartialPlanInput): PartialPlanOutcome {
  const n = i.parts.length
  if (n < 1 || n > MAX_PARTIALS) return { ok: false, error: `Od 1 do ${MAX_PARTIALS} części.` }
  if (!(i.lots > 0) || !(i.lotStep > 0) || !(i.minLot > 0) || !(i.pipValueMinLot > 0)) return { ok: false, error: 'Wpisz wielkość pozycji.' }
  if (!(i.stopPips > 0)) return { ok: false, error: 'Wpisz stop loss w pipsach (większy od zera).' }
  if (!Number.isFinite(i.nowPips)) return { ok: false, error: 'Wpisz obecny wynik w pipsach.' }
  if (i.nowPips <= -i.stopPips) return { ok: false, error: 'Obecny wynik jest na stop lossie albo za nim – pozycja byłaby już zamknięta.' }

  const percents = partialPercents(i.parts)
  for (let k = 0; k < n - 1; k++) {
    const p = i.parts[k]!.percent
    if (p == null || !(p > 0)) return { ok: false, error: `Wpisz udział części ${k + 1} (więcej niż 0%).` }
  }
  if (!(percents[n - 1]! > EPS)) return { ok: false, error: `Części 1–${n - 1} zabierają ${100 - percents[n - 1]!}% pozycji – na ostatnią nic nie zostaje.` }
  for (let k = 0; k < n; k++) {
    const p = i.parts[k]!
    if (p.mode !== 'target') continue
    if (p.targetPips == null || !Number.isFinite(p.targetPips)) return { ok: false, error: `Wpisz cel części ${k + 1} w pipsach.` }
    if (p.targetPips <= i.nowPips) return { ok: false, error: `Cel części ${k + 1} (${p.targetPips} pips) nie jest dalej niż obecny wynik (${i.nowPips} pips) – wybierz „teraz”.` }
    const chance = p.probability
    if (chance != null && !(Number.isFinite(chance) && chance >= 0 && chance <= 100))
      return { ok: false, error: `Szansa osiągnięcia celu części ${k + 1} musi być od 0 do 100%.` }
  }

  // Lots of each part: rounded down to the lot step; the last part takes exactly what is left.
  const dec = lotDecimals(i.lotStep)
  const lots: number[] = []
  for (let k = 0; k < n - 1; k++) lots.push(Number((Math.floor((i.lots * percents[k]!) / 100 / i.lotStep + EPS) * i.lotStep).toFixed(dec)))
  lots.push(Number((i.lots - lots.reduce((s, x) => s + x, 0)).toFixed(dec)))
  const tooSmall = lots.findIndex((l) => !(l > EPS))
  if (tooSmall >= 0)
    return { ok: false, error: `Pozycja ${i.lots} lota jest za mała na taki podział: część ${tooSmall + 1} wychodzi poniżej kroku lota ${i.lotStep}.` }

  const amountOf = (partLots: number, pips: number) => profitLoss({ lots: partLots, pips, pipValueMinLot: i.pipValueMinLot, minLot: i.minLot })?.amount ?? 0
  const riskAmount = amountOf(i.lots, i.stopPips)
  const r = (amount: number) => amount / riskAmount
  const nowAmount = amountOf(i.lots, i.nowPips)

  const rows: PartialRow[] = i.parts.map((p, k) => {
    const pips = p.mode === 'now' ? i.nowPips : p.targetPips!
    const amount = amountOf(lots[k]!, pips)
    const typed = p.mode === 'now' ? 1 : (p.probability ?? 100) / 100
    return { n: k + 1, mode: p.mode, percent: Number(((lots[k]! / i.lots) * 100).toFixed(4)), lots: lots[k]!, pips, amount, r: r(amount), probability: typed, probabilityLowered: false }
  })
  const closedNow = rows.filter((row) => row.mode === 'now')
  const pending = rows.filter((row) => row.mode === 'target').sort((a, b) => a.pips - b.pips || a.n - b.n)
  // To reach a farther target the price passes the nearer ones: its chance is at most theirs.
  let cap = 1
  for (const row of pending) {
    if (row.probability > cap + EPS) {
      row.probability = cap
      row.probabilityLowered = true
    }
    cap = row.probability
  }
  const lockedNow = closedNow.reduce((s, row) => s + row.amount, 0)

  const scenarios: PlanScenario[] = []
  for (let reached = 0; reached <= pending.length; reached++) {
    // Break-even only once a part was closed in profit (now, or the first target).
    const firstProfit = (closedNow.length > 0 && i.nowPips > 0) || (reached > 0 && pending[0]!.pips > 0)
    const restPips = reached < pending.length ? (i.breakevenAfterFirst && firstProfit ? 0 : -i.stopPips) : null
    let amount = lockedNow
    pending.forEach((row, j) => {
      amount += j < reached ? row.amount : amountOf(row.lots, restPips!)
    })
    // Exactly `reached` targets: the last reached one hit, the next one not.
    const hit = reached === 0 ? 1 : pending[reached - 1]!.probability
    const next = reached < pending.length ? pending[reached]!.probability : 0
    scenarios.push({ reached, restPips, amount, r: r(amount), vsNow: amount - nowAmount, probability: Math.max(0, hit - next) })
  }
  const found = scenarios.find((s) => s.amount >= nowAmount - EPS)
  const expectedAmount = scenarios.reduce((sum, s) => sum + s.probability * s.amount, 0)
  const diff = expectedAmount - nowAmount
  return {
    ok: true,
    plan: {
      riskAmount,
      closeNow: { pips: i.nowPips, amount: nowAmount, r: r(nowAmount) },
      rows,
      scenarios,
      best: scenarios.at(-1)!,
      worst: scenarios[0]!,
      beatsNowAfter: found ? found.reached : null,
      expected: { amount: expectedAmount, r: r(expectedAmount), vsNow: diff },
      suggestion: Math.abs(diff) < 0.005 ? 'equal' : diff > 0 ? 'split' : 'now'
    }
  }
}
