export interface PositionInput {
  balance: number
  riskPercent: number
  stopPips: number
  pipSize: number
  /** Units per 1.00 lot (100 000 for standard FX lots). */
  contractSize: number
  /** How many units of account currency one unit of the quote currency is worth (1 when they are equal). */
  quoteToAccountRate: number
  lotStep: number
}

export interface PositionResult {
  riskAmount: number
  /** Value of one pip for 1.00 lot, in account currency. */
  pipValuePerLot: number
  lotsExact: number
  /** Rounded down to the lot step, so risk never exceeds the target. */
  lots: number
  actualRiskAmount: number
  actualRiskPercent: number
}

function stepDecimals(step: number): number {
  const s = String(step)
  const i = s.indexOf('.')
  return i < 0 ? 0 : s.length - i - 1
}

export function positionSize(input: PositionInput): PositionResult | null {
  const { balance, riskPercent, stopPips, pipSize, contractSize, quoteToAccountRate, lotStep } = input
  if (![balance, riskPercent, stopPips, pipSize, contractSize, quoteToAccountRate, lotStep].every(Number.isFinite)) return null
  if (balance <= 0 || riskPercent <= 0 || stopPips <= 0 || pipSize <= 0 || contractSize <= 0 || quoteToAccountRate <= 0 || lotStep <= 0)
    return null
  const riskAmount = (balance * riskPercent) / 100
  const pipValuePerLot = contractSize * pipSize * quoteToAccountRate
  const lotsExact = riskAmount / (stopPips * pipValuePerLot)
  const steps = Math.floor(lotsExact / lotStep + 1e-9)
  const lots = Number((steps * lotStep).toFixed(stepDecimals(lotStep)))
  const actualRiskAmount = lots * stopPips * pipValuePerLot
  return {
    riskAmount,
    pipValuePerLot,
    lotsExact,
    lots,
    actualRiskAmount,
    actualRiskPercent: (actualRiskAmount / balance) * 100
  }
}
