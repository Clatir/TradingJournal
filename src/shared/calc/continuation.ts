/**
 * Re-opened positions: a closed trade re-entered later the same New York trading day (the close was a mistake) is
 * a continuation of it. The killzone rule follows the first entry of the chain; every other rule and the result
 * stay the re-entry's own. The re-entry is not counted against the daily number of trades (its R is).
 */
import type { Killzone } from '../schema/journal'
import type { Trade } from '../schema/trade'
import { formatClock, tradingDateNy } from './time'
import { resolveKillzones } from './trade'

export type TradeLookup = (id: string) => Trade | undefined

/** Time of the last exit with a time (the close), null when no exit has one. */
export function closeTime(trade: Trade): string | null {
  let last: string | null = null
  for (const e of trade.exits) if (e.time && (!last || e.time > last)) last = e.time
  return last
}

export type ContinuationCheck =
  | {
      ok: true
      parent: Trade
      /** The first entry of the chain (the parent, or the trade the parent continues). */
      origin: Trade
      originKillzones: string[]
      /** Every trade of the chain above this one, nearest first (for cache invalidation). */
      chain: Trade[]
    }
  | { ok: false; parent: Trade | null; reason: string; chain: Trade[] }

const MAX_DEPTH = 20

/** Whether `trade` is a valid continuation of the trade it points to; null when it points to none. */
export function continuationCheck(trade: Trade, lookup: TradeLookup, killzones: readonly Killzone[], depth = 0): ContinuationCheck | null {
  if (!trade.continuationOf) return null
  const parent = lookup(trade.continuationOf)
  if (!parent || parent.id === trade.id) return { ok: false, parent: null, reason: 'pierwotnej transakcji nie ma w dzienniku', chain: [] }
  const fail = (reason: string): ContinuationCheck => ({ ok: false, parent, reason, chain: [parent] })
  if (parent.pair !== trade.pair || parent.direction !== trade.direction) return fail('inna para albo kierunek niż pierwotna transakcja')
  if (parent.status === 'missed') return fail('pierwotna transakcja to missed trade')
  const closed = closeTime(parent)
  const windowDate = tradingDateNy(closed ?? parent.entryTime)
  if ((closed ?? parent.entryTime) > trade.entryTime) return fail('wejście przed zamknięciem pierwotnej transakcji')
  if (tradingDateNy(trade.entryTime) !== windowDate) return fail(`otwarta ponownie po dniu handlowym NY zamknięcia (${windowDate})`)
  // The parent may itself continue an earlier trade: the chain starts at the first valid entry.
  const up = depth < MAX_DEPTH ? continuationCheck(parent, lookup, killzones, depth + 1) : null
  if (up?.ok) return { ok: true, parent, origin: up.origin, originKillzones: up.originKillzones, chain: [parent, ...up.chain] }
  return { ok: true, parent, origin: parent, originKillzones: resolveKillzones(parent, killzones).map((k) => k.name), chain: [parent, ...(up?.chain ?? [])] }
}

/** Killzone rule detail for a valid continuation. */
export function continuationDetail(c: Extract<ContinuationCheck, { ok: true }>): string {
  const at = `${formatClock(c.origin.entryTime, 'NY')} NY`
  return c.originKillzones.length
    ? `kontynuacja wejścia z ${c.originKillzones.join(' + ')} (${at})`
    : `kontynuacja – pierwsze wejście (${at}) też poza killzone`
}

/**
 * The closed trade this one most likely continues: the same pair and direction, closed before this entry on the same
 * New York trading day (latest close first). Null when there is none or the trade already points to one.
 */
export function continuationCandidate(trade: Trade, trades: Iterable<Trade>): Trade | null {
  if (trade.continuationOf || trade.status === 'missed') return null
  const date = tradingDateNy(trade.entryTime)
  let best: { t: Trade; at: string } | null = null
  for (const t of trades) {
    if (t.id === trade.id || t.status !== 'closed' || t.pair !== trade.pair || t.direction !== trade.direction) continue
    if (t.continuationOf === trade.id) continue
    const at = closeTime(t)
    if (!at || at > trade.entryTime || tradingDateNy(at) !== date) continue
    if (!best || at > best.at) best = { t, at }
  }
  return best?.t ?? null
}

/** Trades that continue the given one (direct re-entries), oldest first. */
export function continuationsOf(id: string, trades: Iterable<Trade>): Trade[] {
  return [...trades].filter((t) => t.continuationOf === id).sort((a, b) => (a.entryTime < b.entryTime ? -1 : 1))
}

/** Fields of a re-entry taken over from the closed trade (a new id, times and prices are the caller's). */
export function continuationFields(parent: Trade): Partial<Trade> & Pick<Trade, 'pair' | 'direction'> {
  return {
    pair: parent.pair,
    direction: parent.direction,
    entryModelId: parent.entryModelId,
    entryPdArrayId: parent.entryPdArrayId,
    htfPdArrayId: parent.htfPdArrayId,
    liquidityTakenIds: [...parent.liquidityTakenIds],
    riskPercent: parent.riskPercent,
    tradingViewUrl: parent.tradingViewUrl,
    continuationOf: parent.id
  }
}
