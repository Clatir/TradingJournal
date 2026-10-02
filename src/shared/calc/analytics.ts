/** Aggregations for the analytics screen. Pure functions over already-computed trade metrics. */
import type { DictionaryKey, JournalFile, Killzone, Trade } from '../schema'
import { equityCurve, summarize, type StatsSummary } from './stats'
import { weekdayNy, zoned } from './time'
import { classifyOutcome, type Outcome, type TradeMetrics } from './trade'
import type { ValidationResult } from './validator'

export interface AnalyzedTrade {
  trade: Trade
  m: TradeMetrics
  v: ValidationResult
}

export interface AnalyticsFilter {
  /** Inclusive NY trading dates (YYYY-MM-DD). */
  from?: string | null
  to?: string | null
  pairs?: string[] | null
}

export function applyFilter<T extends AnalyzedTrade>(rows: readonly T[], f: AnalyticsFilter): T[] {
  return rows.filter((r) => {
    if (f.from && r.m.tradingDate < f.from) return false
    if (f.to && r.m.tradingDate > f.to) return false
    if (f.pairs && f.pairs.length && !f.pairs.includes(r.trade.pair)) return false
    return true
  })
}

/** Closed trades with a result – the population for performance statistics. */
export function closedTrades<T extends AnalyzedTrade>(rows: readonly T[]): T[] {
  return rows.filter((r) => r.m.countsInStats && r.m.resultR != null)
}

const closeTime = (r: AnalyzedTrade) => r.m.exitTime ?? r.trade.entryTime

export function summaryOf(rows: readonly AnalyzedTrade[], be: number): StatsSummary {
  return summarize(closedTrades(rows).map((r) => ({ r: r.m.resultR as number, time: closeTime(r) })), be)
}

export interface EquityPointSec {
  /** UNIX seconds, strictly increasing (required by lightweight-charts). */
  time: number
  equity: number
  drawdown: number
  r: number
  tradeId: string
}

export function equitySeries(rows: readonly AnalyzedTrade[]): EquityPointSec[] {
  const closed = closedTrades(rows)
  const byTime = new Map(closed.map((r) => [r.trade.id, r]))
  const curve = equityCurve(closed.map((r) => ({ r: r.m.resultR as number, time: `${closeTime(r)}|${r.trade.id}` })))
  let last = -Infinity
  return curve.map((p) => {
    const [iso, id] = p.time.split('|') as [string, string]
    let t = Math.floor(Date.parse(iso) / 1000)
    if (t <= last) t = last + 1
    last = t
    return { time: t, equity: p.equity, drawdown: p.drawdown, r: p.r, tradeId: byTime.get(id)?.trade.id ?? id }
  })
}

export interface Group {
  key: string
  label: string
  count: number
  wins: number
  losses: number
  breakevens: number
  winRate: number | null
  totalR: number
  expectancy: number | null
}

function group(rows: readonly AnalyzedTrade[], be: number, keyOf: (r: AnalyzedTrade) => { key: string; label: string }): Group[] {
  const map = new Map<string, { label: string; rs: number[] }>()
  for (const r of closedTrades(rows)) {
    const { key, label } = keyOf(r)
    const g = map.get(key) ?? { label, rs: [] }
    g.rs.push(r.m.resultR as number)
    map.set(key, g)
  }
  return [...map.entries()].map(([key, g]) => {
    let wins = 0
    let losses = 0
    let breakevens = 0
    for (const x of g.rs) {
      const o = classifyOutcome(x, be)
      if (o === 'win') wins++
      else if (o === 'loss') losses++
      else breakevens++
    }
    const totalR = g.rs.reduce((s, x) => s + x, 0)
    return {
      key,
      label: g.label,
      count: g.rs.length,
      wins,
      losses,
      breakevens,
      winRate: wins + losses ? wins / (wins + losses) : null,
      totalR,
      expectancy: g.rs.length ? totalR / g.rs.length : null
    }
  })
}

