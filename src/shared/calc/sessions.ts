/**
 * Analysis sessions (1.4.0): the whole portfolio is analysed with a stopwatch, then every pair gets a decision
 * (trade / watch / reject with reasons). Time per pair = segments marked with that pair, the rest of the session split
 * evenly among its pairs (a minutes value typed for a pair wins). Rejected pairs are asked about later ("did it give a
 * good setup?"). Pure functions; the day plan holds the sessions.
 */
import { newId } from '../ids'
import type { AnalysisSession, DayPlan, PairDecision, SessionPair, Trade } from '../schema'
import type { TradeMetrics } from './trade'

const ms = (iso: string) => Date.parse(iso)
const minutesBetween = (a: string, b: string) => Math.max(0, (ms(b) - ms(a)) / 60_000)

export function isRunning(s: AnalysisSession): boolean {
  return s.segments.length > 0 && s.segments.at(-1)!.end == null
}

/** Stopped for a while, not ended. */
export function isPaused(s: AnalysisSession): boolean {
  return s.segments.length > 0 && !isRunning(s) && s.endedAt == null
}

/** Measured minutes (open segment counted up to `now`). */
export function measuredMinutes(s: AnalysisSession, now: string): number {
  return s.segments.reduce((sum, seg) => sum + minutesBetween(seg.start, seg.end ?? now), 0)
}

/** Minutes of the session: typed total, else measured. */
export function sessionMinutes(s: AnalysisSession, now: string): number {
  return s.minutesOverride ?? measuredMinutes(s, now)
}

/**
 * Minutes per pair: a typed value wins; the rest of the session is shared by the other pairs in proportion to the time
 * of the segments marked with them plus an even part of the unmarked time.
 */
export function pairMinutes(s: AnalysisSession, now: string): Map<string, number> {
  const out = new Map<string, number>()
  if (!s.pairs.length) return out
  const names = new Set(s.pairs.map((p) => p.pair))
  const marked = new Map<string, number>()
  let unmarked = 0
  for (const seg of s.segments) {
    const m = minutesBetween(seg.start, seg.end ?? now)
    if (seg.pair && names.has(seg.pair)) marked.set(seg.pair, (marked.get(seg.pair) ?? 0) + m)
    else unmarked += m
  }
  const typed = s.pairs.filter((p) => p.minutes != null)
  const auto = s.pairs.filter((p) => p.minutes == null)
  const remaining = Math.max(0, sessionMinutes(s, now) - typed.reduce((a, p) => a + (p.minutes ?? 0), 0))
  const weight = (pair: string) => (marked.get(pair) ?? 0) + unmarked / auto.length
  const weights = auto.reduce((a, p) => a + weight(p.pair), 0)
  for (const p of s.pairs) {
    if (p.minutes != null) out.set(p.pair, p.minutes)
    else out.set(p.pair, weights > 0 ? (remaining * weight(p.pair)) / weights : remaining / auto.length)
  }
  return out
}

// ------------------------------------------------------------------ stopwatch actions (pure: new session)

export function startSession(name: string, pairs: string[], now: string, machine: string | null): AnalysisSession {
  return {
    id: newId(),
    name,
    machine,
    segments: [{ start: now, end: null, pair: null }],
    minutesOverride: null,
    pairs: pairs.map((pair) => ({ pair, decision: null, reasonIds: [], note: '', minutes: null, review: null })),
    endedAt: null,
    decidedAt: null
  }
}

const closeOpen = (s: AnalysisSession, now: string): AnalysisSession['segments'] =>
  s.segments.map((seg) => (seg.end == null ? { ...seg, end: now < seg.start ? seg.start : now } : seg))

export function pauseSession(s: AnalysisSession, now: string): AnalysisSession {
  return isRunning(s) ? { ...s, segments: closeOpen(s, now) } : s
}

/** Continue after a pause, optionally on another pair (`pair` undefined = the pair of the last segment). */
export function resumeSession(s: AnalysisSession, now: string, pair?: string | null): AnalysisSession {
  const next = pair === undefined ? (s.segments.at(-1)?.pair ?? null) : pair
  return { ...s, endedAt: null, segments: [...closeOpen(s, now), { start: now, end: null, pair: next }] }
}

/** The pair analysed from now on (null = the portfolio as a whole). */
export function switchPair(s: AnalysisSession, pair: string | null, now: string): AnalysisSession {
  if (isRunning(s) && s.segments.at(-1)!.pair === pair) return s
  return resumeSession(s, now, pair)
}

