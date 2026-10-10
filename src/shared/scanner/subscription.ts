/**
 * Which symbols the scanner subscribes to and why: instruments + synthetic index components + SMT partners +
 * conversion to the account currency through USD. EODHD allows 50 symbols per API key in total.
 */
import { usdPair } from './instruments'
import type { ScannerSettings } from './settings'
import { syntheticComponents, type SyntheticId } from './synthetic'
import { WS_SYMBOL_LIMIT } from './eodhd'

export type SubscriptionReason = 'instrument' | 'DXY' | 'EURX' | 'SMT' | 'conversion'

export interface SubscriptionPlan {
  symbols: string[]
  reasons: Record<string, SubscriptionReason[]>
  limit: number
  over: boolean
}

const SYNTHETIC_IDS: readonly SyntheticId[] = ['DXY', 'EURX']

export function subscriptionPlan(s: ScannerSettings, accountCurrency: string): SubscriptionPlan {
  const reasons: Record<string, SubscriptionReason[]> = {}
  const add = (sym: string | null, why: SubscriptionReason) => {
    if (!sym) return
    const list = (reasons[sym] ??= [])
    if (!list.includes(why)) list.push(why)
  }
  const enabled = s.instruments.filter((i) => i.enabled)
  const own = new Set(enabled.map((i) => i.symbol))
  for (const i of enabled) add(i.symbol, 'instrument')
  for (const id of SYNTHETIC_IDS) if (s.synthetic[id]) for (const c of syntheticComponents(id)) add(c, id)
  for (const k of s.correlations) {
    const synthetic = (x: string) => (SYNTHETIC_IDS as readonly string[]).includes(x)
    if (own.has(k.a) && !synthetic(k.b)) add(k.b, 'SMT')
    if (own.has(k.b) && !synthetic(k.a)) add(k.a, 'SMT')
  }
  // Pip value → account currency: quote → USD, then USD → account.
  for (const i of enabled) add(usdPair(i.quoteCurrency), 'conversion')
  add(usdPair(accountCurrency), 'conversion')
  const symbols = Object.keys(reasons)
  return { symbols, reasons, limit: WS_SYMBOL_LIMIT, over: symbols.length > WS_SYMBOL_LIMIT }
}
