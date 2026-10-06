/**
 * "Optymalny podział" (1.4.3): how much of the position to close now and at each target, given the chance of
 * reaching every target. The split is evaluated exactly like `partialPlan` (outcomes 0…n targets reached, the rest
 * at the stop or at break-even), every allocation in lot steps is tried (a coarser grid for big positions) and the best
 * one for the criterion wins:
 *  - 'ev': the highest expected result. Without break-even it is always one exit (all at the target with the highest
 *    p·(x + S), or everything now) – partials do not raise the expectation, they lower the risk;
 *  - 'noLoss': the highest expected result whose worst possible outcome is not a loss;
 *  - 'maxLoss': the highest expected result whose worst possible outcome loses at most `maxLossR` × 1R.
 * Ties (within half a cent) go to the safer split (higher worst case), then to fewer parts.
 */
import { MAX_PARTIALS, type PartialSpec } from './partials'

export type OptimalCriterion = 'ev' | 'noLoss' | 'maxLoss'

export interface OptimalInput {
  lots: number
  lotStep: number
  minLot: number
  pipValueMinLot: number
  stopPips: number
  nowPips: number
  breakevenAfterFirst: boolean
  /** Targets to choose from: pips from entry and the chance (percent, null = 100). */
  targets: ReadonlyArray<{ pips: number; probability: number | null }>
  criterion: OptimalCriterion
  /** 'maxLoss': the worst possible outcome may lose at most this many R. */
  maxLossR?: number
}

export interface OptimalPart {
  mode: 'now' | 'target'
  pips: number
  lots: number
  percent: number
  /** 1 for the part closed now, else the chance of its target. */
  probability: number
}

/** One target on its own: expected result of 1 lot held to it (rest at the stop) and the chance it needs to beat closing now. */
export interface TargetValue {
  pips: number
  probability: number
  evPerLot: number
  /** p > (now + S) / (x + S) makes the target better than closing now; null when it can never be (≥ 100%). */
  breakEven: number | null
}

export interface OptimalSplit {
  parts: OptimalPart[]
  expected: number
  expectedR: number
  /** Worst outcome that can happen (chance > 0). */
  worst: number
  worstR: number
  best: number
  /** Expected result minus closing everything now. */
  vsNow: number
  /**
   * The whole position closed at the final (farthest) target instead: its result, and what this split gives up
   * when the price gets there (whole position there − this split with every target reached); null without targets.
   */
  final: { pips: number; amount: number; cost: number; costR: number } | null
  /** The split as calculator parts (closed now first, targets by distance; the last one takes the rest). */
  specs: PartialSpec[]
}

export type OptimalOutcome = { ok: true; split: OptimalSplit; targets: TargetValue[]; nowPerLot: number } | { ok: false; error: string; targets: TargetValue[]; nowPerLot: number }

const EPS = 1e-9
const TIE = 0.005
/** Coarse grid per number of buckets (now + targets): ≤ ~25k splits; the best one is then refined in lot steps. */
const GRID_CAP: Record<number, number> = { 1: 1, 2: 1000, 3: 100, 4: 50, 5: 25 }

/** Targets beyond the current result, sorted by distance, equal levels merged, chances made non-increasing. */
export function effectiveTargets(nowPips: number, targets: OptimalInput['targets']): Array<{ pips: number; probability: number }> {
  const sorted = targets
    .filter((t) => Number.isFinite(t.pips) && t.pips > nowPips)
    .map((t) => ({ pips: t.pips, probability: Math.min(1, Math.max(0, (t.probability ?? 100) / 100)) }))
    .sort((a, b) => a.pips - b.pips)
  const out: Array<{ pips: number; probability: number }> = []
  for (const t of sorted) {
    const last = out.at(-1)
    if (last && Math.abs(last.pips - t.pips) < EPS) last.probability = Math.min(last.probability, t.probability)
    else out.push({ ...t })
  }
  let cap = 1
  for (const t of out) {
    t.probability = Math.min(t.probability, cap)
    cap = t.probability
  }
  return out
}

interface Eval {
  expected: number
  worst: number
  best: number
  /** Every target with lots reached (all parts closed where planned). */
  allReached: number
}

