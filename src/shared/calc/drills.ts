/**
 * Drill cards (1.4.0): the "before" screen of a past trade – or, from 1.11.0, the market chart up to the entry – the
 * answer (long / short / stay out, optional SL guess), then the reveal (the chart replays what came next). Pure
 * functions: which trades can be cards, which to show next, scoring and accuracy over time.
 */
import { DateTime } from 'luxon'
import type { DrillAnswer, DrillCard, DrillSession, DrillTruth, Trade } from '../schema'
import { levelsWindow, sessionDateOf } from './marketLevels'
import { missedHorizon } from './marketStats'
import { tradingDateNy } from './time'
import type { TradeMetrics } from './trade'
import { whatIfHorizon } from './whatIf'

export interface DrillRow {
  trade: Trade
  m: TradeMetrics
}

/** An SL guess is "close" within max(2 pips, 25% of the real stop). */
export const SL_CLOSE_PIPS = 2
export const SL_CLOSE_SHARE = 0.25

export const ANSWER_LABEL: Record<DrillAnswer, string> = { long: 'Long', short: 'Short', skip: 'Nie wchodzę' }

export type DrillSource = 'screen' | 'chart'
/** Which cards a session takes: any, only with a "before" screen, only with market bars. */
export type DrillSourceFilter = 'all' | DrillSource
export const SOURCE_LABEL: Record<DrillSource, string> = { screen: 'Screen „przed”', chart: 'Wykres (dane rynkowe)' }

export const hasBeforeScreen = (t: Trade): boolean => t.screens.some((s) => s.phase === 'before')

/**
 * The trade's market bars were measured (so they are in `.market/` of the folder, also offline): the card can be
 * the chart up to the entry.
 */
export function hasMarketChart(t: Trade): boolean {
  const mk = t.market
  return !!mk && !!mk.ticker && t.prices.entry != null && (mk.maePips != null || mk.missed != null)
}

/** With a known outcome (closed with a result, or missed with a hypothetical one). */
export function hasOutcome(r: DrillRow): boolean {
  return r.trade.status !== 'open' && r.m.resultR != null && r.m.outcome != null
}

/** A card needs a known outcome and something to look at: a "before" screen or the market chart. */
export function isDrillable(r: DrillRow, source: DrillSourceFilter = 'all'): boolean {
  if (!hasOutcome(r)) return false
  const screen = hasBeforeScreen(r.trade)
  const chart = hasMarketChart(r.trade)
  return source === 'screen' ? screen : source === 'chart' ? chart : screen || chart
}

/** What a card shows first: the chart when asked for or without a "before" screen. */
export function cardSource(t: Trade, filter: DrillSourceFilter): DrillSource {
  return filter === 'chart' || (filter === 'all' && !hasBeforeScreen(t) && hasMarketChart(t)) ? 'chart' : 'screen'
}

const MIN_MS = 60_000

/**
 * Bars of a chart card: from the previous week (levels of the day known before the entry) to the end of the replay –
 * 17:00 NY of the trading day (or the exit when later), for a missed trade its horizon. The entry's minute is the
 * first hidden one (it was forming when the decision was made).
 */
export function drillReplayWindow(t: Trade): { fromMs: number; entryMs: number; toMs: number } | null {
  const entry = Date.parse(t.entryTime)
  if (!Number.isFinite(entry)) return null
  const to = t.status === 'closed' ? whatIfHorizon(t) : t.status === 'missed' ? missedHorizon(t) : null
  const entryMs = Math.floor(entry / MIN_MS) * MIN_MS
  if (to == null || to <= entryMs) return null
  return { fromMs: levelsWindow(sessionDateOf(t.entryTime)).fromMs, entryMs, toMs: to }
}

