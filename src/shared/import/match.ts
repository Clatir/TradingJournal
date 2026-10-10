/**
 * Matching broker positions to journal entries and applying them: same pair (broker symbol without suffixes),
 * same direction, entry time within a tolerance (nearest first, one to one). A position already linked by ticket
 * is "imported" – or matched again when it changed at the broker since (closed, another partial). Applying fills the entry's empty fields (or overwrites them on request) and keeps the broker's
 * numbers in `trade.broker`; an unmatched position can become a new closed entry.
 */
import { DateTime } from 'luxon'
import { createTrade } from '../defaults'
import { newId } from '../ids'
import { rateFor } from '../fx'
import { lotValueFor } from '../instruments'
import type { BrokerFill, Settings, Trade, TradeExit } from '../schema'
import type { BrokerExit, BrokerTrade } from './broker'

/**
 * Zone of the file's times: MetaTrader servers mostly run on New York time + 7 h (GMT+2 / +3 with the US DST
 * switch, so the day closes at 17:00 NY); XTB writes Polish time.
 */
export type BrokerZone = 'mt' | 'Europe/Warsaw' | 'UTC'

export const BROKER_ZONES: Array<{ value: BrokerZone; label: string }> = [
  { value: 'mt', label: 'Serwer MT (NY + 7 h)' },
  { value: 'Europe/Warsaw', label: 'Warszawa' },
  { value: 'UTC', label: 'UTC' }
]

/** Wall clock of the file → UTC ISO ("…Z"); null when the time does not exist. */
export function brokerTimeToUtc(wall: string, zone: BrokerZone): string | null {
  let dt: DateTime
  if (zone === 'mt') {
    const ny = DateTime.fromISO(wall, { zone: 'UTC' }).minus({ hours: 7 })
    dt = DateTime.fromObject({ year: ny.year, month: ny.month, day: ny.day, hour: ny.hour, minute: ny.minute, second: ny.second }, { zone: 'America/New_York' })
  } else dt = DateTime.fromISO(wall, { zone })
  return dt.isValid ? dt.toUTC().toISO({ suppressMilliseconds: false }) : null
}

const alnum = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')

/** Broker symbol → journal pair: "EURUSD.pro", "EURUSDm", "#EURUSD" → "EURUSD" (exact, prefix, then contained). */
export function pairForSymbol(symbol: string, pairs: readonly string[]): string | null {
  const s = alnum(symbol)
  if (!s) return null
  const list = [...pairs].sort((a, b) => alnum(b).length - alnum(a).length)
  return (
    list.find((p) => alnum(p) === s) ??
    list.find((p) => alnum(p).length >= 3 && s.startsWith(alnum(p))) ??
    list.find((p) => alnum(p).length >= 3 && s.includes(alnum(p))) ??
    null
  )
}

export type MatchStatus = 'matched' | 'imported' | 'new' | 'unknown-symbol' | 'bad-time'

export interface BrokerMatch {
  index: number
  broker: BrokerTrade
  pair: string | null
  openUtc: string | null
  closeUtc: string | null
  status: MatchStatus
  /** Journal entry (matched or already linked by ticket). */
  tradeId: string | null
  /** Entry time difference in minutes (journal − broker). */
  diffMinutes: number | null
}

export interface MatchResult {
  matches: BrokerMatch[]
  /** Journal entries (not missed) between the first and the last broker position without a position. */
  journalOnly: Trade[]
}

