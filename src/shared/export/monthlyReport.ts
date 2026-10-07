/**
 * Reports (markdown and HTML for PDF) of any period – a month, a quarter, a year or own dates (1.5.0; before: monthly):
 * result in R and in PLN (amounts converted at the NBP table of the day before each closing, else today's rate),
 * weeks or months, pairs, sessions, weekdays, comparison with the previous period, the most costly mistakes, rule
 * compliance, the plan, analysis sessions, the trades and an approximate PIT-38. Sections can be chosen.
 * Pure: the rows are the analytics rows (trade, metrics, validation) of the journal.
 */
import { DateTime } from 'luxon'
import { closedTrades, mistakeCosts, primarySession, summaryOf, type AnalyzedTrade, type MistakeCost } from '../calc/analytics'
import { monthRange, periodMetrics, previousRange, rangeLabel, inRange, type DateRange, type PeriodMetrics } from '../calc/periods'
import { taxSummary, type TaxSummary } from '../calc/tax'
import { weekdayNy } from '../calc/time'
import type { StatsSummary } from '../calc/stats'
import { rateFor } from '../fx'
import { historicalRate, transactionDate } from '../fxHistory'
import { minutesLabel, selectionStats, type SelectionStats } from '../calc/sessions'
import type { DayPlan, JournalFile } from '../schema'

const MINUS = '−'
const MONTHS = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień']

export interface ReportRow {
  label: string
  trades: number
  totalR: number
  winRate: number | null
  pln: number | null
}

/** Sections a report can have (the order of the document). */
export const REPORT_SECTIONS = [
  { id: 'summary', label: 'Podsumowanie' },
  { id: 'comparison', label: 'Porównanie z poprzednim okresem' },
  { id: 'periods', label: 'Tygodnie / miesiące' },
  { id: 'pairs', label: 'Pary' },
  { id: 'sessions', label: 'Sesje (killzone)' },
  { id: 'weekdays', label: 'Dni tygodnia' },
  { id: 'mistakes', label: 'Najczęstsze błędy' },
  { id: 'compliance', label: 'Zgodność z zasadami' },
  { id: 'plan', label: 'Plan dnia' },
  { id: 'selection', label: 'Czas analizy i selekcja par' },
  { id: 'extremes', label: 'Najlepsza i najgorsza transakcja' },
  { id: 'trades', label: 'Lista transakcji' },
  { id: 'tax', label: 'PIT-38 (orientacyjnie)' }
] as const

export type ReportSectionId = (typeof REPORT_SECTIONS)[number]['id']

/** Sections of the monthly report so far (the default). */
export const DEFAULT_REPORT_SECTIONS: readonly ReportSectionId[] = ['summary', 'periods', 'pairs', 'mistakes', 'compliance', 'plan', 'selection', 'extremes']

export interface ReportTrade {
  date: string
  pair: string
  direction: 'long' | 'short'
  session: string
  r: number
  pln: number | null
}

export interface MonthlyReport {
  /** YYYY-MM of the start (the month of a monthly report). */
  month: string
  range: DateRange
  /** "marzec 2026", "I kw. 2026", "2026", "2026-03-02 – 2026-03-20". */
  periodLabel: string
  /** "w tym miesiącu" / "w tym okresie" in texts. */
  periodWord: string
  title: string
  summary: StatsSummary
  missed: number
  /** Σ of the closed trades' results in PLN; trades with an amount but no rate are left out (counted below). */
  pln: number | null
  plnTrades: number
  /** Of plnTrades: converted at the NBP table of the day before the closing / at today's rate (no archive). */
  plnHistorical: number
  plnCurrent: number
  plnWithoutRate: number
  /** Currencies of the amounts that have no rate to PLN. */
  missingRates: string[]
  /** How many closed trades have no amount at all (no risk amount, no lots). */
  noAmount: number
  /** Weeks (ranges up to ~2 months) or months (longer ranges). */
  weeks: ReportRow[]
  periodUnit: 'week' | 'month'
  pairs: ReportRow[]
  sessions: ReportRow[]
  weekdays: ReportRow[]
  tradeList: ReportTrade[]
  comparison: { current: PeriodMetrics; previous: PeriodMetrics }
  tax: TaxSummary
  mistakes: MistakeCost[]
  compliance: { rated: number; compliant: number; avgScore: number | null; broken: Array<{ label: string; count: number }> }
  plan: { tradingDays: number; daysWithPlan: number; tradesWithoutPlan: number; matched: number; partial: number; missedPlan: number; notReviewed: number }
  best: { date: string; pair: string; r: number } | null
  worst: { date: string; pair: string; r: number } | null
  /** Analysis sessions of the month (null without any). */
  selection: SelectionStats | null
  /** Names of the rejection reasons (for the report text). */
  rejectReasonNames: Record<string, string>
}