const byTotal = (a: Group, b: Group) => b.totalR - a.totalR || a.label.localeCompare(b.label)

export function primarySession(r: AnalyzedTrade, killzones: readonly Killzone[]): string {
  const names = new Set(r.m.killzoneIds)
  const kz = killzones.filter((k) => names.has(k.id))
  return (kz.find((k) => k.kind === 'killzone') ?? kz[0])?.name ?? 'poza KZ'
}

function dictLabel(journal: JournalFile, key: DictionaryKey, id: string | null): string {
  if (!id) return '— brak —'
  return journal.dictionaries[key].find((d) => d.id === id)?.name ?? '(usunięta pozycja)'
}

const WEEKDAYS = ['', 'Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota', 'Niedziela']

export interface Breakdowns {
  pair: Group[]
  session: Group[]
  weekday: Group[]
  hour: Group[]
  model: Group[]
  pdArray: Group[]
}

export function breakdowns(rows: readonly AnalyzedTrade[], journal: JournalFile): Breakdowns {
  const be = journal.settings.stats.breakevenThresholdR
  const kzs = journal.settings.killzones
  return {
    pair: group(rows, be, (r) => ({ key: r.trade.pair, label: r.trade.pair })).sort(byTotal),
    session: group(rows, be, (r) => {
      const s = primarySession(r, kzs)
      return { key: s, label: s }
    }).sort(byTotal),
    weekday: group(rows, be, (r) => {
      const d = weekdayNy(r.trade.entryTime)
      return { key: String(d), label: WEEKDAYS[d] ?? String(d) }
    }).sort((a, b) => Number(a.key) - Number(b.key)),
    hour: group(rows, be, (r) => {
      const h = zoned(r.trade.entryTime, 'NY').hour
      return { key: String(h).padStart(2, '0'), label: `${String(h).padStart(2, '0')}:00` }
    }).sort((a, b) => a.key.localeCompare(b.key)),
    model: group(rows, be, (r) => ({ key: r.trade.entryModelId ?? '-', label: dictLabel(journal, 'entryModels', r.trade.entryModelId) })).sort(byTotal),
    pdArray: group(rows, be, (r) => ({ key: r.trade.entryPdArrayId ?? '-', label: dictLabel(journal, 'pdArrays', r.trade.entryPdArrayId) })).sort(byTotal)
  }
}

export type ComplianceRow = 'compliant' | 'broken' | 'unrated'

export interface MatrixCell {
  count: number
  totalR: number
}

export type ComplianceMatrix = Record<ComplianceRow, Record<Outcome, MatrixCell> & { total: MatrixCell }>

/** Rule compliance × outcome. */
export function complianceMatrix(rows: readonly AnalyzedTrade[], be: number): ComplianceMatrix {
  const cell = (): MatrixCell => ({ count: 0, totalR: 0 })
  const row = () => ({ win: cell(), breakeven: cell(), loss: cell(), total: cell() })
  const out: ComplianceMatrix = { compliant: row(), broken: row(), unrated: row() }
  for (const r of closedTrades(rows)) {
    const key: ComplianceRow = r.v.compliant == null ? 'unrated' : r.v.compliant ? 'compliant' : 'broken'
    const res = r.m.resultR as number
    const o = classifyOutcome(res, be)
    out[key][o].count++
    out[key][o].totalR += res
    out[key].total.count++
    out[key].total.totalR += res
  }
  return out
}

export interface MistakeCost {
  tagId: string
  name: string
  count: number
  totalR: number
  avgR: number
  /** Total R relative to the same number of clean (untagged) trades: negative = what the mistake cost. */
  costR: number
}

