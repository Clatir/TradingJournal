/**
 * Profit / loss of a position from its size in lots, the move in pips and the value of one pip for the
 * smallest lot (in account currency):
 *   P/L = pips × pip value (smallest lot) × lots / smallest lot
 */

export type PnlPresetId = 'AUDUSD' | 'EURGBP' | 'EURUSD' | 'EURAUD' | 'WTI'
export type PnlInstrumentId = PnlPresetId | 'CUSTOM'

export interface PnlPreset {
  id: PnlPresetId
  label: string
  /** Price change of one pip. */
  pipSize: number
  /** Units per 1.00 lot; null = the forex contract size from the settings (100 000 by default). */
  contractSize: number | null
  quoteCurrency: string
  description: string
}

export const PNL_PRESETS: PnlPreset[] = [
  { id: 'AUDUSD', label: 'AUDUSD', pipSize: 0.0001, contractSize: null, quoteCurrency: 'USD', description: '1 pips = 0.0001' },
  { id: 'EURGBP', label: 'EURGBP', pipSize: 0.0001, contractSize: null, quoteCurrency: 'GBP', description: '1 pips = 0.0001, wartość w GBP' },
  { id: 'EURUSD', label: 'EURUSD', pipSize: 0.0001, contractSize: null, quoteCurrency: 'USD', description: '1 pips = 0.0001' },
  { id: 'EURAUD', label: 'EURAUD', pipSize: 0.0001, contractSize: null, quoteCurrency: 'AUD', description: '1 pips = 0.0001, wartość w AUD' },
  {
    id: 'WTI',
    label: 'WTI',
    pipSize: 0.01,
    contractSize: 1000,
    quoteCurrency: 'USD',
    description: 'ropa WTI: 1 lot = 1000 baryłek, 1 pips = 0.01 USD (u części brokerów 1 lot = 100 baryłek – wtedy wpisz wartość pipsa ręcznie)'
  }
]

function round(value: number, decimals = 6): number {
  return Number(value.toFixed(decimals))
}

/** Value of one pip for the smallest lot in account currency; null without the conversion rate. */
export function presetPipValue(
  preset: PnlPreset,
  opts: { minLot: number; fxContractSize: number; quoteToAccountRate: number | null }
): number | null {
  const rate = opts.quoteToAccountRate
  if (rate == null || !(rate > 0) || !(opts.minLot > 0) || !(opts.fxContractSize > 0)) return null
  return round(preset.pipSize * (preset.contractSize ?? opts.fxContractSize) * opts.minLot * rate)
}

/** Value of one pip for `minLot` from the value for 1.00 lot (how hand-entered values are shown). */
export function pipValueForMinLot(perLot: number, minLot: number): number {
  return round(perLot * minLot, 8)
}

/** Value of one pip for 1.00 lot from the value for `minLot` (how hand-entered values are stored). */
export function pipValuePerLotFrom(valueForMinLot: number, minLot: number): number {
  return round(round(valueForMinLot, 8) / minLot, 10)
}

export interface PnlInput {
  lots: number
  /** Signed: negative = loss. */
  pips: number
  /** Value of one pip for `minLot`, in account currency. */
  pipValueMinLot: number
  minLot: number
}

export interface PnlResult {
  amount: number
  /** Value of one pip for the whole position. */
  pipValuePosition: number
  /** Value of one pip for 1.00 lot. */
  pipValuePerLot: number
  /** Position size as a multiple of the smallest lot. */
  minLots: number
  /** The position is a whole number of smallest lots. */
  wholeLots: boolean
}

export function profitLoss(i: PnlInput): PnlResult | null {
  if (![i.lots, i.pips, i.pipValueMinLot, i.minLot].every(Number.isFinite)) return null
  if (i.lots <= 0 || i.pipValueMinLot <= 0 || i.minLot <= 0) return null
  const minLots = i.lots / i.minLot
  const pipValuePosition = i.pipValueMinLot * minLots
  return {
    amount: round(i.pips * pipValuePosition, 8),
    pipValuePosition: round(pipValuePosition, 8),
    pipValuePerLot: round(i.pipValueMinLot / i.minLot, 8),
    minLots: round(minLots, 8),
    wholeLots: Math.abs(minLots - Math.round(minLots)) < 1e-6
  }
}