/**
 * Outcomes of a split given as lots per bucket (0 = now, 1… = targets by distance), in the same way as `partialPlan`:
 * the price reaches 0…m of the targets that hold lots; the parts still open close at the stop, or at entry when
 * break-even is on and a part was already closed in profit.
 */
function evaluate(lots: number[], targets: Array<{ pips: number; probability: number }>, nowPips: number, stopPips: number, breakeven: boolean, perPip: number): Eval {
  const locked = lots[0]! * nowPips
  const pending: Array<{ pips: number; probability: number; lots: number }> = []
  for (let k = 0; k < targets.length; k++) if (lots[k + 1]! > EPS) pending.push({ ...targets[k]!, lots: lots[k + 1]! })
  let expected = 0
  let worst = Infinity
  let best = -Infinity
  let allReached = 0
  for (let reached = 0; reached <= pending.length; reached++) {
    const firstProfit = (lots[0]! > EPS && nowPips > 0) || (reached > 0 && pending[0]!.pips > 0)
    const rest = breakeven && firstProfit ? 0 : -stopPips
    let pips = locked
    pending.forEach((p, j) => {
      pips += p.lots * (j < reached ? p.pips : rest)
    })
    const amount = pips * perPip
    const hit = reached === 0 ? 1 : pending[reached - 1]!.probability
    const next = reached < pending.length ? pending[reached]!.probability : 0
    const chance = Math.max(0, hit - next)
    expected += chance * amount
    if (chance > EPS) worst = Math.min(worst, amount)
    best = Math.max(best, amount)
    if (reached === pending.length) allReached = amount
  }
  return { expected, worst, best, allReached }
}

/** Every way to put `total` units into `buckets` buckets (at most `maxNonZero` used). */
function* compositions(total: number, buckets: number, maxNonZero: number): Generator<number[]> {
  const cur = new Array<number>(buckets).fill(0)
  function* rec(i: number, left: number, used: number): Generator<number[]> {
    if (i === buckets - 1) {
      if (left > 0 && used >= maxNonZero) return
      cur[i] = left
      yield cur
      return
    }
    for (let v = 0; v <= left; v++) {
      if (v > 0 && used >= maxNonZero) break
      cur[i] = v
      yield* rec(i + 1, left - v, used + (v > 0 ? 1 : 0))
    }
    cur[i] = 0
  }
  yield* rec(0, total, 0)
}

