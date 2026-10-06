/**
 * Per-pair scale (1.4.5): pip size, units in a lot and the SL limit differ for commodities (e.g. WTI: 1 pip = 0.01,
 * 1 lot = 1000 barrels) – forex defaults (0.0001, 100 000 units, 20 pips) would make every oil stop "too big".
 */
import type { PairConfig, Settings } from './schema'

/** WTI / Brent symbols as brokers write them (dots and slashes removed): OILWTI, USOIL, XTIUSD, UKOIL, BRENT… */
const OIL = /^(?:OIL|US?OIL|XTI|WTI|CL|UKOIL|XBR|BRENT)/
const OIL_ANY = /(OIL|WTI|BRENT|XTI|XBR)/

export function isOilSymbol(symbol: string): boolean {
  const s = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return OIL.test(s) || OIL_ANY.test(s)
}

export interface PairPreset {
  pipSize: number
  priceDecimals: number
  quoteCurrency: string
  tvSymbol: string
  contractSize: number | null
  /** What the preset is, for the hint next to the new pair. */
  note: string | null
}

/** Defaults for a new pair: oil (pip 0.01, 1 lot = 1000 barrels, USD), JPY pairs (pip 0.01), other forex (0.0001). */
export function pairPreset(symbol: string, quote: string | null): PairPreset {
  const sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (isOilSymbol(sym)) {
    const brent = /UKOIL|XBR|BRENT/.test(sym)
    return {
      pipSize: 0.01,
      priceDecimals: 2,
      quoteCurrency: 'USD',
      tvSymbol: brent ? 'TVC:UKOIL' : 'TVC:USOIL',
      contractSize: 1000,
      note: 'ropa: 1 pips = 0.01 USD, 1 lot = 1000 baryłek'
    }
  }
  const q = quote && /^[A-Z]{3}$/.test(quote) ? quote : sym.slice(-3)
  const jpy = q === 'JPY'
  return { pipSize: jpy ? 0.01 : 0.0001, priceDecimals: jpy ? 3 : 5, quoteCurrency: q, tvSymbol: `FX:${sym}`, contractSize: null, note: null }
}

/** An oil pair whose scale differs from the oil preset (e.g. a forex pip size typed for OILWTI). */
export function oilScaleMismatch(p: Pick<PairConfig, 'symbol' | 'pipSize' | 'contractSize'>, settings: Pick<Settings, 'risk'>): boolean {
  if (!isOilSymbol(p.symbol)) return false
  return Math.abs(p.pipSize - 0.01) > 1e-12 || (p.contractSize ?? settings.risk.contractSize) !== 1000
}

/** Units in 1.00 lot of a pair: its own value, else an instrument with the same id, else risk.contractSize. */
export function pairContractSize(pair: string, settings: Pick<Settings, 'pairs' | 'instruments' | 'risk'>): number {
  const cfg = settings.pairs.find((p) => p.symbol === pair)
  if (cfg?.contractSize) return cfg.contractSize
  return settings.instruments.find((i) => i.id === pair)?.contractSize ?? settings.risk.contractSize
}

/** The SL limit (pips) of the rule for a pair: its own value, else the general one. */
export function pairMaxStopPips(pair: string, settings: Pick<Settings, 'pairs' | 'rules'>): number {
  return settings.pairs.find((p) => p.symbol === pair)?.maxStopPips ?? settings.rules.maxStopPips.value
}
