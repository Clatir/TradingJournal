/**
 * Approximate PIT-38 summary (1.5.0) of closed trades in a period by the closing date (Warsaw): income = Σ of the
 * profits, costs = Σ of the losses (net results, so commission and swap included), each converted to PLN at the NBP
 * average rate of the last business day before the closing (art. 11a of the PIT act). Only amounts the journal has
 * (typed, R × risk amount, from the lots) – never estimates. Not a replacement for the broker's PIT-8C.
 */
import { rateFor } from '../fx'
import { historicalRate, transactionDate } from '../fxHistory'
import type { JournalFile } from '../schema'
import { closedTrades, type AnalyzedTrade } from './analytics'
import { inRange, type DateRange } from './periods'

export interface TaxTrade {
  /** Closing date (Warsaw). */
  date: string
  pair: string
  amount: number
  currency: string
  /** Rate to PLN (1 for PLN), the NBP table date; null table = today's rate (approximate). */
  rate: number
  rateDate: string | null
  pln: number
}

export interface TaxSummary {
  range: DateRange
  income: number
  costs: number
  /** income − costs. */
  result: number
  trades: TaxTrade[]
  byMonth: Array<{ month: string; income: number; costs: number; result: number; trades: number }>
  /** Converted at today's rate: no NBP table of the day before the closing in the archive. */
  approximate: number
  /** Left out: no amount at all / no rate to PLN. */
  noAmount: number
  withoutRate: number
  missingRates: string[]
}

export function taxSummary(rows: readonly AnalyzedTrade[], journal: Pick<JournalFile, 'settings'>, range: DateRange): TaxSummary {
  const out: TaxSummary = { range, income: 0, costs: 0, result: 0, trades: [], byMonth: [], approximate: 0, noAmount: 0, withoutRate: 0, missingRates: [] }
  const missing = new Set<string>()
  const months = new Map<string, { income: number; costs: number; trades: number }>()
  const list = closedTrades(rows)
    .map((r) => ({ r, date: transactionDate(r.trade) }))
    .filter((x) => inRange(x.date, range))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  for (const { r, date } of list) {
    const amount = r.m.pnlAmountOwn
    if (amount == null) {
      out.noAmount++
      continue
    }
    const currency = r.m.amountCurrency ?? journal.settings.risk.accountCurrency
    let rate = 1
    let rateDate: string | null = date
    if (currency !== 'PLN') {
      const h = historicalRate(currency, 'PLN', date, journal.settings)
      if (h) {
        rate = h.rate
        rateDate = h.tableDate
      } else {
        const c = rateFor(currency, 'PLN', journal.settings)
        if (!c) {
          out.withoutRate++
          missing.add(currency)
          continue
        }
        rate = c.rate
        rateDate = null
        out.approximate++
      }
    }
    const pln = Math.round(amount * rate * 100) / 100
    out.trades.push({ date, pair: r.trade.pair, amount, currency, rate, rateDate: currency === 'PLN' ? null : rateDate, pln })
    const m = months.get(date.slice(0, 7)) ?? { income: 0, costs: 0, trades: 0 }
    if (pln >= 0) {
      out.income += pln
      m.income += pln
    } else {
      out.costs += -pln
      m.costs += -pln
    }
    m.trades++
    months.set(date.slice(0, 7), m)
  }
  out.income = Math.round(out.income * 100) / 100
  out.costs = Math.round(out.costs * 100) / 100
  out.result = Math.round((out.income - out.costs) * 100) / 100
  out.byMonth = [...months.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, m]) => ({ month, income: m.income, costs: m.costs, result: m.income - m.costs, trades: m.trades }))
  out.missingRates = [...missing].sort()
  return out
}