export function optimalSplit(i: OptimalInput): OptimalOutcome {
  const perPip = i.pipValueMinLot / i.minLot // value of 1 pip for 1 lot
  const targets = effectiveTargets(i.nowPips, i.targets)
  const S = i.stopPips
  const values: TargetValue[] = targets.map((t) => {
    const be = (i.nowPips + S) / (t.pips + S)
    return { pips: t.pips, probability: t.probability, evPerLot: (t.probability * (t.pips + S) - S) * perPip, breakEven: be < 1 - EPS ? be : null }
  })
  const nowPerLot = i.nowPips * perPip
  const fail = (error: string): OptimalOutcome => ({ ok: false, error, targets: values, nowPerLot })
  if (!(i.lots > 0) || !(i.lotStep > 0) || !(i.minLot > 0) || !(i.pipValueMinLot > 0)) return fail('Wpisz wielkość pozycji.')
  if (!(S > 0)) return fail('Wpisz stop loss w pipsach (większy od zera).')
  if (!Number.isFinite(i.nowPips) || i.nowPips <= -S) return fail('Obecny wynik musi być przed stop lossem.')
  if (i.criterion === 'maxLoss' && !(i.maxLossR != null && i.maxLossR >= 0)) return fail('Wpisz dopuszczalną stratę w R (0 lub więcej).')

  const units = Math.round(i.lots / i.lotStep + EPS)
  if (units < 1) return fail('Pozycja jest mniejsza niż krok lota.')
  const buckets = 1 + targets.length
  const grid = Math.max(1, Math.min(units, GRID_CAP[buckets] ?? 40))
  const riskAmount = i.lots * S * perPip
  const floor = i.criterion === 'noLoss' ? -TIE : i.criterion === 'maxLoss' ? -(i.maxLossR ?? 0) * riskAmount - TIE : -Infinity

  type Cand = { steps: number[]; e: Eval; parts: number }
  const better = (a: Cand, b: Cand | null) =>
    !b ||
    a.e.expected > b.e.expected + TIE ||
    (Math.abs(a.e.expected - b.e.expected) <= TIE && (a.e.worst > b.e.worst + TIE || (Math.abs(a.e.worst - b.e.worst) <= TIE && a.parts < b.parts)))
  /** A split in whole lot steps per bucket, or null when it breaks the limits (parts, criterion). */
  const candidate = (steps: number[]): Cand | null => {
    const parts = steps.filter((x) => x > 0).length
    if (parts > MAX_PARTIALS) return null
    const e = evaluate(
      steps.map((x) => x * i.lotStep),
      targets,
      i.nowPips,
      S,
      i.breakevenAfterFirst,
      perPip
    )
    return e.worst < floor ? null : { steps: [...steps], e, parts }
  }
  let best: Cand | null = null
  for (const g of compositions(grid, buckets, MAX_PARTIALS)) {
    // Grid units → whole lot steps; the farthest bucket in use takes what rounding leaves.
    const steps = g.map((x) => Math.floor((x * units) / grid + EPS))
    const lastUsed = g.reduce((acc, x, k) => (x > 0 ? k : acc), -1)
    steps[lastUsed] = steps[lastUsed]! + units - steps.reduce((a, b) => a + b, 0)
    if (g.some((x, k) => x > 0 && steps[k]! < 1)) continue
    const c = candidate(steps)
    if (c && better(c, best)) best = c
  }
  // Refine in lot steps: move lots between two parts while it helps, with ever smaller moves.
  if (best && units > grid) {
    for (let d = Math.ceil(units / grid); d >= 1; d = d > 1 ? Math.ceil(d / 2) : 0) {
      let improved = true
      while (improved) {
        improved = false
        for (let a = 0; a < buckets; a++)
          for (let b = 0; b < buckets; b++) {
            if (a === b || best.steps[a]! < d) continue
            const steps = [...best.steps]
            steps[a] = steps[a]! - d
            steps[b] = steps[b]! + d
            const c = candidate(steps)
            if (c && better(c, best)) {
              best = c
              improved = true
            }
          }
      }
      if (d === 1) break
    }
  }
  if (!best)
    return fail(
      i.criterion === 'noLoss'
        ? 'Żaden podział nie chroni przed stratą – obecny wynik nie pokrywa straty reszty na SL (włącz SL na BE albo dopuść stratę).'
        : 'Żaden podział nie mieści się w dopuszczalnej stracie – zwiększ ją albo zamknij więcej teraz.'
    )

  const dec = Math.max(0, Math.ceil(-Math.log10(i.lotStep) - EPS))
  const parts: OptimalPart[] = []
  best.steps.forEach((st, k) => {
    if (st <= 0) return
    const lots = Number((st * i.lotStep).toFixed(dec))
    const percent = Number(((lots / i.lots) * 100).toFixed(6))
    parts.push(k === 0 ? { mode: 'now', pips: i.nowPips, lots, percent, probability: 1 } : { mode: 'target', pips: targets[k - 1]!.pips, lots, percent, probability: targets[k - 1]!.probability })
  })
  const specs: PartialSpec[] = parts.map((p, k) => ({
    mode: p.mode,
    percent: k === parts.length - 1 ? null : p.percent,
    targetPips: p.mode === 'target' ? p.pips : null,
    probability: p.mode === 'target' ? Number((p.probability * 100).toFixed(4)) : 100
  }))
  const nowAmount = i.lots * i.nowPips * perPip
  const last = targets.at(-1)
  const finalAmount = last ? i.lots * last.pips * perPip : 0
  return {
    ok: true,
    split: {
      parts,
      expected: best.e.expected,
      expectedR: best.e.expected / riskAmount,
      worst: best.e.worst,
      worstR: best.e.worst / riskAmount,
      best: best.e.best,
      vsNow: best.e.expected - nowAmount,
      final: last ? { pips: last.pips, amount: finalAmount, cost: finalAmount - best.e.allReached, costR: (finalAmount - best.e.allReached) / riskAmount } : null,
      specs
    },
    targets: values,
    nowPerLot
  }
}