/** The SL guess from a price picked on the chart: distance from the entry in pips (0.1). */
export function slPipsFromPrice(entry: number, price: number, pipSize: number): number | null {
  if (!(pipSize > 0) || !Number.isFinite(price)) return null
  const pips = Math.round((Math.abs(entry - price) / pipSize) * 10) / 10
  return pips > 0 ? pips : null
}

export function truthOf(r: DrillRow): DrillTruth | null {
  if (r.trade.status === 'open') return null
  return { direction: r.trade.direction, status: r.trade.status, resultR: r.m.resultR, outcome: r.m.outcome, riskPips: r.m.riskPips }
}

export interface CardScore {
  /** Direction read correctly; null when the answer was "stay out". */
  direction: boolean | null
  /** Decision against the outcome: a winner should be taken in its direction, a loser left alone; breakeven is not scored. */
  decision: boolean | null
  /** |guess − real stop| in pips; null without a guess or a real stop. */
  slError: number | null
  slClose: boolean | null
}

export function scoreCard(c: DrillCard): CardScore | null {
  if (!c.answer || !c.truth) return null
  const t = c.truth
  const direction = c.answer === 'skip' ? null : c.answer === t.direction
  const decision = t.outcome === 'win' ? c.answer === t.direction : t.outcome === 'loss' ? c.answer === 'skip' : null
  const slError = c.slPips != null && t.riskPips != null ? Math.abs(c.slPips - t.riskPips) : null
  const slClose = slError == null ? null : slError <= Math.max(SL_CLOSE_PIPS, SL_CLOSE_SHARE * (t.riskPips ?? 0)) + 1e-9
  return { direction, decision, slError, slClose }
}

export interface Tally {
  answered: number
  directionN: number
  directionOk: number
  decisionN: number
  decisionOk: number
  slN: number
  slErrorSum: number
  slClose: number
}

const emptyTally = (): Tally => ({ answered: 0, directionN: 0, directionOk: 0, decisionN: 0, decisionOk: 0, slN: 0, slErrorSum: 0, slClose: 0 })

function add(t: Tally, s: CardScore): void {
  t.answered++
  if (s.direction != null) {
    t.directionN++
    if (s.direction) t.directionOk++
  }
  if (s.decision != null) {
    t.decisionN++
    if (s.decision) t.decisionOk++
  }
  if (s.slError != null) {
    t.slN++
    t.slErrorSum += s.slError
    if (s.slClose) t.slClose++
  }
}

export function tally(cards: readonly DrillCard[]): Tally {
  const t = emptyTally()
  for (const c of cards) {
    const s = scoreCard(c)
    if (s) add(t, s)
  }
  return t
}

export const ratio = (ok: number, n: number): number | null => (n ? ok / n : null)

export interface DrillStats {
  total: Tally
  /** Distinct trades answered at least once. */
  tradesSeen: number
  /** Calendar months (NY date of the answer), oldest first. */
  months: Array<{ month: string; tally: Tally }>
  pairs: Array<{ pair: string; tally: Tally }>
  /** Cards answered on a screen / on the chart (only sources with answers). */
  sources: Array<{ source: DrillSource; tally: Tally }>
}

export function drillStats(sessions: readonly DrillSession[]): DrillStats {
  const total = emptyTally()
  const months = new Map<string, Tally>()
  const pairs = new Map<string, Tally>()
  const sources = new Map<DrillSource, Tally>()
  const seen = new Set<string>()
  for (const session of sessions)
    for (const c of session.cards) {
      const s = scoreCard(c)
      if (!s || !c.answeredAt) continue
      add(total, s)
      seen.add(c.tradeId)
      const month = tradingDateNy(c.answeredAt).slice(0, 7)
      add(months.get(month) ?? months.set(month, emptyTally()).get(month)!, s)
      add(pairs.get(c.pair) ?? pairs.set(c.pair, emptyTally()).get(c.pair)!, s)
      const src = c.source ?? 'screen'
      add(sources.get(src) ?? sources.set(src, emptyTally()).get(src)!, s)
    }
  return {
    total,
    tradesSeen: seen.size,
    months: [...months].sort(([a], [b]) => (a < b ? -1 : 1)).map(([month, tally]) => ({ month, tally })),
    pairs: [...pairs].sort((a, b) => b[1].answered - a[1].answered || (a[0] < b[0] ? -1 : 1)).map(([pair, tally]) => ({ pair, tally })),
    sources: (['screen', 'chart'] as const).filter((x) => sources.has(x)).map((source) => ({ source, tally: sources.get(source)! }))
  }
}

