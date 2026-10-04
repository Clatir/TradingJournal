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
    accountCurrency: next,
    conversionRates: restored?.conversionRates ?? {},
    pipValuesPerLot: restored?.pipValuesPerLot ?? {},
    byAccountCurrency
  }
}
