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

/** Decimal places of a step or value like 0.01 or 0.015 (float noise such as 0.30000000000000004 ignored). */
export function stepDecimals(step: number): number {
  if (!Number.isFinite(step) || step === 0) return 0
  const s = Math.abs(step).toFixed(10).replace(/0+$/, '')
  const i = s.indexOf('.')
  return i < 0 || i === s.length - 1 ? 0 : s.length - i - 1
}

/** Decimals for showing lots: at least 2, more when the lot step is finer (0.001). */
export function lotDecimals(lotStep: number): number {
  return Math.max(2, Math.min(8, stepDecimals(lotStep)))
}

/** Decimals that show a value without hiding digits: at least `min`, at most 8. */
export function shownDecimals(value: number | null | undefined, min: number): number {
  if (value == null || !Number.isFinite(value)) return min
  return Math.max(min, Math.min(8, stepDecimals(value)))
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