export function stopSession(s: AnalysisSession, now: string): AnalysisSession {
  return { ...pauseSession(s, now), endedAt: s.endedAt ?? now }
}

/** The running or paused (not ended) session of the day plans; the most recently active one. */
export function activeSession(days: readonly DayPlan[]): { day: DayPlan; session: AnalysisSession } | null {
  let best: { day: DayPlan; session: AnalysisSession; at: string } | null = null
  for (const day of days) {
    for (const session of day.sessions) {
      if (session.endedAt != null || !session.segments.length) continue
      const at = session.segments.at(-1)!.start
      if (!best || at > best.at) best = { day, session, at }
    }
  }
  return best ? { day: best.day, session: best.session } : null
}

// ------------------------------------------------------------------ "did the rejected pair give a setup?"

/** A rejected pair is asked about once the session ended this long ago (or the day is over). */
export const REVIEW_AFTER_MS = 3 * 60 * 60 * 1000

export interface PendingReview {
  date: string
  sessionId: string
  sessionName: string
  pair: string
  reasonIds: string[]
}

export function pendingReviews(days: readonly DayPlan[], now: string, today: string): PendingReview[] {
  const out: PendingReview[] = []
  for (const day of days) {
    for (const s of day.sessions) {
      if (s.endedAt == null) continue
      const end = s.endedAt
      if (day.date >= today && ms(now) - ms(end) < REVIEW_AFTER_MS) continue
      for (const p of s.pairs) {
        if (p.decision === 'reject' && p.review == null) out.push({ date: day.date, sessionId: s.id, sessionName: s.name, pair: p.pair, reasonIds: p.reasonIds })
      }
    }
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.pair.localeCompare(b.pair)))
}

export function setPairField<K extends keyof SessionPair>(s: AnalysisSession, pair: string, key: K, value: SessionPair[K]): AnalysisSession {
  return { ...s, pairs: s.pairs.map((p) => (p.pair === pair ? { ...p, [key]: value } : p)) }
}

// ------------------------------------------------------------------ statistics

export interface SelectionStats {
  sessions: number
  minutes: number
  /** Pair decisions: analysed pairs, trade / watch / reject / not decided. */
  analysed: number
  decisions: Record<PairDecision | 'none', number>
  /** Entries (not missed) on days with sessions, and how many of them came from a selected (trade / watch) pair. */
  trades: number
  fromSelection: number
  wins: number
  totalR: number
  /** Account-currency result of those trades (null without amounts). */
  money: number | null
  minutesPerTrade: number | null
  /** Minutes of analysis per 1R earned (null when ΣR ≤ 0). */
  minutesPerR: number | null
  moneyPerHour: number | null
  reasons: Array<{ reasonId: string; rejected: number; reviewed: number; noSetup: number; setup: number }>
  /** Rejected pairs asked about: share where there was no setup (a correct rejection). */
  rejectAccuracy: number | null
  pairs: Array<{ pair: string; minutes: number; analysed: number; selected: number; trades: number; totalR: number; minutesPerR: number | null }>
  /** Days by minutes of analysis: average result of the day. */
  buckets: Array<{ label: string; days: number; avgR: number | null }>
}

const BUCKETS: Array<{ label: string; max: number }> = [
  { label: '< 30 min', max: 30 },
  { label: '30–60 min', max: 60 },
  { label: '60–90 min', max: 90 },
  { label: '≥ 90 min', max: Infinity }
]