/** "marzec 2026" for "2026-03". */
export function reportMonthLabel(month: string): string {
  const [y, mo] = month.split('-').map(Number) as [number, number]
  return `${MONTHS[mo - 1]} ${y}`
}

/** Months (YYYY-MM, newest first) that have trades. */
export function reportMonths(rows: readonly AnalyzedTrade[]): string[] {
  return [...new Set(rows.map((r) => r.m.tradingDate.slice(0, 7)))].sort().reverse()
}

/** Result of a trade in PLN: its own amount at the NBP table of the day before the closing (else today's rate). */
export function resultInPln(
  r: AnalyzedTrade,
  journal: Pick<JournalFile, 'settings'>
): { pln: number | null; hasAmount: boolean; currency: string | null; rate: 'none' | 'historical' | 'current' | null } {
  const own = r.m.pnlAmountOwn
  if (own == null) return { pln: null, hasAmount: false, currency: null, rate: null }
  const currency = r.m.amountCurrency ?? journal.settings.risk.accountCurrency
  if (currency === 'PLN') return { pln: own, hasAmount: true, currency, rate: 'none' }
  const historical = historicalRate(currency, 'PLN', transactionDate(r.trade), journal.settings)
  if (historical) return { pln: own * historical.rate, hasAmount: true, currency, rate: 'historical' }
  const current = rateFor(currency, 'PLN', journal.settings)
  return current ? { pln: own * current.rate, hasAmount: true, currency, rate: 'current' } : { pln: null, hasAmount: true, currency, rate: null }
}

function rowOf(label: string, rows: readonly AnalyzedTrade[], be: number, journal: JournalFile): ReportRow {
  const s = summaryOf(rows, be)
  const plns = rows.map((r) => resultInPln(r, journal).pln).filter((x): x is number => x != null)
  return { label, trades: s.count, totalR: s.totalR, winRate: s.winRate, pln: plns.length ? plns.reduce((a, b) => a + b, 0) : null }
}

export function buildMonthlyReport(
  rows: readonly AnalyzedTrade[],
  days: readonly DayPlan[],
  journal: JournalFile,
  month: string,
  now: string = new Date().toISOString()
): MonthlyReport {
  return buildReport(rows, days, journal, monthRange(month), now)
}

const WEEKDAYS = ['', 'Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota', 'Niedziela']

