/**
 * "Rozrzut wyników" (chapter 11): many runs of one scenario, each with fresh random numbers. Runs are added
 * in chunks (the page yields between them), then summarized with percentiles v[round(q × (R − 1))].
 */
import { drawUniforms } from '../random'
import { goalQueue, percentile, simulateForecast, type ForecastInput } from './forecast'

export interface MonteCarloState {
  input: ForecastInput
  runs: number
  ends: number[]
  payouts: number[]
  spent: number[]
  pots: number[]
  /** Runs that ended with less capital than was paid in (paidIn − withdrawn). */
  belowPaidIn: number
  /** Purchase month of every goal in every run where it was bought. */
  goalMonths: Record<string, number[]>
  /** End capital / mass of every month in every run: monthEnds[k − 1][run]. */
  monthEnds: number[][]
}

export interface Spread {
  p5: number
  p50: number
  p95: number
}

export interface MonteCarloSummary {
  runs: number
  end: Spread
  payout: Spread
  spent: Spread
  pot: Spread
  /** Percent of runs ending below the money paid in. */
  belowPaidInPct: number
  goals: Array<{ id: string; name: string; boughtPct: number; typicalMonth: number | null; monthRange: [number, number] | null }>
  /** Per month: percentiles 5 / 50 / 95 of the end capital (for the chart). */
  monthly: Array<{ k: number } & Spread>
}

/** A scenario without randomness gives the same result in every run (fixed return / pips and no losing months). */
export function hasRandomness(input: Pick<ForecastInput, 'gain' | 'pct' | 'pips' | 'loss'>): boolean {
  if (input.loss.prob > 0) return true
  return input.gain === 'pct' ? input.pct.mode === 'random' : input.pips?.pipsMode === 'random'
}

export function startMonteCarlo(input: ForecastInput): MonteCarloState {
  return {
    input,
    runs: 0,
    ends: [],
    payouts: [],
    spent: [],
    pots: [],
    belowPaidIn: 0,
    goalMonths: Object.fromEntries(goalQueue(input.goals, input.horizon).map((g) => [g.id, []])),
    monthEnds: Array.from({ length: input.horizon }, () => [])
  }
}

/** `n` more runs with fresh draws (crypto.getRandomValues). Mutates and returns the state. */
export function runMonteCarlo(state: MonteCarloState, n: number, draw: (count: number) => number[] = drawUniforms): MonteCarloState {
  const N = state.input.horizon
  for (let i = 0; i < n; i++) {
    const r = simulateForecast({ ...state.input, draws: { rate: draw(N), loss: draw(N), lossSize: draw(N), pips: draw(N) } })
    const t = r.totals
    state.ends.push(t.end)
    state.payouts.push(t.payout)
    state.spent.push(t.spent)
    state.pots.push(t.pot)
    if (t.end < t.paidIn - t.withdrawn) state.belowPaidIn++
    for (const [id, months] of Object.entries(state.goalMonths)) {
      const g = r.goals[id]
      if (g && 'month' in g) months.push(g.month)
    }
    for (const row of r.rows) state.monthEnds[row.k - 1]!.push(row.end)
    state.runs++
  }
  return state
}

const asc = (v: readonly number[]) => [...v].sort((a, b) => a - b)
function spread(values: readonly number[]): Spread {
  const s = asc(values)
  return { p5: percentile(s, 0.05), p50: percentile(s, 0.5), p95: percentile(s, 0.95) }
}

export function summarizeMonteCarlo(state: MonteCarloState): MonteCarloSummary {
  const R = state.runs
  const names = new Map(state.input.goals.map((g) => [g.id, g.name]))
  return {
    runs: R,
    end: spread(state.ends),
    payout: spread(state.payouts),
    spent: spread(state.spent),
    pot: spread(state.pots),
    belowPaidInPct: R ? (state.belowPaidIn / R) * 100 : 0,
    goals: Object.entries(state.goalMonths).map(([id, months]) => {
      const s = asc(months)
      return {
        id,
        name: names.get(id) ?? '',
        boughtPct: R ? (months.length / R) * 100 : 0,
        typicalMonth: s.length ? percentile(s, 0.5) : null,
        monthRange: s.length ? [percentile(s, 0.05), percentile(s, 0.95)] : null
      }
    }),
    monthly: state.monthEnds.map((v, i) => ({ k: i + 1, ...spread(v) }))
  }
}
