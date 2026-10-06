import { describe, expect, it } from 'vitest'
import { createDayPlan, createDefaultJournal, createTrade } from '@shared/defaults'
import { metricsContext, tradeMetrics } from '@shared/calc/trade'
import { validateTrade } from '@shared/calc/validator'
import type { AnalyzedTrade } from '@shared/calc/analytics'
import { buildMonthlyReport, monthlyReportHtml, monthlyReportMarkdown, reportLead, reportMonths } from '@shared/export/monthlyReport'
import type { DayPlan, JournalFile, Trade } from '@shared/schema'
import { setPairField, startSession, stopSession } from '@shared/calc/sessions'

function analyze(journal: JournalFile, trades: Trade[], days: DayPlan[] = []): AnalyzedTrade[] {
  const ctx = metricsContext(journal.settings)
  const byDate = new Map(days.map((d) => [d.date, d]))
  return trades.map((t) => {
    const m = tradeMetrics(t, ctx)
    return { trade: t, m, v: validateTrade(t, m, journal.settings, byDate.get(m.tradingDate) ?? null) }
  })
}

const base = createDefaultJournal()
const journal: JournalFile = {
  ...base,
  settings: {
    ...base.settings,
    fx: {
      ...base.settings.fx,
      // Table A: 16.03 and 20.03 (Mondays and Fridays are enough for the dates used below).
      history: { USD: { from: '2026-03-01', to: '2026-03-31', rates: { '2026-03-16': 3.7, '2026-03-17': 3.72, '2026-03-20': 3.8 } } }
    }
  },
  dictionaries: {
    ...base.dictionaries,
    mistakeTags: base.dictionaries.mistakeTags.map((d, i) => (i === 0 ? { ...d, name: 'Za wcześnie <wejście> & "FOMO" | x' } : d))
  }
}
const tag = journal.dictionaries.mistakeTags[0]!.id
const psych = (tags: string[]): Trade['psychology'] => ({
  before: { score: null, note: '' },
  during: { score: null, note: '' },
  after: { score: null, note: '' },
  mistakeTagIds: tags,
  didWell: '',
  nextTime: ''
})

// Long, entry 1.1, SL 10 pips below: exit 1.102 = +2R, 1.099 = −1R, 1.1 = BE, 1.1025 = +2.5R.
function t(entryTime: string, pair: string, exit: number, extra: Partial<Trade> = {}): Trade {
  return createTrade({
    pair,
    direction: 'long',
    entryTime,
    prices: { entry: 1.1, stopLoss: 1.099, takeProfit1: 1.102, takeProfit2: null },
    exits: [{ id: '01K6H3Z0W8Q4M2N5P7R9S1T3V5', time: null, price: exit, percent: 100, note: '' }],
    stopBeyondLiquidity: 'yes',
    ...extra
  })
}

const trades = [
  t('2026-03-16T07:30:00.000Z', 'EURUSD', 1.102, { riskAmount: 100, amountCurrency: 'PLN' }), // +2R = +200 PLN
  t('2026-03-17T12:30:00.000Z', 'EURUSD', 1.099, { riskAmount: 50, amountCurrency: 'USD', psychology: psych([tag]) }), // −50 USD × 3.70 (16.03)
  t('2026-03-18T07:30:00.000Z', 'AUDUSD', 1.1), // BE, no amount
  t('2026-03-19T16:30:00.000Z', 'AUDUSD', 1.099, { riskAmount: 40, amountCurrency: 'CHF', psychology: psych([tag]) }), // −1R, no CHF rate; outside KZ
  t('2026-03-20T07:30:00.000Z', 'EURUSD', 1.1, { status: 'missed', missed: { reasonId: null, hypotheticalOutcome: 'tp1' } }),
  t('2026-03-23T07:30:00.000Z', 'EURUSD', 1.1025, { riskAmount: 50, amountCurrency: 'USD' }), // +125 USD × 3.80 (20.03)
  t('2026-04-02T07:30:00.000Z', 'EURUSD', 1.102, { riskAmount: 100, amountCurrency: 'PLN' }) // next month
]
const days = [
  { ...createDayPlan('2026-03-16', ['EURUSD'], []), review: { whatHappened: '', vsPlan: 'matched' as const, notes: '' } },
  createDayPlan('2026-03-19', ['AUDUSD'], [])
]
const rows = analyze(journal, trades, days)
// Rounded for comparison (+ 0 turns −0 into 0).
const r2 = (v: number | null) => (v == null ? null : Number(v.toFixed(2)) + 0)