/** Report of a period of New York trading dates (the whole journal, all pairs). */
export function buildReport(
  rows: readonly AnalyzedTrade[],
  days: readonly DayPlan[],
  journal: JournalFile,
  range: DateRange,
  now: string = new Date().toISOString()
): MonthlyReport {
  const be = journal.settings.stats.breakevenThresholdR
  const month = range.from.slice(0, 7)
  const isMonth = monthRange(month).from === range.from && monthRange(month).to === range.to
  const inMonth = rows.filter((r) => inRange(r.m.tradingDate, range))
  const closed = closedTrades(inMonth)
  const summary = summaryOf(inMonth, be)

  let pln = 0
  let plnTrades = 0
  let plnHistorical = 0
  let plnCurrent = 0
  let plnWithoutRate = 0
  const missingRates = new Set<string>()
  let noAmount = 0
  for (const r of closed) {
    const x = resultInPln(r, journal)
    if (!x.hasAmount) noAmount++
    else if (x.pln == null) {
      plnWithoutRate++
      if (x.currency) missingRates.add(x.currency)
    }
    else {
      pln += x.pln
      plnTrades++
      if (x.rate === 'historical') plnHistorical++
      if (x.rate === 'current') plnCurrent++
    }
  }

  const group = (key: (r: AnalyzedTrade) => string) => {
    const map = new Map<string, AnalyzedTrade[]>()
    for (const r of closed) map.set(key(r), [...(map.get(key(r)) ?? []), r])
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, list]) => rowOf(label, list, be, journal))
  }
  const weekOf = (r: AnalyzedTrade) => DateTime.fromISO(r.m.tradingDate, { zone: 'UTC' }).toFormat("kkkk-'W'WW")
  const longRange = DateTime.fromISO(range.to).diff(DateTime.fromISO(range.from), 'days').days > 62
  const plnOf = new Map(closed.map((r) => [r.trade.id, resultInPln(r, journal).pln] as const).filter((x): x is readonly [string, number] => x[1] != null))

  const rated = closed.filter((r) => r.v.compliant != null)
  const brokenCounts = new Map<string, number>()
  for (const r of rated) for (const b of r.v.broken) brokenCounts.set(b.label, (brokenCounts.get(b.label) ?? 0) + 1)
  const scores = rated.map((r) => r.v.score).filter((x): x is number => x != null)

  const tradeDays = new Set(inMonth.filter((r) => r.trade.status !== 'missed').map((r) => r.m.tradingDate))
  const plans = days.filter((d) => inRange(d.date, range))
  const planDates = new Set(plans.map((d) => d.date))
  const reviews = plans.map((d) => d.review.vsPlan)

  const sortedByR = [...closed].sort((a, b) => (a.m.resultR as number) - (b.m.resultR as number))
  const pick = (r: AnalyzedTrade | undefined) => (r ? { date: r.m.tradingDate, pair: r.trade.pair, r: r.m.resultR as number } : null)

  const label = rangeLabel(range)
  const weekdayGroups = group((r) => String(weekdayNy(r.trade.entryTime)))
  return {
    month,
    range,
    periodLabel: label,
    periodWord: isMonth ? 'w tym miesiącu' : 'w tym okresie',
    title: isMonth ? `Raport miesięczny – ${reportMonthLabel(month)}` : `Raport – ${label}`,
    summary,
    missed: inMonth.filter((r) => r.trade.status === 'missed').length,
    pln: plnTrades ? pln : null,
    plnTrades,
    plnHistorical,
    plnCurrent,
    plnWithoutRate,
    missingRates: [...missingRates].sort(),
    noAmount,
    weeks: longRange ? group((r) => r.m.tradingDate.slice(0, 7)) : group(weekOf),
    periodUnit: longRange ? 'month' : 'week',
    pairs: group((r) => r.trade.pair),
    sessions: group((r) => primarySession(r, journal.settings.killzones)),
    weekdays: weekdayGroups.map((g) => ({ ...g, label: WEEKDAYS[Number(g.label)] ?? g.label })),
    tradeList: [...closed]
      .sort((a, b) => (a.trade.entryTime < b.trade.entryTime ? -1 : 1))
      .map((r) => ({
        date: r.m.tradingDate,
        pair: r.trade.pair,
        direction: r.trade.direction,
        session: primarySession(r, journal.settings.killzones),
        r: r.m.resultR as number,
        pln: plnOf.get(r.trade.id) ?? null
      })),
    comparison: (() => {
      const all = new Map(closedTrades(rows).map((r) => [r.trade.id, resultInPln(r, journal).pln] as const).filter((x): x is readonly [string, number] => x[1] != null))
      return { current: periodMetrics(rows, range, be, all), previous: periodMetrics(rows, previousRange(range), be, all) }
    })(),
    tax: taxSummary(rows, journal, range),
    mistakes: mistakeCosts(inMonth, journal).tags.slice(0, 5),
    compliance: {
      rated: rated.length,
      compliant: rated.filter((r) => r.v.compliant).length,
      avgScore: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
      broken: [...brokenCounts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    },
    plan: {
      tradingDays: tradeDays.size,
      daysWithPlan: plans.length,
      tradesWithoutPlan: inMonth.filter((r) => r.trade.status !== 'missed' && !planDates.has(r.m.tradingDate)).length,
      matched: reviews.filter((v) => v === 'matched').length,
      partial: reviews.filter((v) => v === 'partial').length,
      missedPlan: reviews.filter((v) => v === 'missed').length,
      notReviewed: reviews.filter((v) => v == null).length
    },
    best: closed.length ? pick(sortedByR.at(-1)) : null,
    worst: closed.length ? pick(sortedByR[0]) : null,
    selection: (() => {
      const st = selectionStats(days, inMonth, { from: range.from, to: range.to, now })
      return st.sessions ? st : null
    })(),
    rejectReasonNames: Object.fromEntries(journal.dictionaries.rejectReasons.map((r) => [r.id, r.name]))
  }
}