export function selectionStats(
  days: readonly DayPlan[],
  rows: ReadonlyArray<{ trade: Trade; m: TradeMetrics }>,
  opts: { from?: string | null; to?: string | null; now: string }
): SelectionStats {
  const inRange = (d: string) => (!opts.from || d >= opts.from) && (!opts.to || d <= opts.to)
  const sessionDays = days.filter((d) => inRange(d.date) && d.sessions.length > 0)
  const dates = new Set(sessionDays.map((d) => d.date))
  const decisions: SelectionStats['decisions'] = { trade: 0, watch: 0, reject: 0, none: 0 }
  const reasons = new Map<string, { reasonId: string; rejected: number; reviewed: number; noSetup: number; setup: number }>()
  const perPair = new Map<string, { pair: string; minutes: number; analysed: number; selected: number; trades: number; totalR: number }>()
  const pairRow = (pair: string) => perPair.get(pair) ?? perPair.set(pair, { pair, minutes: 0, analysed: 0, selected: 0, trades: 0, totalR: 0 }).get(pair)!
  const selectedOn = new Map<string, Set<string>>()
  const dayMinutes = new Map<string, number>()
  let minutes = 0
  let sessions = 0
  for (const day of sessionDays) {
    for (const s of day.sessions) {
      sessions++
      const m = sessionMinutes(s, opts.now)
      minutes += m
      dayMinutes.set(day.date, (dayMinutes.get(day.date) ?? 0) + m)
      const perMin = pairMinutes(s, opts.now)
      for (const p of s.pairs) {
        decisions[p.decision ?? 'none']++
        const row = pairRow(p.pair)
        row.analysed++
        row.minutes += perMin.get(p.pair) ?? 0
        if (p.decision === 'trade' || p.decision === 'watch') {
          row.selected++
          const set = selectedOn.get(day.date) ?? new Set<string>()
          set.add(p.pair)
          selectedOn.set(day.date, set)
        }
        if (p.decision === 'reject') {
          for (const id of p.reasonIds.length ? p.reasonIds : ['-']) {
            const r = reasons.get(id) ?? { reasonId: id, rejected: 0, reviewed: 0, noSetup: 0, setup: 0 }
            r.rejected++
            if (p.review === 'setup' || p.review === 'noSetup') r.reviewed++
            if (p.review === 'setup') r.setup++
            if (p.review === 'noSetup') r.noSetup++
            reasons.set(id, r)
          }
        }
      }
    }
  }
  const dayR = new Map<string, number>()
  let trades = 0
  let fromSelection = 0
  let wins = 0
  let totalR = 0
  let money: number | null = null
  for (const { trade, m } of rows) {
    if (trade.status === 'missed' || !dates.has(m.tradingDate)) continue
    trades++
    if (selectedOn.get(m.tradingDate)?.has(trade.pair)) fromSelection++
    const r = m.countsInStats && m.resultR != null ? m.resultR : 0
    if (m.outcome === 'win') wins++
    totalR += r
    dayR.set(m.tradingDate, (dayR.get(m.tradingDate) ?? 0) + r)
    if (m.pnlAmount != null) money = (money ?? 0) + m.pnlAmount
    const row = pairRow(trade.pair)
    row.trades++
    row.totalR += r
  }
  // Accuracy counts every rejection once (a rejection can have several reasons).
  let reviewed = 0
  let noSetup = 0
  for (const day of sessionDays)
    for (const s of day.sessions)
      for (const p of s.pairs)
        if (p.decision === 'reject' && (p.review === 'setup' || p.review === 'noSetup')) {
          reviewed++
          if (p.review === 'noSetup') noSetup++
        }
  return {
    sessions,
    minutes,
    analysed: decisions.trade + decisions.watch + decisions.reject + decisions.none,
    decisions,
    trades,
    fromSelection,
    wins,
    totalR,
    money,
    minutesPerTrade: trades ? minutes / trades : null,
    minutesPerR: totalR > 0 ? minutes / totalR : null,
    moneyPerHour: money != null && minutes > 0 ? money / (minutes / 60) : null,
    reasons: [...reasons.values()].sort((a, b) => b.rejected - a.rejected),
    rejectAccuracy: reviewed ? noSetup / reviewed : null,
    pairs: [...perPair.values()]
      .map((p) => ({ ...p, minutesPerR: p.totalR > 0 ? p.minutes / p.totalR : null }))
      .sort((a, b) => b.minutes - a.minutes || a.pair.localeCompare(b.pair)),
    buckets: BUCKETS.map((b, i) => {
      const lo = i === 0 ? 0 : BUCKETS[i - 1]!.max
      const inBucket = [...dayMinutes.entries()].filter(([, m]) => m >= lo && m < b.max)
      const rs = inBucket.map(([d]) => dayR.get(d) ?? 0)
      return { label: b.label, days: inBucket.length, avgR: rs.length ? rs.reduce((a, x) => a + x, 0) / rs.length : null }
    })
  }
}

export const DECISION_LABEL: Record<PairDecision, string> = { trade: 'handluję', watch: 'obserwuję', reject: 'odrzucam' }

/** "1 h 05 min" / "45 min". */
export function minutesLabel(minutes: number): string {
  const m = Math.round(Math.max(0, minutes))
  const h = Math.floor(m / 60)
  return h ? `${h} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`
}