describe('raport miesięczny', () => {
  const r = buildMonthlyReport(rows, days, journal, '2026-03')

  it('miesiące z transakcjami, od najnowszego', () => {
    expect(reportMonths(rows)).toEqual(['2026-04', '2026-03'])
  })

  it('wynik w R i w PLN po kursie NBP z dnia przed zamknięciem; bez kursu i bez kwoty osobno', () => {
    expect(r.title).toBe('Raport miesięczny – marzec 2026')
    expect(r.summary.count).toBe(5)
    expect(r.summary.totalR).toBeCloseTo(2.5, 9)
    expect(r.missed).toBe(1)
    expect(r.pln).toBeCloseTo(200 - 50 * 3.7 + 125 * 3.8, 6)
    expect(r.plnTrades).toBe(3)
    expect(r.plnWithoutRate).toBe(1)
    expect(r.missingRates).toEqual(['CHF'])
    expect(r.noAmount).toBe(1)
  })

  it('tygodnie ISO i pary', () => {
    expect(r.weeks.map((w) => [w.label, w.trades, r2(w.totalR), r2(w.pln)])).toEqual([
      ['2026-W12', 4, 0, 15],
      ['2026-W13', 1, 2.5, 475]
    ])
    expect(r.pairs.map((p) => [p.label, p.trades, r2(p.totalR), r2(p.pln)])).toEqual([
      ['AUDUSD', 2, -1, null],
      ['EURUSD', 3, 3.5, 490]
    ])
    expect(r.pairs[0]!.winRate).toBe(0)
  })

  it('błędy, zgodność z zasadami i plan dnia', () => {
    expect(r.mistakes).toHaveLength(1)
    expect(r.mistakes[0]).toMatchObject({ tagId: tag, count: 2 })
    expect(r.mistakes[0]!.costR).toBeCloseTo(-2 - 2 * 1.5, 9) // clean trades: (+2 + 0 + 2.5) / 3
    expect(r.compliance).toMatchObject({ rated: 5, compliant: 4, broken: [{ label: 'Wejście w killzone', count: 1 }] })
    expect(r.plan).toEqual({ tradingDays: 5, daysWithPlan: 2, tradesWithoutPlan: 3, matched: 1, partial: 0, missedPlan: 0, notReviewed: 1 })
    expect(r.best).toEqual({ date: '2026-03-23', pair: 'EURUSD', r: expect.closeTo(2.5, 9) })
    expect(r.worst?.r).toBeCloseTo(-1, 9)
  })

  it('markdown: nagłówek, wynik, tabele z wyrównaniem i ucieczką „|”', () => {
    const md = monthlyReportMarkdown(r)
    expect(md.startsWith('# Raport miesięczny – marzec 2026\n')).toBe(true)
    expect(md).toContain('**Wynik: +2.50R · +490.00 PLN (przeliczono 3 z 5 transakcji: 1 bez kursu CHF → PLN, 1 bez kwoty (brak ryzyka i lotów); kursy NBP z dnia poprzedzającego zamknięcie)**')
    expect(md).toContain('| Tydzień | Transakcje | Win rate | Σ R | PLN |\n|---|---:|---:|---:|---:|')
    expect(md).toContain('| 2026-W12 | 4 | 33.3% | 0.00R | +15.00 PLN |')
    expect(md).toContain('| AUDUSD | 2 | 0.0% | −1.00R | — |')
    expect(md).toContain('| Za wcześnie <wejście> & "FOMO" \\| x | 2 | −2.00R | −5.00R |')
    expect(md).toContain('- Najczęściej łamane: Wejście w killzone (1).')
    expect(md).toContain('- Ocena po sesji: zgodnie z planem 1, częściowo 0, inaczej 0, bez oceny 1.')
    expect(md.endsWith('\n')).toBe(true)
  })

  it('HTML do PDF: bez skryptów i zasobów z zewnątrz, tekst z danych jest escapowany', () => {
    const html = monthlyReportHtml(r)
    expect(html).toContain("default-src 'none'")
    expect(html).not.toMatch(/<script|src=|href=/i)
    expect(html).toContain('Za wcześnie &lt;wejście&gt; &amp; &quot;FOMO&quot; | x')
    expect(html).not.toContain('<wejście>')
    expect(html).toContain('<td class="r">+490.00 PLN</td>')
  })

  it('miesiąc bez transakcji i bez planów', () => {
    const empty = buildMonthlyReport(rows, days, journal, '2026-05')
    expect(empty.summary.count).toBe(0)
    expect(empty.pln).toBeNull()
    expect(empty.best).toBeNull()
    const md = monthlyReportMarkdown(empty)
    expect(md).toContain('**Wynik: 0.00R · —**')
    expect(md).toContain('- Brak oznaczonych błędów w tym miesiącu.')
    expect(md).toContain('- Brak planów dnia w tym miesiącu.')
  })

  it('dopisek przy PLN: same kwoty w PLN – bez dopisku; bez archiwum – bieżący kurs NBP i ich liczba', () => {
    const plnOnly = buildMonthlyReport(analyze(journal, [trades[0]!]), [], journal, '2026-03')
    expect(reportLead(plnOnly)).toBe('Wynik: +2.00R · +200.00 PLN')
    const noArchive: JournalFile = {
      ...journal,
      settings: {
        ...journal.settings,
        fx: { ...journal.settings.fx, history: {}, nbp: { no: '050/A/NBP/2026', effectiveDate: '2026-03-13', fetchedAt: '2026-03-13T12:00:00.000Z', rates: { USD: 3.75 } } }
      }
    }
    const current = buildMonthlyReport(analyze(noArchive, [trades[0]!, trades[1]!]), [], noArchive, '2026-03')
    expect(current).toMatchObject({ plnTrades: 2, plnHistorical: 0, plnCurrent: 1 })
    expect(current.pln).toBeCloseTo(200 - 50 * 3.75, 9)
    expect(reportLead(current)).toBe('Wynik: +1.00R · +12.50 PLN (1 po bieżącym kursie (brak archiwum NBP))')
  })

  it('sekcja czasu analizy i selekcji, gdy w miesiącu są sesje', () => {
    let session = stopSession(startSession('Przed Londynem', ['EURUSD', 'AUDUSD'], '2026-03-16T06:00:00.000Z', null), '2026-03-16T06:45:00.000Z')
    session = setPairField(session, 'EURUSD', 'decision', 'trade')
    session = setPairField(session, 'AUDUSD', 'decision', 'reject')
    session = setPairField(session, 'AUDUSD', 'reasonIds', [journal.dictionaries.rejectReasons[1]!.id])
    const withSession = [{ ...days[0]!, sessions: [session] }, days[1]!]
    const rep = buildMonthlyReport(rows, withSession, journal, '2026-03', '2026-04-01T00:00:00.000Z')
    expect(rep.selection).toMatchObject({ sessions: 1, minutes: 45, trades: 1, fromSelection: 1 })
    const md = monthlyReportMarkdown(rep)
    expect(md).toContain('## Czas analizy i selekcja par')
    expect(md).toContain('- Sesje analizy: 1, łącznie 45 min. Pary: przeanalizowane 2, wybrane 1 (handluję 1, obserwuję 0), odrzucone 1.')
    expect(md).toContain('- Najczęstsze powody odrzucenia: Konsolidacja (1).')
    expect(r.selection).toBeNull()
  })

  it('duże kwoty z odstępem tysięcy', () => {
    const big = buildMonthlyReport(analyze(journal, [t('2026-03-16T07:30:00.000Z', 'EURUSD', 1.102, { riskAmount: 6172.5, amountCurrency: 'PLN' })]), [], journal, '2026-03')
    expect(monthlyReportMarkdown(big)).toContain('+12 345.00 PLN')
  })
})
