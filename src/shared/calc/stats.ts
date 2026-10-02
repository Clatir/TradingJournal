import { classifyOutcome } from './trade'

export interface StatInput {
  /** Result in R of a closed trade. */
  r: number
  /** Sort key: close (or entry) time ISO. */
  time: string
}

export interface StatsSummary {
  count: number
  wins: number
  losses: number
  breakevens: number
  /** wins / (wins + losses); BE excluded. null when no decisive trades. */
  winRate: number | null
  totalR: number
  /** Mean R per trade (all closed trades, BE included). */
  expectancy: number | null
  avgWinR: number | null
  avgLossR: number | null
  /** Gross profit / gross loss (R). Infinity when there are no losses but some profit. */
  profitFactor: number | null
  /** Largest peak-to-trough decline of the cumulative R curve (positive number). */
  maxDrawdownR: number
  longestWinStreak: number
  longestLossStreak: number
  /** Current streak: positive = wins in a row, negative = losses in a row. */
  currentStreak: number
}

export interface EquityPoint {
  time: string
  r: number
  equity: number
  drawdown: number
}

export function equityCurve(inputs: readonly StatInput[]): EquityPoint[] {
  const sorted = [...inputs].sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0))
  let equity = 0
  let peak = 0
  return sorted.map((t) => {
    equity += t.r
    peak = Math.max(peak, equity)
    return { time: t.time, r: t.r, equity, drawdown: equity - peak }
  })
}

export function summarize(inputs: readonly StatInput[], breakevenThresholdR: number): StatsSummary {
  const curve = equityCurve(inputs)
  let wins = 0
  let losses = 0
  let breakevens = 0
  let grossWin = 0
  let grossLoss = 0
  let totalR = 0
  let maxDd = 0
  let winStreak = 0
  let lossStreak = 0
  let longestWin = 0
  let longestLoss = 0
  let current = 0

  for (const p of curve) {
    totalR += p.r
    maxDd = Math.min(maxDd, p.drawdown)
    const outcome = classifyOutcome(p.r, breakevenThresholdR)
    if (outcome === 'win') {
      wins++
      grossWin += p.r
      winStreak++
      lossStreak = 0
      current = current > 0 ? current + 1 : 1
    } else if (outcome === 'loss') {
      losses++
      grossLoss += -p.r
      lossStreak++
      winStreak = 0
      current = current < 0 ? current - 1 : -1
    } else {
      // Break-even neither extends nor breaks a streak.
      breakevens++
    }
    longestWin = Math.max(longestWin, winStreak)
    longestLoss = Math.max(longestLoss, lossStreak)
  }

  const count = curve.length
  const decisive = wins + losses
  return {
    count,
    wins,
    losses,
    breakevens,
    winRate: decisive > 0 ? wins / decisive : null,
    totalR,
    expectancy: count > 0 ? totalR / count : null,
    avgWinR: wins > 0 ? grossWin / wins : null,
    avgLossR: losses > 0 ? -grossLoss / losses : null,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Number.POSITIVE_INFINITY : null,
    maxDrawdownR: -maxDd,
    longestWinStreak: longestWin,
    longestLossStreak: longestLoss,
    currentStreak: current
  }
}