// ------------------------------------------------------------------ formatting

/** Sign of the rounded value, so a sum like −1e-15 is shown as 0.00, not −0.00. */
const sign = (v: number, d: number) => {
  const r = Number(v.toFixed(d))
  return r < 0 ? MINUS : r > 0 ? '+' : ''
}
const signed = (v: number, d = 2) => `${sign(v, d)}${Math.abs(v).toFixed(d)}`
const group3 = (s: string) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
export const fmtReportR = (v: number) => `${signed(v)}R`
export function fmtReportPln(v: number | null): string {
  if (v == null) return '—'
  const [int, dec] = Math.abs(v).toFixed(2).split('.')
  return `${sign(v, 2)}${group3(int!)}.${dec} PLN`
}
const pct = (v: number | null) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`)
const num = (v: number | null, d = 2) => (v == null ? '—' : Number.isFinite(v) ? v.toFixed(d) : '∞')

export interface Section {
  heading: string
  table?: { head: string[]; rows: string[][]; right?: number[] }
  lines?: string[]
}

/** The headline: result in R and PLN with what the PLN sum leaves out. */
export function reportLead(r: MonthlyReport): string {
  return sections(r).lead
}

const diff = (a: number | null, b: number | null, f: (v: number) => string) => (a == null || b == null ? '—' : f(a - b))

/** The report as sections in the document order, only the chosen ones (default: those of the monthly report). */
export function reportSections(r: MonthlyReport, include: readonly ReportSectionId[] = DEFAULT_REPORT_SECTIONS): { lead: string; sections: Section[] } {
  const all = sectionsById(r)
  const chosen = new Set(include)
  return { lead: all.lead, sections: REPORT_SECTIONS.filter((x) => chosen.has(x.id)).flatMap((x) => all.byId[x.id] ?? []) }
}

function sections(r: MonthlyReport, include?: readonly ReportSectionId[]): { lead: string; sections: Section[] } {
  return reportSections(r, include)
}

function sectionsById(r: MonthlyReport): { lead: string; byId: Partial<Record<ReportSectionId, Section[]>> } {
  const s = r.summary
  const left = [
    r.plnWithoutRate ? `${r.plnWithoutRate} bez kursu ${r.missingRates.join('/')} → PLN` : null,
    r.noAmount ? `${r.noAmount} bez kwoty (brak ryzyka i lotów)` : null
  ].filter(Boolean)
  const counts = r.plnTrades < s.count ? `przeliczono ${r.plnTrades} z ${s.count} transakcji: ${left.join(', ')}` : null
  const rates = [
    r.plnHistorical ? 'kursy NBP z dnia poprzedzającego zamknięcie' : null,
    r.plnCurrent ? `${r.plnCurrent} po bieżącym kursie (brak archiwum NBP)` : null
  ]
  const plnNote = [counts, rates.filter(Boolean).join(', ')].filter(Boolean).join('; ')
  const lead = `Wynik: ${fmtReportR(s.totalR)} · ${fmtReportPln(r.pln)}${plnNote ? ` (${plnNote})` : ''}`
  const byId: Partial<Record<ReportSectionId, Section[]>> = {}
  const add = (id: ReportSectionId, sec: Section) => (byId[id] ??= []).push(sec)
  add('summary', {
      heading: 'Podsumowanie',
      table: {
        head: ['', ''],
        right: [1],
        rows: [
          ['Transakcje zamknięte', String(s.count)],
          ['Wygrane / przegrane / BE', `${s.wins} / ${s.losses} / ${s.breakevens}`],
          ['Win rate', pct(s.winRate)],
          ['Σ R', fmtReportR(s.totalR)],
          ['Wynik w PLN', fmtReportPln(r.pln)],
          ['Expectancy', s.expectancy == null ? '—' : fmtReportR(s.expectancy)],
          ['Profit factor', num(s.profitFactor)],
          ['Maks. obsunięcie', `${s.maxDrawdownR.toFixed(2)}R`],
          ['Najdłuższa seria wygranych / strat', `${s.longestWinStreak} / ${s.longestLossStreak}`],
          ['Missed trades', String(r.missed)]
        ]
      }
    })
  const groupTable = (heading: string, first: string, rows: ReportRow[]): Section => ({
    heading,
    table: {
      head: [first, 'Transakcje', 'Win rate', 'Σ R', 'PLN'],
      right: [1, 2, 3, 4],
      rows: rows.map((x) => [x.label, String(x.trades), pct(x.winRate), fmtReportR(x.totalR), fmtReportPln(x.pln)])
    }
  })
  const cmp = r.comparison
  const cur = cmp.current
  const prev = cmp.previous
  const pctPts = (v: number) => `${sign(v * 100, 1)}${Math.abs(v * 100).toFixed(1)} pkt`
  add('comparison', {
    heading: `Porównanie z poprzednim okresem (${rangeLabel(prev.range)})`,
    table: {
      head: ['', r.periodLabel, rangeLabel(prev.range), 'Zmiana'],
      right: [1, 2, 3],
      rows: [
        ['Transakcje', String(cur.trades), String(prev.trades), String(cur.trades - prev.trades)],
        ['Win rate', pct(cur.winRate), pct(prev.winRate), diff(cur.winRate, prev.winRate, pctPts)],
        ['Σ R', fmtReportR(cur.totalR), fmtReportR(prev.totalR), fmtReportR(cur.totalR - prev.totalR)],
        ['Expectancy', cur.expectancy == null ? '—' : fmtReportR(cur.expectancy), prev.expectancy == null ? '—' : fmtReportR(prev.expectancy), diff(cur.expectancy, prev.expectancy, fmtReportR)],
        ['Profit factor', num(cur.profitFactor), num(prev.profitFactor), diff(cur.profitFactor, prev.profitFactor, (v) => (Number.isFinite(v) ? signed(v) : '—'))],
        ['Maks. obsunięcie', `${cur.maxDrawdownR.toFixed(2)}R`, `${prev.maxDrawdownR.toFixed(2)}R`, fmtReportR(cur.maxDrawdownR - prev.maxDrawdownR)],
        ['Zgodność z zasadami', pct(cur.compliance), pct(prev.compliance), diff(cur.compliance, prev.compliance, pctPts)],
        ['Wynik w PLN', fmtReportPln(cur.pln), fmtReportPln(prev.pln), diff(cur.pln, prev.pln, fmtReportPln)]
      ]
    }
  })
  if (r.weeks.length) add('periods', r.periodUnit === 'month' ? groupTable('Miesiące', 'Miesiąc', r.weeks) : groupTable('Tygodnie', 'Tydzień', r.weeks))
  if (r.pairs.length) add('pairs', groupTable('Pary', 'Para', r.pairs))
  if (r.sessions.length) add('sessions', groupTable('Sesje (killzone)', 'Sesja', r.sessions))
  if (r.weekdays.length) add('weekdays', groupTable('Dni tygodnia (NY)', 'Dzień', r.weekdays))
  add(
    'mistakes',
    r.mistakes.length
      ? {
          heading: 'Najczęstsze błędy',
          table: {
            head: ['Błąd', 'Ile razy', 'Σ R', 'Koszt względem transakcji bez błędów'],
            right: [1, 2, 3],
            rows: r.mistakes.map((m) => [m.name, String(m.count), fmtReportR(m.totalR), fmtReportR(m.costR)])
          }
        }
      : { heading: 'Najczęstsze błędy', lines: [`Brak oznaczonych błędów ${r.periodWord}.`] }
  )
  const c = r.compliance
  add('compliance', {
    heading: 'Zgodność z zasadami',
    lines: [
      c.rated
        ? `Ocenione transakcje: ${c.rated}, zgodne ze wszystkimi zasadami: ${c.compliant} (${pct(c.compliant / c.rated)}), średnia ocena ${pct(c.avgScore)}.`
        : 'Brak ocenionych transakcji.',
      c.broken.length ? `Najczęściej łamane: ${c.broken.map((b) => `${b.label} (${b.count})`).join(', ')}.` : 'Żadna zasada nie została złamana.'
    ]
  })
  const p = r.plan
  const inPeriod = r.periodWord === 'w tym miesiącu' ? 'w miesiącu' : 'w okresie'
  add('plan', {
    heading: 'Plan dnia',
    lines: [
      `Dni z transakcjami: ${p.tradingDays}, plany dnia ${inPeriod}: ${p.daysWithPlan}, transakcje w dni bez planu: ${p.tradesWithoutPlan}.`,
      p.daysWithPlan
        ? `Ocena po sesji: zgodnie z planem ${p.matched}, częściowo ${p.partial}, inaczej ${p.missedPlan}, bez oceny ${p.notReviewed}.`
        : `Brak planów dnia ${r.periodWord}.`
    ]
  })
  if (r.selection) {
    const st = r.selection
    const pct2 = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`)
    const topReasons = st.reasons
      .slice(0, 3)
      .map((x) => `${r.rejectReasonNames[x.reasonId] ?? 'bez powodu'} (${x.rejected}${x.reviewed ? `, trafne ${pct2(x.noSetup / x.reviewed)}` : ''})`)
    add('selection', {
      heading: 'Czas analizy i selekcja par',
      lines: [
        `Sesje analizy: ${st.sessions}, łącznie ${minutesLabel(st.minutes)}. Pary: przeanalizowane ${st.analysed}, wybrane ${st.decisions.trade + st.decisions.watch} (handluję ${st.decisions.trade}, obserwuję ${st.decisions.watch}), odrzucone ${st.decisions.reject}.`,
        `Wejścia w dni z analizą: ${st.trades} (z wybranych par: ${st.fromSelection}), wygrane: ${st.wins}, Σ ${fmtReportR(st.totalR)}.`,
        `Czas na wejście: ${st.minutesPerTrade == null ? '—' : minutesLabel(st.minutesPerTrade)}; czas na 1R: ${st.minutesPerR == null ? '—' : minutesLabel(st.minutesPerR)}; trafność odrzuceń: ${pct2(st.rejectAccuracy)}.`,
        ...(topReasons.length ? [`Najczęstsze powody odrzucenia: ${topReasons.join(', ')}.`] : [])
      ]
    })
  }
  if (r.best && r.worst)
    add('extremes', {
      heading: 'Najlepsza i najgorsza transakcja',
      lines: [`Najlepsza: ${r.best.date} ${r.best.pair} ${fmtReportR(r.best.r)}.`, `Najgorsza: ${r.worst.date} ${r.worst.pair} ${fmtReportR(r.worst.r)}.`]
    })
  add(
    'trades',
    r.tradeList.length
      ? {
          heading: 'Lista transakcji',
          table: {
            head: ['Data NY', 'Para', 'Kierunek', 'Sesja', 'R', 'PLN'],
            right: [4, 5],
            rows: r.tradeList.map((t) => [t.date, t.pair, t.direction === 'long' ? 'Long' : 'Short', t.session, fmtReportR(t.r), fmtReportPln(t.pln)])
          }
        }
      : { heading: 'Lista transakcji', lines: [`Brak zamkniętych transakcji ${r.periodWord}.`] }
  )
  const tax = r.tax
  const taxLeft = [
    tax.noAmount ? `${tax.noAmount} bez kwoty (wpisz wynik w kwocie albo loty)` : null,
    tax.withoutRate ? `${tax.withoutRate} bez kursu ${tax.missingRates.join('/')} → PLN` : null
  ].filter(Boolean)
  add('tax', {
    heading: `PIT-38 – zestawienie orientacyjne (${rangeLabel(tax.range)}, wg daty zamknięcia)`,
    table: {
      head: ['', 'PLN'],
      right: [1],
      rows: [
        ['Przychód (suma zysków)', fmtReportPln(tax.income).replace('+', '')],
        ['Koszty (suma strat)', fmtReportPln(tax.costs).replace('+', '')],
        ['Dochód / strata', fmtReportPln(tax.result)],
        ['Transakcje ujęte', String(tax.trades.length)]
      ]
    },
    lines: [
      'Wynik netto każdej transakcji (z prowizją i swapem) przeliczony średnim kursem NBP z ostatniego dnia roboczego przed dniem zamknięcia; zyski to przychód, straty – koszty.',
      ...(tax.approximate ? [`${tax.approximate} transakcji przeliczono bieżącym kursem (brak archiwum NBP z dnia transakcji) – odśwież kursy NBP, by mieć kurs z właściwego dnia.`] : []),
      ...(taxLeft.length ? [`Pominięte: ${taxLeft.join(', ')}.`] : []),
      'Zestawienie pomocnicze – podstawą rozliczenia jest PIT-8C od brokera; wynik może się różnić (np. inne zaokrąglenia, transakcje spoza dziennika).'
    ]
  })
  if (tax.byMonth.length > 1)
    add('tax', {
      heading: 'PIT-38 – miesiące',
      table: {
        head: ['Miesiąc', 'Transakcje', 'Przychód', 'Koszty', 'Dochód'],
        right: [1, 2, 3, 4],
        rows: tax.byMonth.map((m) => [m.month, String(m.trades), fmtReportPln(m.income).replace('+', ''), fmtReportPln(m.costs).replace('+', ''), fmtReportPln(m.result)])
      }
    })
  if (tax.trades.length)
    add('tax', {
      heading: 'PIT-38 – transakcje',
      table: {
        head: ['Zamknięcie', 'Para', 'Kwota', 'Kurs NBP', 'Tabela z', 'PLN'],
        right: [2, 3, 5],
        rows: tax.trades.map((t) => [
          t.date,
          t.pair,
          `${signed(t.amount)} ${t.currency}`,
          t.currency === 'PLN' ? '—' : t.rate.toFixed(4),
          t.currency === 'PLN' ? '—' : (t.rateDate ?? 'bieżący'),
          fmtReportPln(t.pln)
        ])
      }
    })
  return { lead, byId }
}