export interface CardHistory {
  count: number
  lastAt: string
  /** The last answer was wrong (decision, or direction when the decision is not scored). */
  lastWrong: boolean
}

/** Per trade: how often it was answered, when last, and whether the last answer was wrong. */
export function cardHistory(sessions: readonly DrillSession[]): Map<string, CardHistory> {
  const out = new Map<string, CardHistory>()
  for (const session of sessions)
    for (const c of session.cards) {
      const s = scoreCard(c)
      if (!s || !c.answeredAt) continue
      const prev = out.get(c.tradeId)
      const wrong = s.decision != null ? !s.decision : s.direction === false
      if (!prev) out.set(c.tradeId, { count: 1, lastAt: c.answeredAt, lastWrong: wrong })
      else {
        prev.count++
        if (c.answeredAt > prev.lastAt) {
          prev.lastAt = c.answeredAt
          prev.lastWrong = wrong
        }
      }
    }
  return out
}

export interface DrillPickOptions {
  count: number
  /** Only this pair; null = all. */
  pair: string | null
  /** Screens, charts or both (default). */
  source?: DrillSourceFilter
  /** Skip trades from the last N days (fresh in memory). */
  minAgeDays: number
  /** Today's New York date. */
  today: string
  /** Uniform [0, 1) source (Math.random in the app, seeded in tests). */
  random: () => number
}

/** Trades that can be cards with the filters (pair, age). */
export function drillCandidates(rows: readonly DrillRow[], opts: Pick<DrillPickOptions, 'pair' | 'minAgeDays' | 'today' | 'source'>): DrillRow[] {
  const cutoff = DateTime.fromISO(opts.today).minus({ days: opts.minAgeDays }).toISODate() ?? opts.today
  return rows.filter((r) => isDrillable(r, opts.source) && (!opts.pair || r.trade.pair === opts.pair) && (opts.minAgeDays <= 0 || r.m.tradingDate <= cutoff))
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

/**
 * Trade ids for a new session: never answered first, then the ones answered wrong last time, then the ones
 * answered longest ago; the chosen cards are shown in random order.
 */
export function pickDrillCards(rows: readonly DrillRow[], sessions: readonly DrillSession[], opts: DrillPickOptions): string[] {
  const history = cardHistory(sessions)
  const fresh: DrillRow[] = []
  const wrong: DrillRow[] = []
  const rest: DrillRow[] = []
  for (const r of drillCandidates(rows, opts)) {
    const h = history.get(r.trade.id)
    if (!h) fresh.push(r)
    else if (h.lastWrong) wrong.push(r)
    else rest.push(r)
  }
  rest.sort((a, b) => (history.get(a.trade.id)!.lastAt < history.get(b.trade.id)!.lastAt ? -1 : 1))
  const chosen = [...shuffle(fresh, opts.random), ...shuffle(wrong, opts.random), ...rest].slice(0, Math.max(0, opts.count))
  return shuffle(chosen, opts.random).map((r) => r.trade.id)
}

/** The answer saved on a card, with the truth taken from the trade now. */
export function answerCard(card: DrillCard, answer: DrillAnswer, slPips: number | null, row: DrillRow | null, now: string): DrillCard {
  return { ...card, answer, slPips: slPips != null && slPips > 0 ? slPips : null, answeredAt: now, truth: row ? truthOf(row) : card.truth }
}
