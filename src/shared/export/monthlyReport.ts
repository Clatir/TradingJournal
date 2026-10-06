/**
 * Monthly report (markdown and HTML for PDF): result in R and in PLN (amounts converted at the NBP table of the day
 * before each closing, else today's rate), weeks, pairs, the most costly mistakes, rule compliance and the plan.
 * Pure: the rows are the analytics rows (trade, metrics, validation) of the journal.
 */
import { DateTime } from 'luxon'
import { closedTrades, mistakeCosts, summaryOf, type AnalyzedTrade, type MistakeCost } from '../calc/analytics'
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

export interface MonthlyReport {
  /** YYYY-MM */
  month: string
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
  weeks: ReportRow[]
  pairs: ReportRow[]
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
  const be = journal.settings.stats.breakevenThresholdR
  const inMonth = rows.filter((r) => r.m.tradingDate.startsWith(month))
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

  const rated = closed.filter((r) => r.v.compliant != null)
  const brokenCounts = new Map<string, number>()
  for (const r of rated) for (const b of r.v.broken) brokenCounts.set(b.label, (brokenCounts.get(b.label) ?? 0) + 1)
  const scores = rated.map((r) => r.v.score).filter((x): x is number => x != null)

  const tradeDays = new Set(inMonth.filter((r) => r.trade.status !== 'missed').map((r) => r.m.tradingDate))
  const plans = days.filter((d) => d.date.startsWith(month))
  const planDates = new Set(plans.map((d) => d.date))
  const reviews = plans.map((d) => d.review.vsPlan)

  const sortedByR = [...closed].sort((a, b) => (a.m.resultR as number) - (b.m.resultR as number))
  const pick = (r: AnalyzedTrade | undefined) => (r ? { date: r.m.tradingDate, pair: r.trade.pair, r: r.m.resultR as number } : null)

  return {
    month,
    title: `Raport miesięczny – ${reportMonthLabel(month)}`,
    summary,
    missed: inMonth.filter((r) => r.trade.status === 'missed').length,
    pln: plnTrades ? pln : null,
    plnTrades,
    plnHistorical,
    plnCurrent,
    plnWithoutRate,
    missingRates: [...missingRates].sort(),
    noAmount,
    weeks: group(weekOf),
    pairs: group((r) => r.trade.pair),
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
      const st = selectionStats(days, inMonth, { from: `${month}-01`, to: `${month}-31`, now })
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

interface Section {
  heading: string
  table?: { head: string[]; rows: string[][]; right?: number[] }
  lines?: string[]
}

/** The headline: result in R and PLN with what the PLN sum leaves out. */
export function reportLead(r: MonthlyReport): string {
  return sections(r).lead
}

function sections(r: MonthlyReport): { lead: string; sections: Section[] } {
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
  const out: Section[] = [
    {
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
    }
  ]
  const groupTable = (heading: string, first: string, rows: ReportRow[]): Section => ({
    heading,
    table: {
      head: [first, 'Transakcje', 'Win rate', 'Σ R', 'PLN'],
      right: [1, 2, 3, 4],
      rows: rows.map((x) => [x.label, String(x.trades), pct(x.winRate), fmtReportR(x.totalR), fmtReportPln(x.pln)])
    }
  })
  if (r.weeks.length) out.push(groupTable('Tygodnie', 'Tydzień', r.weeks))
  if (r.pairs.length) out.push(groupTable('Pary', 'Para', r.pairs))
  out.push(
    r.mistakes.length
      ? {
          heading: 'Najczęstsze błędy',
          table: {
            head: ['Błąd', 'Ile razy', 'Σ R', 'Koszt względem transakcji bez błędów'],
            right: [1, 2, 3],
            rows: r.mistakes.map((m) => [m.name, String(m.count), fmtReportR(m.totalR), fmtReportR(m.costR)])
          }
        }
      : { heading: 'Najczęstsze błędy', lines: ['Brak oznaczonych błędów w tym miesiącu.'] }
  )
  const c = r.compliance
  out.push({
    heading: 'Zgodność z zasadami',
    lines: [
      c.rated
        ? `Ocenione transakcje: ${c.rated}, zgodne ze wszystkimi zasadami: ${c.compliant} (${pct(c.compliant / c.rated)}), średnia ocena ${pct(c.avgScore)}.`
        : 'Brak ocenionych transakcji.',
      c.broken.length ? `Najczęściej łamane: ${c.broken.map((b) => `${b.label} (${b.count})`).join(', ')}.` : 'Żadna zasada nie została złamana.'
    ]
  })
  const p = r.plan
  out.push({
    heading: 'Plan dnia',
    lines: [
      `Dni z transakcjami: ${p.tradingDays}, plany dnia w miesiącu: ${p.daysWithPlan}, transakcje w dni bez planu: ${p.tradesWithoutPlan}.`,
      p.daysWithPlan
        ? `Ocena po sesji: zgodnie z planem ${p.matched}, częściowo ${p.partial}, inaczej ${p.missedPlan}, bez oceny ${p.notReviewed}.`
        : 'Brak planów dnia w tym miesiącu.'
    ]
  })
  if (r.selection) {
    const st = r.selection
    const pct2 = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`)
    const topReasons = st.reasons
      .slice(0, 3)
      .map((x) => `${r.rejectReasonNames[x.reasonId] ?? 'bez powodu'} (${x.rejected}${x.reviewed ? `, trafne ${pct2(x.noSetup / x.reviewed)}` : ''})`)
    out.push({
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
    out.push({
      heading: 'Najlepsza i najgorsza transakcja',
      lines: [`Najlepsza: ${r.best.date} ${r.best.pair} ${fmtReportR(r.best.r)}.`, `Najgorsza: ${r.worst.date} ${r.worst.pair} ${fmtReportR(r.worst.r)}.`]
    })
  return { lead, sections: out }
}

const mdCell = (s: string) => s.replace(/\|/g, '\\|')

export function monthlyReportMarkdown(r: MonthlyReport): string {
  const { lead, sections: list } = sections(r)
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
export function monthlyReportHtml(r: MonthlyReport): string {
  const { lead, sections: list } = sections(r)
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
