/**
 * Payout forecast ("Prognoza wypłat"), chapter 5 of the specification. A pure function: no settings,
 * no randomness – everything comes in `ForecastInput` (random numbers are stored in the scenario).
 * The executable reference is `simulate()` in scripts/forecast-vectors.mjs; tests compare every row with
 * tests/fixtures/forecast-vectors.json. Money is a plain number (IEEE double); round only for display.
 */

import { FORECAST_MAX_MONTHS } from '../schema/forecast'

export interface ForecastInputGoal {
  id: string
  name: string
  month: number | null
  amount: number | null
  on: boolean
  flex: boolean
}

export interface ForecastPipsInput {
  pipsMode: 'fixed' | 'random'
  pips: number
  pipsLo: number
  pipsHi: number
  lotMode: 'fixed' | 'perCapital' | 'risk'
  lot: number
  lotPer: number
  lotPerAmount: number
  riskPct: number
  slPips: number
  lotMax: number | null
  /** Value of one pip for the smallest lot, in the scenario currency. */
  pipValueMinLot: number
  minLot: number
}

export interface ForecastDrawsInput {
  rate: number[]
  loss: number[]
  lossSize: number[]
  pips: number[]
}

export interface ForecastInput {
  keep: 'cash' | 'fund'
  /** Percent 0..100. */
  payout: number
  start: number
  monthly: number
  /** 1..240 */
  horizon: number
  /** First month 0..11. */
  m0: number
  /** First year. */
  y0: number
  deposits: Record<number, number>
  goals: ForecastInputGoal[]
  gain: 'pct' | 'pips'
  pct: { mode: 'fixed' | 'random'; fixed: number; lo: number; hi: number }
  pips?: ForecastPipsInput
  loss: { prob: number; pctLo: number; pctHi: number; pipsLo: number; pipsHi: number }
  /** rate in percent; payMonth = calendar month 1..12 */
  tax: { on: boolean; rate: number; payMonth: number }
  draws: ForecastDrawsInput
}

export interface ForecastBuy {
  goalId: string
  name: string
  amount: number
}

export interface ForecastRow {
  k: number
  /** "4-2027" */
  label: string
  /** Return of the month as a fraction: the rate applied (percent mode) or profit / start (pips mode). */
  rate: number
  /** Deposit actually applied (a withdrawal is limited to what is there). */
  deposit: number
  /** Tax paid in this month. */
  tax: number
  /** Capital / trading mass at the start of the month (after the deposit and the tax). */
  start: number
  profit: number
  payout: number
  /** Cash set aside / fund, after this month's purchases. */
  pot: number
  /** Capital / trading mass at the end of the month, after purchases. */
  end: number
  buys: ForecastBuy[]
  /** The "losing month" flag of 5.4, not the sign of the profit. */
  loss: boolean
  /** Pips mode only. */
  lot: number | null
  /** Pips mode only. */
  pips: number | null
  /** Id of the first goal in the queue that is still not bought. */
  head: string | null
}

export type GoalResult =
  | { month: number; planned: number; amount: number; whole: boolean; empty: boolean; after: string | null }
  | { pending: true; have: number }
  | { blockedBy: string }

export interface ForecastTotals {
  payout: number
  profit: number
  spent: number
  paidIn: number
  withdrawn: number
  taxPaid: number
  taxOutstanding: number
  lossMonths: number
  pot: number
  end: number
  meanRate: number
  lastPayout: number
}

export interface ForecastResult {
  rows: ForecastRow[]
  /** By goal id; goals outside the queue have no entry. */
  goals: Record<string, GoalResult>
  totals: ForecastTotals
}

/** Money compared in whole cents ("is there enough for the goal"). */
const cents = (x: number): number => Math.floor(x * 100 + 0.5)
/** Round down to a multiple of step (float noise tolerant), like calc/position.ts. */
export const floorToStep = (value: number, step: number): number => Math.floor(value / step + 1e-9) * step
/** Uniform number for month index i; a missing one counts as `missing`. */
const draw = (arr: readonly number[] | undefined, i: number, missing = 0): number => (arr && i < arr.length ? arr[i]! : missing)
const ordered = (a: number, b: number): [number, number] => [Math.min(a, b), Math.max(a, b)]

