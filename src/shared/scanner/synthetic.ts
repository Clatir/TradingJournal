/**
 * Synthetic dollar and euro indices from FX pairs (EODHD has only daily DXY / EXY bars). ICE definitions:
 * DXY = 50.14348112 × EURUSD^−0.576 × USDJPY^0.136 × GBPUSD^−0.119 × USDCAD^0.091 × USDSEK^0.042 × USDCHF^0.036,
 * EURX = 34.38805726 × EURUSD^0.3155 × EURGBP^0.3056 × EURJPY^0.1891 × EURCHF^0.1113 × EURSEK^0.0785.
 * They approximate direction and structure, not the exact quote of the futures-based index.
 */

export type SyntheticId = 'DXY' | 'EURX'

export interface SyntheticDef {
  id: SyntheticId
  constant: number
  weights: Readonly<Record<string, number>>
}

export const SYNTHETICS: Readonly<Record<SyntheticId, SyntheticDef>> = {
  DXY: {
    id: 'DXY',
    constant: 50.14348112,
    weights: { EURUSD: -0.576, USDJPY: 0.136, GBPUSD: -0.119, USDCAD: 0.091, USDSEK: 0.042, USDCHF: 0.036 }
  },
  EURX: {
    id: 'EURX',
    constant: 34.38805726,
    weights: { EURUSD: 0.3155, EURGBP: 0.3056, EURJPY: 0.1891, EURCHF: 0.1113, EURSEK: 0.0785 }
  }
}

export function syntheticComponents(id: SyntheticId): string[] {
  return Object.keys(SYNTHETICS[id].weights)
}

/** Index value from component prices; null when a component is missing. */
export function syntheticValue(id: SyntheticId, prices: Readonly<Record<string, number | undefined>>): number | null {
  const def = SYNTHETICS[id]
  let v = def.constant
  for (const [sym, w] of Object.entries(def.weights)) {
    const p = prices[sym]
    if (p === undefined || !(p > 0)) return null
    v *= Math.pow(p, w)
  }
  return v
}
