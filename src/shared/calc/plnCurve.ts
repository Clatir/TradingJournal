/**
 * Earnings curve in PLN (analytics): the cumulative money result of closed trades in PLN, in the order of closing.
 * Each trade's own amount (typed, R × risk amount, or from the lots) is converted like in the monthly report – at the
 * NBP table of the day before the closing, else today's rate. Trades without amounts can be estimated as
 * R × risk % × account balance (marked); trades with neither, or without a rate to PLN, are left out and counted.
 */
import { rateFor } from '../fx'
import { historicalRate, transactionDate } from '../fxHistory'
import { resultInPln } from '../export/monthlyReport'
import { estimateAmount } from '../journalView'
import type { JournalFile } from '../schema'
import { closedTrades, type AnalyzedTrade } from './analytics'

export interface PlnPoint {
  /** UNIX seconds, strictly increasing (lightweight-charts). */
  time: number
  /** Cumulative result in PLN. */
  equity: number
  /** Distance below the highest equity so far (≤ 0). */
  drawdown: number
  /** This trade's result in PLN. */
  pln: number
  tradeId: string
  estimated: boolean
}

export interface PlnCurve {
  points: PlnPoint[]
  total: number
  /** Deepest fall from a peak (≥ 0). */
  maxDrawdown: number
  best: number | null
  worst: number | null
  avgWin: number | null
  avgLoss: number | null
  /** Closed trades in the range, and how their PLN result was found. */
  closed: number
  exact: number
  estimated: number
  /** Converted at the NBP table of the day before the closing / at today's rate. */
  historical: number
  current: number
  /** Left out: no amount (nor an estimate), or no rate to PLN. */
  noAmount: number
  withoutRate: number
  missingRates: string[]
}

const closeTime = (r: AnalyzedTrade) => r.m.exitTime ?? r.trade.entryTime

/** Amount in `currency` → PLN at the table of the day before the closing, else today's rate. */
function toPln(amount: number, currency: string, r: AnalyzedTrade, journal: Pick<JournalFile, 'settings'>): { pln: number; rate: 'none' | 'historical' | 'current' } | null {
  if (currency === 'PLN') return { pln: amount, rate: 'none' }
  const historical = historicalRate(currency, 'PLN', transactionDate(r.trade), journal.settings)
  if (historical) return { pln: amount * historical.rate, rate: 'historical' }
  const current = rateFor(currency, 'PLN', journal.settings)
  return current ? { pln: amount * current.rate, rate: 'current' } : null
}

export function plnCurve(rows: readonly AnalyzedTrade[], journal: Pick<JournalFile, 'settings'>, opts: { estimates: boolean }): PlnCurve {
  const closed = [...closedTrades(rows)].sort((a, b) => {
    const ta = closeTime(a)
    const tb = closeTime(b)
    return ta < tb ? -1 : ta > tb ? 1 : a.trade.id < b.trade.id ? -1 : 1
  })
  const out: PlnCurve = {
    points: [],
    total: 0,
    maxDrawdown: 0,
    best: null,
    worst: null,
    avgWin: null,
    avgLoss: null,
    closed: closed.length,
    exact: 0,
    estimated: 0,
    historical: 0,
    current: 0,
    noAmount: 0,
    withoutRate: 0,
    missingRates: []
  }
  const missing = new Set<string>()
  let equity = 0
  let peak = 0
  let last = -Infinity
  const wins: number[] = []
  const losses: number[] = []
  for (const r of closed) {
    let pln: number
    let estimated = false
    let rate: 'none' | 'historical' | 'current'
    const own = resultInPln(r, journal)
    if (own.hasAmount) {
      if (own.pln == null) {
        out.withoutRate++
        if (own.currency) missing.add(own.currency)
        continue
      }
      pln = own.pln
      rate = own.rate ?? 'none'
    } else {
      const estimate = opts.estimates ? estimateAmount(r.trade, r.m, journal.settings.risk) : null
      if (estimate == null) {
        out.noAmount++
        continue
      }
      const converted = toPln(estimate, journal.settings.risk.accountCurrency, r, journal)
      if (!converted) {
        out.withoutRate++
        missing.add(journal.settings.risk.accountCurrency)
        continue
      }
      pln = converted.pln
      rate = converted.rate
      estimated = true
    }
    if (estimated) out.estimated++
    else out.exact++
    if (rate === 'historical') out.historical++
    else if (rate === 'current') out.current++
    equity += pln
    peak = Math.max(peak, equity)
    out.maxDrawdown = Math.max(out.maxDrawdown, peak - equity)
    let t = Math.floor(Date.parse(closeTime(r)) / 1000)
    if (t <= last) t = last + 1
    last = t
    out.points.push({ time: t, equity, drawdown: equity - peak, pln, tradeId: r.trade.id, estimated })
    out.best = out.best == null ? pln : Math.max(out.best, pln)
    out.worst = out.worst == null ? pln : Math.min(out.worst, pln)
    if (pln > 0) wins.push(pln)
    else if (pln < 0) losses.push(pln)
  }
  out.total = equity
  out.avgWin = wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : null
  out.avgLoss = losses.length ? losses.reduce((a, b) => a + b, 0) / losses.length : null
  out.missingRates = [...missing].sort()
  return out
}
