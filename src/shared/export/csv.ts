/**
 * CSV export of all trades for Excel with Polish regional settings:
 * semicolon separator, UTF-8 with BOM, CRLF line endings, decimal comma.
 */
import { formatClock, zoned } from '../calc/time'
import { tradeMetrics, metricsContext } from '../calc/trade'
import { validateTrade } from '../calc/validator'
import type { DayPlan, DictionaryKey, JournalFile, Trade } from '../schema'

const STATUS = { closed: 'zamknięta', open: 'otwarta', missed: 'missed' } as const

export function csvNumber(v: number | null | undefined, decimals?: number): string {
  if (v == null || !Number.isFinite(v)) return ''
  const s = decimals != null ? v.toFixed(decimals) : String(Number(v.toPrecision(12)))
  return s.replace('.', ',')
}

/** Quote when needed; neutralize spreadsheet formulas in free text (=, +, -, @ at the start). */
export function csvText(v: string | null | undefined): string {
  let s = v ?? ''
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  if (/[;"\r\n]/.test(s) || /^\s|\s$/.test(s)) s = `"${s.replace(/"/g, '""')}"`
  return s
}

function names(journal: JournalFile, key: DictionaryKey, ids: Array<string | null>): string {
  return ids
    .filter((x): x is string => !!x)
    .map((id) => journal.dictionaries[key].find((d) => d.id === id)?.name ?? '?')
    .join(', ')
}

const HEADERS = [
  'ID',
  'Data NY',
  'Godzina NY',
  'Data Warszawa',
  'Godzina Warszawa',
  'Wejście UTC',
  'Para',
  'Kierunek',
  'Status',
  'Killzone',
  'Model',
  'PD array wejścia',
  'PD array HTF',
  'Zebrana płynność',
  'Cena wejścia',
  'SL',
  'TP1',
  'TP2',
  'Wyjścia (cena @ %)',
  'Wyjście UTC',
  'SL pips',
  'R:R TP1',
  'Wynik R',
  'Wynik pips',
  'Wynik kwota',
  'Ryzyko %',
  'Ryzyko kwota',
  'Loty',
  'MAE pips',
  'MFE pips',
  'Zgodność %',
  'Złamane zasady',
  'SL poza płynnością',
  'Stan przed',
  'Stan w trakcie',
  'Stan po',
  'Tagi błędów',
  'Co zrobiłem dobrze',
  'Następnym razem',
  'Missed – powód',
  'Notatki',
  'TradingView',
  'Screeny'
]

export function tradesToCsv(trades: readonly Trade[], journal: JournalFile, days: readonly DayPlan[] = []): string {
  const ctx = metricsContext(journal.settings)
  const byDate = new Map(days.map((d) => [d.date, d]))
  const rows = [...trades]
    .sort((a, b) => (a.entryTime < b.entryTime ? -1 : 1))
    .map((t) => {
      const m = tradeMetrics(t, ctx)
      const v = validateTrade(t, m, journal.settings, byDate.get(m.tradingDate) ?? null)
      const dec = journal.settings.pairs.find((p) => p.symbol === t.pair)?.priceDecimals ?? 5
      const ny = zoned(t.entryTime, 'NY')
      const waw = zoned(t.entryTime, 'WAW')
      const exits = t.exits.filter((x) => x.price != null).map((x) => `${csvNumber(x.price, dec)} @ ${x.percent}%`).join(' | ')
      return [
        csvText(t.id),
        ny.toISODate() ?? '',
        formatClock(t.entryTime, 'NY'),
        waw.toISODate() ?? '',
        formatClock(t.entryTime, 'WAW'),
        t.entryTime,
        csvText(t.pair),
        t.direction === 'long' ? 'long' : 'short',
        STATUS[t.status],
        csvText(m.killzoneNames.join(' + ')),
        csvText(names(journal, 'entryModels', [t.entryModelId])),
        csvText(names(journal, 'pdArrays', [t.entryPdArrayId])),
        csvText(names(journal, 'pdArrays', [t.htfPdArrayId])),
        csvText(names(journal, 'liquidityPools', t.liquidityTakenIds)),
        csvNumber(t.prices.entry, dec),
        csvNumber(t.prices.stopLoss, dec),
        csvNumber(t.prices.takeProfit1, dec),
        csvNumber(t.prices.takeProfit2, dec),
        csvText(exits),
        m.exitTime ?? '',
        csvNumber(m.riskPips, 1),
        csvNumber(m.rrTp1, 2),
        csvNumber(m.resultR, 2),
        csvNumber(m.resultPips, 1),
        csvNumber(m.pnlAmount, 2),
        csvNumber(t.riskPercent, 2),
        csvNumber(t.riskAmount, 2),
        csvNumber(t.lots, 2),
        csvNumber(t.maePips, 1),
        csvNumber(t.mfePips, 1),
        v.score == null ? '' : String(Math.round(v.score * 100)),
        csvText(v.broken.map((b) => `${b.label}: ${b.detail}`).join(' | ')),
        t.stopBeyondLiquidity === 'yes' ? 'tak' : t.stopBeyondLiquidity === 'no' ? 'nie' : '',
        t.psychology.before.score == null ? '' : String(t.psychology.before.score),
        t.psychology.during.score == null ? '' : String(t.psychology.during.score),
        t.psychology.after.score == null ? '' : String(t.psychology.after.score),
        csvText(names(journal, 'mistakeTags', t.psychology.mistakeTagIds)),
        csvText(t.psychology.didWell),
        csvText(t.psychology.nextTime),
        csvText(t.status === 'missed' ? names(journal, 'missedReasons', [t.missed.reasonId]) : ''),
        csvText(t.notes),
        csvText(t.tradingViewUrl),
        String(t.screens.length)
      ].join(';')
    })
  return `﻿${[HEADERS.join(';'), ...rows].join('\r\n')}\r\n`
}