/** "4-2027" for month k of a forecast that starts in month m0 (0-11) of year y0. */
export function monthLabel(k: number, m0: number, y0: number): string {
  const idx = m0 + k - 1
  return `${(idx % 12) + 1}-${y0 + Math.floor(idx / 12)}`
}

/** Calendar month (1-12) and year of forecast month k. */
export function calendarOf(k: number, m0: number, y0: number): { month: number; year: number } {
  const idx = m0 + k - 1
  return { month: (idx % 12) + 1, year: y0 + Math.floor(idx / 12) }
}

/** Goals that take part in the calculation, in queue order: by month, then by position on the list. */
export function goalQueue<G extends { month: number | null; on: boolean }>(goals: readonly G[], horizon: number): G[] {
  return goals
    .map((g, i) => ({ g, i }))
    .filter(({ g }) => g.on && Number.isInteger(g.month) && g.month! >= 1 && g.month! <= FORECAST_MAX_MONTHS && g.month! <= horizon)
    .sort((a, b) => a.g.month! - b.g.month! || a.i - b.i)
    .map(({ g }) => g)
}

export function simulateForecast(input: ForecastInput): ForecastResult {
  const N = input.horizon
  const p = input.payout / 100
  const invest = input.keep === 'fund'
  const { loss, tax, draws: dr } = input
  const queue = goalQueue(input.goals, N)
  const bought = new Set<string>()
  const goals: Record<string, GoalResult> = {}
  let B = 0
  let P = 0
  const tot = { payout: 0, profit: 0, spent: 0, paidIn: input.start, withdrawn: 0, taxPaid: 0, lossMonths: 0 }
  let rateSum = 0
  let pendingTax: number[] = [] // tax of closed years, not yet due
  let taxDue = 0
  let yearProfit = 0
  const rows: ForecastRow[] = []

  for (let k = 1; k <= N; k++) {
    const { month: cm, year: cy } = calendarOf(k, input.m0, input.y0)
    // 1. deposit (a negative one is a withdrawal, at most what is there)
    const base = k === 1 ? input.start : B
    const custom = input.deposits[k]
    let dep = custom !== undefined ? custom : k === 1 ? 0 : input.monthly
    if (dep < 0) {
      dep = -Math.min(-dep, Math.max(base, 0))
      tot.withdrawn += -dep
    } else tot.paidIn += dep
    const avail = base + dep

    // 2. tax of earlier years
    let taxMonth = 0
    if (tax.on) {
      if (cm === tax.payMonth) {
        for (const t of pendingTax) taxDue += t
        pendingTax = []
      }
      if (taxDue > 0) {
        taxMonth = Math.min(taxDue, Math.max(avail, 0))
        taxDue -= taxMonth
        tot.taxPaid += taxMonth
      }
    }
    const Bs = avail - taxMonth

    // 3. the fund cannot be larger than the mass it sits in
    if (invest) P = Math.min(P, Math.max(Bs, 0))

    // 4. profit
    const isLoss = loss.prob > 0 && draw(dr.loss, k - 1, 1) < loss.prob / 100
    let lot: number | null = null
    let pips: number | null = null
    let r: number
    let G: number
    if (input.gain === 'pct') {
      const c = input.pct
      if (isLoss) {
        const [lo, hi] = ordered(loss.pctLo, loss.pctHi)
        r = -(lo + draw(dr.lossSize, k - 1) * (hi - lo)) / 100
      } else if (c.mode === 'fixed') r = c.fixed / 100
      else {
        const [lo, hi] = ordered(c.lo, c.hi)
        r = (lo + draw(dr.rate, k - 1) * (hi - lo)) / 100
      }
      G = Bs * r
    } else {
      const c = input.pips!
      const { minLot, pipValueMinLot: pv } = c
      if (isLoss) {
        const [lo, hi] = ordered(loss.pipsLo, loss.pipsHi)
        pips = -(lo + draw(dr.lossSize, k - 1) * (hi - lo))
      } else if (c.pipsMode === 'fixed') pips = c.pips
      else {
        const [lo, hi] = ordered(c.pipsLo, c.pipsHi)
        pips = lo + draw(dr.pips, k - 1) * (hi - lo)
      }
      if (c.lotMode === 'fixed') lot = c.lot
      else if (c.lotMode === 'perCapital') lot = floorToStep(Math.floor(Math.max(Bs, 0) / c.lotPerAmount + 1e-9) * c.lotPer, minLot)
      else lot = floorToStep((Math.max(Bs, 0) * c.riskPct) / 100 / ((c.slPips * pv) / minLot), minLot) // risk % and stop in pips
      if (c.lotMode !== 'fixed' && c.lotMax != null) lot = Math.min(lot, c.lotMax)
      const units = Math.round((lot / minLot) * 1e6) / 1e6
      G = Math.max(pips * pv * units, -Bs) // cannot lose more than there is
      r = Bs > 0 ? G / Bs : 0
    }
    if (isLoss) tot.lossMonths++

    // 5.-6. payout and booking
    const J = G > 0 ? G * p : 0
    if (invest) {
      B = Bs + G
      P = Math.min(P + J, Math.max(B, 0))
    } else {
      B = Bs + G - J
      P = P + J
    }
    tot.payout += J
    tot.profit += G
    rateSum += r

    // 7. goals, in queue order
    const buys: ForecastBuy[] = []
    for (const g of queue) {
      if (bought.has(g.id)) continue
      if (k < g.month!) break
      const hasAmount = g.amount != null && g.amount > 0
      let take: number
      if (hasAmount) {
        if (cents(P) < cents(g.amount!)) {
          if (g.flex) continue // may wait: does not block the next goals
          break
        }
        take = g.amount!
      } else take = Math.max(P, 0) // no amount: takes everything set aside
      P = Math.max(0, P - take)
      if (invest) B = Math.max(0, B - take)
      goals[g.id] = {
        month: k,
        planned: g.month!,
        amount: take,
        whole: !hasAmount,
        empty: !hasAmount && cents(take) <= 0,
        after: buys.length ? buys[buys.length - 1]!.goalId : null // goal bought just before it in the same month
      }
      tot.spent += take
      bought.add(g.id)
      buys.push({ goalId: g.id, name: g.name, amount: take })
    }

    // 9. close the tax year after December or after the last row
    if (tax.on) {
      yearProfit += G
      if (cm === 12 || k === N) {
        pendingTax.push((tax.rate / 100) * Math.max(0, yearProfit))
        yearProfit = 0
      }
    }
    const head = queue.find((g) => !bought.has(g.id))?.id ?? null // first goal still waiting (label "na: ...")
    rows.push({ k, label: `${cm}-${cy}`, rate: r, deposit: dep, tax: taxMonth, start: Bs, profit: G, payout: J, pot: P, end: B, buys, loss: isLoss, lot, pips, head })
  }

  let blocker: string | null = null
  for (const g of queue) {
    if (bought.has(g.id)) continue
    goals[g.id] = blocker != null ? { blockedBy: blocker } : { pending: true, have: P }
    if (blocker == null && !g.flex) blocker = g.id
  }
  let outstanding = taxDue
  for (const t of pendingTax) outstanding += t
  return {
    rows,
    goals,
    totals: { ...tot, pot: P, end: B, meanRate: rateSum / N, lastPayout: rows[N - 1]!.payout, taxOutstanding: outstanding }
  }
}

/** Percentile q (0..1) of an ascending array: v[round(q × (R − 1))]. */
export function percentile(sorted: readonly number[], q: number): number {
  if (!sorted.length) return Number.NaN
  return sorted[Math.round(q * (sorted.length - 1))]!
}
