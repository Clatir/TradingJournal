import { rateFor, type Rate } from './fx'
import type { Settings } from './schema'

type Risk = Settings['risk']

/**
 * Change the account currency. Conversion rates ("1 GBP = x account currency") and hand-entered pip
 * values are amounts in the account currency, so they are parked under the old currency and the ones of
 * the new currency come back (empty the first time) – never reinterpreted in the new currency.
 */
export function switchAccountCurrency(risk: Risk, next: string): Risk {
  const prev = risk.accountCurrency
  if (prev === next) return risk
  const byAccountCurrency = { ...risk.byAccountCurrency }
  if (Object.keys(risk.conversionRates).length || Object.keys(risk.pipValuesPerLot).length)
    byAccountCurrency[prev] = { conversionRates: risk.conversionRates, pipValuesPerLot: risk.pipValuesPerLot }
  else delete byAccountCurrency[prev]
  const restored = byAccountCurrency[next]
  delete byAccountCurrency[next]
  return {
    ...risk,
    // Trade amounts saved without a currency were in the first account currency.
    legacyAmountCurrency: risk.legacyAmountCurrency ?? prev,
    accountCurrency: next,
    conversionRates: restored?.conversionRates ?? {},
    pipValuesPerLot: restored?.pipValuesPerLot ?? {},
    byAccountCurrency
  }
}

/** Balance of the account before and after a currency change, with the rate used. */
export interface BalanceConversion {
  before: number
  after: number
  rate: Rate
}

/**
 * Account currency change as done from the calculator and the settings: `switchAccountCurrency`, plus the balance
 * converted at the rate old → new (hand-entered "OLD>NEW" or NBP), so the position size keeps its meaning. Without a
 * rate the balance stays as it was (`balance: null`) and the caller says so.
 */
export function changeAccountCurrency(settings: Pick<Settings, 'risk' | 'fx'>, next: string): { risk: Risk; balance: BalanceConversion | null } {
  const risk = settings.risk
  if (risk.accountCurrency === next) return { risk, balance: null }
  const before = risk.accountBalance
  // Before the switch: the rates typed for the old account currency are "X → old", never "old → new".
  const rate = before != null && before > 0 ? rateFor(risk.accountCurrency, next, settings) : null
  const switched = switchAccountCurrency(risk, next)
  if (before == null || !rate) return { risk: switched, balance: null }
  const after = Number((before * rate.rate).toFixed(2))
  return { risk: { ...switched, accountBalance: after }, balance: { before, after, rate } }
}

/** Currency of the calculator page and the rate from the account currency to it. */
export interface CalculatorCurrency {
  /** The currency amounts are shown in: the chosen one, or the account currency when its rate is unknown. */
  currency: string
  /** risk.calcCurrency as chosen. */
  wanted: string
  /** 1 account currency = `fromAccount` × `currency`. */
  fromAccount: number
  rateSource: Rate['source']
  /** The chosen currency has no rate yet (no NBP table, nothing typed): the page falls back to the account currency. */
  fallback: boolean
}

export function calculatorCurrency(settings: Pick<Settings, 'risk' | 'fx'>): CalculatorCurrency {
  const account = settings.risk.accountCurrency
  const wanted = settings.risk.calcCurrency
  const r = rateFor(account, wanted, settings)
  if (r) return { currency: wanted, wanted, fromAccount: r.rate, rateSource: r.source, fallback: false }
  return { currency: account, wanted, fromAccount: 1, rateSource: 'same', fallback: true }
}