const mdCell = (s: string) => s.replace(/\|/g, '\\|')

export function monthlyReportMarkdown(r: MonthlyReport, include?: readonly ReportSectionId[]): string {
  const { lead, sections: list } = sections(r, include)
  const out = [`# ${r.title}`, '', `**${lead}**`, '']
  for (const s of list) {
    out.push(`## ${s.heading}`, '')
    if (s.table) {
      const head = s.table.head.map((h) => (h ? mdCell(h) : ' '))
      out.push(`| ${head.join(' | ')} |`, `|${s.table.head.map((_, i) => (s.table!.right?.includes(i) ? '---:' : '---')).join('|')}|`)
      for (const row of s.table.rows) out.push(`| ${row.map(mdCell).join(' | ')} |`)
      out.push('')
    }
    for (const line of s.lines ?? []) out.push(`- ${line}`)
    if (s.lines) out.push('')
  }
  return `${out.join('\n').trimEnd()}\n`
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Self-contained HTML (no scripts, no external resources) for printing to PDF. */
export function monthlyReportHtml(r: MonthlyReport, include?: readonly ReportSectionId[]): string {
  const { lead, sections: list } = sections(r, include)
  const body = list
    .map((s) => {
      const table = s.table
        ? `<table>${s.table.head.some(Boolean) ? `<thead><tr>${s.table.head.map((h, i) => `<th${s.table!.right?.includes(i) ? ' class="r"' : ''}>${esc(h)}</th>`).join('')}</tr></thead>` : ''}<tbody>${s.table.rows
            .map((row) => `<tr>${row.map((c, i) => `<td${s.table!.right?.includes(i) ? ' class="r"' : ''}>${esc(c)}</td>`).join('')}</tr>`)
            .join('')}</tbody></table>`
        : ''
      const lines = s.lines ? `<ul>${s.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''
      return `<h2>${esc(s.heading)}</h2>${table}${lines}`
    })
    .join('')
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${esc(r.title)}</title><style>
body{font-family:"Segoe UI",Arial,sans-serif;font-size:11pt;color:#1b1f24;margin:0}
h1{font-size:18pt;margin:0 0 4pt}h2{font-size:12.5pt;margin:16pt 0 6pt;border-bottom:1px solid #c9ced4;padding-bottom:2pt}
.lead{font-size:11.5pt;margin:0 0 6pt}table{border-collapse:collapse;width:100%;font-size:10pt}
th,td{border-bottom:1px solid #e1e4e8;padding:3pt 6pt;text-align:left}th{color:#57606a;font-weight:600}
.r{text-align:right;font-variant-numeric:tabular-nums}ul{margin:4pt 0;padding-left:16pt}li{margin:2pt 0}
.foot{margin-top:18pt;color:#8a929b;font-size:8.5pt}
</style></head><body><h1>${esc(r.title)}</h1><p class="lead"><b>${esc(lead)}</b></p>${body}<p class="foot">ICT Trade Journal</p></body></html>`
}