export function mistakeCosts(rows: readonly AnalyzedTrade[], journal: JournalFile): { baselineAvgR: number | null; cleanCount: number; tags: MistakeCost[] } {
  const closed = closedTrades(rows)
  const clean = closed.filter((r) => r.trade.psychology.mistakeTagIds.length === 0)
  const baselineAvgR = clean.length ? clean.reduce((s, r) => s + (r.m.resultR as number), 0) / clean.length : null
  const map = new Map<string, number[]>()
  for (const r of closed) for (const tag of r.trade.psychology.mistakeTagIds) map.set(tag, [...(map.get(tag) ?? []), r.m.resultR as number])
  const tags = [...map.entries()]
    .map(([tagId, rs]) => {
      const totalR = rs.reduce((s, x) => s + x, 0)
      return {
        tagId,
        name: dictLabel(journal, 'mistakeTags', tagId),
        count: rs.length,
        totalR,
        avgR: totalR / rs.length,
        costR: totalR - rs.length * (baselineAvgR ?? 0)
      }
    })
    .sort((a, b) => a.costR - b.costR)
  return { baselineAvgR, cleanCount: clean.length, tags }
}

export interface CalendarDay {
  date: string
  totalR: number
  count: number
}

export function calendarDays(rows: readonly AnalyzedTrade[]): Map<string, CalendarDay> {
  const map = new Map<string, CalendarDay>()
  for (const r of closedTrades(rows)) {
    const d = map.get(r.m.tradingDate) ?? { date: r.m.tradingDate, totalR: 0, count: 0 }
    d.totalR += r.m.resultR as number
    d.count++
    map.set(r.m.tradingDate, d)
  }
  return map
}

export interface MissedSummary {
  count: number
  /** Sum of hypothetical R of missed trades that have an outcome. */
  totalR: number
  rated: number
  byReason: Array<{ reasonId: string; name: string; count: number; totalR: number }>
}

export function missedSummary(rows: readonly AnalyzedTrade[], journal: JournalFile): MissedSummary {
  const missed = rows.filter((r) => r.trade.status === 'missed')
  const rated = missed.filter((r) => r.m.resultR != null)
  const map = new Map<string, { count: number; totalR: number }>()
  for (const r of missed) {
    const key = r.trade.missed.reasonId ?? '-'
    const g = map.get(key) ?? { count: 0, totalR: 0 }
    g.count++
    g.totalR += r.m.resultR ?? 0
    map.set(key, g)
  }
  return {
    count: missed.length,
    totalR: rated.reduce((s, r) => s + (r.m.resultR as number), 0),
    rated: rated.length,
    byReason: [...map.entries()]
      .map(([reasonId, g]) => ({ reasonId, name: dictLabel(journal, 'missedReasons', reasonId === '-' ? null : reasonId), ...g }))
      .sort((a, b) => b.totalR - a.totalR)
  }
}

export interface ExtraStats {
  avgMfeWinnersR: number | null
  avgMaeLosersR: number | null
  avgRiskPips: number | null
  complianceRate: number | null
  pnlAmount: number | null
}

export function extraStats(rows: readonly AnalyzedTrade[]): ExtraStats {
  const closed = closedTrades(rows)
  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null)
  const winners = closed.filter((r) => (r.m.resultR as number) > 0)
  const losers = closed.filter((r) => (r.m.resultR as number) < 0)
  const rated = closed.filter((r) => r.v.compliant != null)
  const amounts = closed.map((r) => r.m.pnlAmount).filter((x): x is number => x != null)
  return {
    avgMfeWinnersR: mean(winners.map((r) => r.m.mfeR).filter((x): x is number => x != null)),
    avgMaeLosersR: mean(losers.map((r) => r.m.maeR).filter((x): x is number => x != null)),
    avgRiskPips: mean(closed.map((r) => r.m.riskPips).filter((x): x is number => x != null)),
    complianceRate: rated.length ? rated.filter((r) => r.v.compliant).length / rated.length : null,
    pnlAmount: amounts.length ? amounts.reduce((s, x) => s + x, 0) : null
  }
}