export function matchBrokerTrades(
  positions: readonly BrokerTrade[],
  trades: readonly Trade[],
  pairs: readonly string[],
  opts: { zone: BrokerZone; toleranceMinutes: number }
): MatchResult {
  const byTicket = new Map<string, Trade>()
  // "wiersz N" (row number, imports before 1.7.3 without a ticket column) is no key: another file has other rows.
  for (const t of trades) for (const k of t.broker?.tickets ?? []) if (!/^wiersz \d+$/.test(k)) byTicket.set(k, t)
  const matches: BrokerMatch[] = positions.map((b, index) => {
    const openUtc = brokerTimeToUtc(b.openTime, opts.zone)
    const closeUtc = b.closeTime ? brokerTimeToUtc(b.closeTime, opts.zone) : null
    const pair = pairForSymbol(b.symbol, pairs)
    const linked = b.tickets.map((k) => byTicket.get(k)).find(Boolean)
    const base = { index, broker: b, pair, openUtc, closeUtc, tradeId: null, diffMinutes: null }
    if (linked) {
      const diffMinutes = openUtc ? minutes(linked.entryTime, openUtc) : null
      // Imported while still open (or before the last partial) and closed since: fill it again.
      const changed = linked.broker!.closeTime !== closeUtc || linked.broker!.net !== b.net || linked.broker!.volume !== b.volume
      return { ...base, status: changed ? 'matched' : 'imported', tradeId: linked.id, diffMinutes }
    }
    if (!openUtc) return { ...base, status: 'bad-time' }
    if (!pair) return { ...base, status: 'unknown-symbol' }
    return { ...base, status: 'new' }
  })

  // Candidates: same pair and direction, within the tolerance, entry not linked to a position yet; nearest first.
  const free = trades.filter((t) => t.status !== 'missed' && !t.broker?.tickets.length)
  const candidates: Array<{ m: BrokerMatch; t: Trade; diff: number }> = []
  for (const m of matches) {
    if (m.status !== 'new') continue
    for (const t of free) {
      if (t.pair !== m.pair || t.direction !== m.broker.direction) continue
      const diff = minutes(t.entryTime, m.openUtc!)
      if (Math.abs(diff) <= opts.toleranceMinutes) candidates.push({ m, t, diff })
    }
  }
  candidates.sort((a, b) => Math.abs(a.diff) - Math.abs(b.diff) || a.m.index - b.m.index)
  const used = new Set<string>()
  for (const c of candidates) {
    if (c.m.status !== 'new' || used.has(c.t.id)) continue
    c.m.status = 'matched'
    c.m.tradeId = c.t.id
    c.m.diffMinutes = c.diff
    used.add(c.t.id)
  }

  const linkedIds = new Set(matches.map((m) => m.tradeId).filter(Boolean))
  const times = matches.map((m) => m.openUtc).filter((x): x is string => !!x).sort()
  const from = times[0]
  const to = matches
    .map((m) => m.closeUtc ?? m.openUtc)
    .filter((x): x is string => !!x)
    .sort()
    .at(-1)
  const journalOnly =
    from && to
      ? trades
          .filter((t) => t.status !== 'missed' && !linkedIds.has(t.id) && !t.broker?.tickets.length && t.entryTime >= from && t.entryTime <= to)
          .sort((a, b) => (a.entryTime < b.entryTime ? -1 : 1))
      : []
  return { matches, journalOnly }
}

function minutes(a: string, b: string): number {
  return Math.round((Date.parse(a) - Date.parse(b)) / 60_000)
}

export interface ApplyOptions {
  /** Currency of the broker's amounts (the broker account). */
  currency: string
  /** Currency of entry amounts saved without `amountCurrency` (`risk.legacyAmountCurrency` ?? account currency). */
  defaultAmountCurrency: string
  /** Overwrite prices, exits, lots and the result instead of filling only the empty ones. */
  overwrite: boolean
  now: string
}

function brokerFill(m: BrokerMatch, opts: ApplyOptions): BrokerFill {
  const b = m.broker
  return {
    tickets: [...b.tickets],
    symbol: b.symbol,
    volume: b.volume,
    openTime: m.openUtc,
    closeTime: m.closeUtc,
    openPrice: b.openPrice,
    closePrice: b.closePrice,
    profit: b.profit,
    commission: b.commission,
    swap: b.swap,
    net: b.net,
    currency: opts.currency,
    importedAt: opts.now
  }
}

const REASON_NOTE: Record<NonNullable<BrokerExit['reason']>, string> = { tp: 'TP', sl: 'SL', so: 'stop out' }

/**
 * Exits from the broker's partial closes: share of the volume (2 places, the last one takes the rest); the note says
 * what closed it at the broker ("TP", "SL").
 */
function brokerExits(m: BrokerMatch, zone: (wall: string) => string | null): TradeExit[] {
  const b = m.broker
  let left = 100
  return b.exits.map((x, i) => {
    const percent = i === b.exits.length - 1 ? Number(left.toFixed(2)) : Number(((x.volume / b.volume) * 100).toFixed(2))
    left -= percent
    return { id: newId(), time: zone(x.time), price: x.price, percent, note: x.reason ? REASON_NOTE[x.reason] : '' }
  })
}

/** The broker's comment without the close reason tags ("[T/P]"), for the entry's notes. */
function commentText(comment: string): string {
  return comment.replace(/\[\s*(t\s*\/?\s*p|s\s*\/?\s*l|so)\s*\]/gi, '').trim()
}

/** A stop on the losing side of the entry; a stop moved to BE or into profit says nothing about the risk. */
function initialStop(b: BrokerTrade): number | null {
  if (b.stopLoss == null) return null
  return b.direction === 'long' ? (b.stopLoss < b.openPrice ? b.stopLoss : null) : b.stopLoss > b.openPrice ? b.stopLoss : null
}

export interface ApplyNote {
  /** The result was not set because the entry's amounts are in another currency. */
  currencyConflict: boolean
}

