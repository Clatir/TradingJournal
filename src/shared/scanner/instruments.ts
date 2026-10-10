/**
 * Scanner instrument presets: pip, price decimals, contract and the EODHD symbols. The journal's own pair presets
 * (shared/pairs.ts) have no gold, so the scanner keeps its own (XAUUSD: pip 0.1 USD, 100 oz per lot).
 */

export interface InstrumentPreset {
  /** EODHD WebSocket symbol (forex stream), e.g. EURUSD, XAUUSD, WTIUSD. Also the instrument id. */
  symbol: string
  /** Short display name. */
  label: string
  /** EODHD REST code for intraday history, null when EODHD has none (WTIUSD: stream only + TradingView CSV). */
  rest: string | null
  pipSize: number
  priceDecimals: number
  /** Units per 1.00 lot. */
  contractSize: number
  quoteCurrency: string
  /** Own maximum stop in pips; null = the scanner-wide FX value. */
  maxStopPips: number | null
}

const OIL = /^(WTI|XTI|USOIL|OIL|BRENT|XBR|UKOIL)/

/** Preset for a symbol from the EODHD forex list (6-letter pairs, metals, WTIUSD). */
export function instrumentPreset(symbol: string): InstrumentPreset {
  const s = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (s === 'XAUUSD') {
    return { symbol: s, label: 'XAUUSD', rest: 'XAUUSD.FOREX', pipSize: 0.1, priceDecimals: 3, contractSize: 100, quoteCurrency: 'USD', maxStopPips: 650 }
  }
  if (s === 'XAGUSD') {
    return { symbol: s, label: 'XAGUSD', rest: 'XAGUSD.FOREX', pipSize: 0.01, priceDecimals: 4, contractSize: 5000, quoteCurrency: 'USD', maxStopPips: null }
  }
  if (OIL.test(s)) {
    // EODHD streams WTIUSD but has no history for it (docs/skaner/rozpoznanie.md 3.3).
    const wti = s.startsWith('WTI') || s.startsWith('XTI') || s.startsWith('USOIL')
    return {
      symbol: s,
      label: wti ? 'WTI' : s,
      rest: s === 'WTIUSD' ? null : `${s}.FOREX`,
      pipSize: 0.01,
      priceDecimals: 3,
      contractSize: 1000,
      quoteCurrency: 'USD',
      maxStopPips: null
    }
  }
  const quote = s.length === 6 ? s.slice(3) : 'USD'
  const jpy = quote === 'JPY'
  return {
    symbol: s,
    label: s,
    rest: `${s}.FOREX`,
    pipSize: jpy ? 0.01 : 0.0001,
    priceDecimals: jpy ? 3 : 5,
    contractSize: 100000,
    quoteCurrency: quote,
    maxStopPips: null
  }
}

/** Starting list from the specification (section 2). */
export const START_INSTRUMENTS = ['AUDUSD', 'EURAUD', 'EURGBP', 'EURUSD', 'USDCHF', 'XAUUSD', 'WTIUSD'] as const

/** The pair that converts between a currency and USD, in market convention (EURUSD, GBPUSD, USDPLN, USDJPY…). */
export function usdPair(currency: string): string | null {
  const c = currency.toUpperCase()
  if (c === 'USD') return null
  return ['EUR', 'GBP', 'AUD', 'NZD', 'XAU'].includes(c) ? `${c}USD` : `USD${c}`
}