/** The entry with the broker's position applied. */
export function applyBrokerMatch(trade: Trade, m: BrokerMatch, opts: ApplyOptions & { zone: BrokerZone }): { trade: Trade; note: ApplyNote } {
  const b = m.broker
  const ow = opts.overwrite
  // Values an earlier import wrote (the position has changed at the broker since) count as empty.
  const prev = trade.broker
  const lastExit = trade.exits
    .map((x) => x.time)
    .filter(Boolean)
    .sort()
    .at(-1)
  const exitsEmpty = trade.exits.every((x) => x.price == null) || (prev?.closeTime != null && lastExit === prev.closeTime)
  const lotsEmpty = trade.lots == null || (prev != null && trade.lots === prev.volume)
  const resultEmpty = trade.pnlAmountOverride == null || (prev?.net != null && trade.pnlAmountOverride === Number(prev.net.toFixed(2)))
  const prices = {
    ...trade.prices,
    entry: ow || trade.prices.entry == null ? b.openPrice : trade.prices.entry,
    stopLoss: trade.prices.stopLoss ?? initialStop(b),
    takeProfit1: trade.prices.takeProfit1 ?? b.takeProfit
  }
  const closed = m.closeUtc != null && b.exits.length > 0
  const exits = closed && (ow || exitsEmpty) ? brokerExits(m, (w) => brokerTimeToUtc(w, opts.zone)) : trade.exits
  // The result in money: the broker's net, in the broker account's currency. The entry's amounts share one currency
  // (`amountCurrency`), so a typed risk amount in another currency keeps the result as it is.
  const riskInOther = trade.riskAmount != null && (trade.amountCurrency ?? opts.defaultAmountCurrency) !== opts.currency
  const setResult = b.net != null && closed && (ow || resultEmpty) && !riskInOther
  const next: Trade = {
    ...trade,
    status: trade.status === 'open' && closed ? 'closed' : trade.status,
    prices,
    exits,
    lots: ow || lotsEmpty ? b.volume : trade.lots,
    pnlAmountOverride: setResult ? Number(b.net!.toFixed(2)) : trade.pnlAmountOverride,
    amountCurrency: setResult ? opts.currency : trade.amountCurrency,
    broker: brokerFill(m, opts),
    updatedAt: opts.now
  }
  return { trade: next, note: { currencyConflict: b.net != null && closed && riskInOther } }
}

/** A new closed (or open) entry from an unmatched position; null without a pair or a valid time. */
export function tradeFromBroker(m: BrokerMatch, opts: ApplyOptions & { zone: BrokerZone }): Trade | null {
  if (!m.pair || !m.openUtc) return null
  const b = m.broker
  const closed = m.closeUtc != null && b.exits.length > 0
  return createTrade(
    {
      pair: m.pair,
      direction: b.direction,
      entryTime: m.openUtc,
      status: closed ? 'closed' : 'open',
      prices: { entry: b.openPrice, stopLoss: initialStop(b), takeProfit1: b.takeProfit, takeProfit2: null },
      exits: closed ? brokerExits(m, (w) => brokerTimeToUtc(w, opts.zone)) : [{ id: newId(), time: null, price: null, percent: 100, note: '' }],
      lots: b.volume,
      pnlAmountOverride: closed && b.net != null ? Number(b.net.toFixed(2)) : null,
      amountCurrency: opts.currency,
      notes: commentText(b.comment) ? `Import od brokera: ${commentText(b.comment)}` : '',
      broker: brokerFill(m, opts)
    },
    opts.now
  )
}

/**
 * The currency of the file's amounts when the file does not say (XTB writes amounts in the account's currency without
 * naming it): the gross result of each closed position compared with price move × lots × contract size, converted
 * from the quote currency with the journal's rates (today's: a few % off, far less than between currencies). The
 * candidate whose median ratio is within 8% of 1 – and clearly the best – wins; null when unsure.
 */
export function guessBrokerCurrency(
  positions: readonly BrokerTrade[],
  pairs: readonly string[],
  settings: Pick<Settings, 'pairs' | 'instruments' | 'risk' | 'fx'>
): string | null {
  const moves: Array<{ quote: string; units: number; amount: number }> = []
  for (const b of positions) {
    const amount = b.profit ?? (b.net != null ? b.net - b.commission - b.swap : null)
    const pair = pairForSymbol(b.symbol, pairs)
    if (amount == null || b.closePrice == null || !pair) continue
    const lot = lotValueFor(pair, settings)
    const units = (b.closePrice - b.openPrice) * (b.direction === 'long' ? 1 : -1) * b.volume * (lot?.contractSize ?? 0)
    if (!lot || Math.abs(units) < 1e-9 || Math.abs(amount) < 0.01) continue
    moves.push({ quote: lot.quoteCurrency, units, amount })
  }
  if (!moves.length) return null
  const candidates = [...new Set([settings.risk.accountCurrency, 'PLN', 'USD', 'EUR', 'GBP', 'CHF', ...moves.map((x) => x.quote)])]
  const scored = candidates
    .map((cur) => {
      const errors = moves
        .map((x) => {
          const rate = rateFor(x.quote, cur, settings)?.rate
          return rate ? Math.abs(x.amount / (x.units * rate) - 1) : null
        })
        .filter((e): e is number => e != null)
        .sort((a, b) => a - b)
      return { cur, error: errors.length * 2 >= moves.length ? errors[Math.floor(errors.length / 2)]! : Infinity }
    })
    .sort((a, b) => a.error - b.error)
  const [best, second] = scored
  return best && best.error <= 0.08 && (!second || second.error >= best.error + 0.04) ? best.cur : null
}
