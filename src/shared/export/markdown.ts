/** Markdown of a single trade or day plan – to paste into a chat or a note. */
import { formatClock, zoned } from '../calc/time'
import { metricsContext, tradeMetrics } from '../calc/trade'
import { validateTrade } from '../calc/validator'
import type { DayPlan, DictionaryKey, JournalFile, ScreenRef, Trade } from '../schema'

const STATUS = { closed: 'zamknięta', open: 'otwarta', missed: 'missed (nie wszedłem)' } as const
const PHASE = { before: 'przed', during: 'w trakcie', after: 'po' } as const
const BIAS = { bullish: 'bullish', bearish: 'bearish', neutral: 'neutral' } as const
const REL = { confirms: 'zgodny', diverges: 'dywergencja', neutral: 'bez sygnału' } as const
const VS = { matched: 'zgodnie z planem', partial: 'częściowo', missed: 'inaczej niż plan' } as const

const r2 = (v: number | null) => (v == null ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}R`)
const p1 = (v: number | null) => (v == null ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`)
const px = (v: number | null, d: number) => (v == null ? '—' : v.toFixed(d))

function names(journal: JournalFile, key: DictionaryKey, ids: Array<string | null>): string {
  return (
    ids
      .filter((x): x is string => !!x)
      .map((id) => journal.dictionaries[key].find((d) => d.id === id)?.name ?? '?')
      .join(', ') || '—'
  )
}

function screensLine(screens: ScreenRef[]): string {
  return screens
    .map((s) => [s.phase ? PHASE[s.phase] : null, s.timeframe, s.caption || null].filter(Boolean).join(' ') + ` (\`${s.path}\`)`)
    .join('; ')
}

function text(label: string, value: string): string | null {
  return value.trim() ? `**${label}:** ${value.trim()}` : null
}

export function tradeToMarkdown(t: Trade, journal: JournalFile, day: DayPlan | null = null): string {
  const m = tradeMetrics(t, metricsContext(journal.settings))
  const v = validateTrade(t, m, journal.settings, day)
  const dec = journal.settings.pairs.find((p) => p.symbol === t.pair)?.priceDecimals ?? 5
  const wd = zoned(t.entryTime, 'NY').setLocale('pl').toFormat('ccc')
  const lines: Array<string | null> = [
    `## ${t.pair} ${t.direction === 'long' ? 'LONG' : 'SHORT'} – ${m.tradingDate} (${wd}) ${formatClock(t.entryTime, 'NY')} NY / ${formatClock(t.entryTime, 'WAW')} WAW`,
    '',
    `**Status:** ${STATUS[t.status]} · **Killzone:** ${m.killzoneNames.join(' + ') || 'poza killzone'} · **Wynik:** ${r2(m.resultR)} (${p1(m.resultPips)} pips)${t.status === 'missed' ? ' – hipotetycznie' : ''}`,
    '',
    '| Wejście | SL | TP1 | TP2 | SL pips | R:R TP1 |',
    '|---|---|---|---|---|---|',
    `| ${px(t.prices.entry, dec)} | ${px(t.prices.stopLoss, dec)} | ${px(t.prices.takeProfit1, dec)} | ${px(t.prices.takeProfit2, dec)} | ${m.riskPips == null ? '—' : m.riskPips.toFixed(1)} | ${m.rrTp1 == null ? '—' : m.rrTp1.toFixed(2)} |`,
    '',
    t.exits.some((x) => x.price != null)
      ? `**Wyjścia:** ${t.exits
          .filter((x) => x.price != null)
          .map((x) => `${x.percent}% @ ${px(x.price, dec)}${x.note ? ` (${x.note}${x.time ? `, ${formatClock(x.time, 'NY')} NY` : ''})` : x.time ? ` (${formatClock(x.time, 'NY')} NY)` : ''}`)
          .join(', ')}`
      : null,
    t.maePips != null || t.mfePips != null ? `**MAE / MFE:** ${t.maePips ?? '—'} / ${t.mfePips ?? '—'} pips` : null,
    `**Kontekst ICT:** model ${names(journal, 'entryModels', [t.entryModelId])} · PD array ${names(journal, 'pdArrays', [t.entryPdArrayId])} · HTF ${names(journal, 'pdArrays', [t.htfPdArrayId])} · płynność ${names(journal, 'liquidityPools', t.liquidityTakenIds)}`,
    `**Zasady${v.score == null ? '' : ` (${Math.round(v.score * 100)}%)`}:** ${v.rules.map((r) => `${r.status === 'pass' ? '✓' : r.status === 'fail' ? '✗' : r.status === 'info' ? '!' : '–'} ${r.label} (${r.detail})`).join(' · ') || '—'}`,
    `**Psychologia:** przed ${t.psychology.before.score ?? '—'}/5${t.psychology.before.note ? ` (${t.psychology.before.note})` : ''} · w trakcie ${t.psychology.during.score ?? '—'}/5${t.psychology.during.note ? ` (${t.psychology.during.note})` : ''} · po ${t.psychology.after.score ?? '—'}/5${t.psychology.after.note ? ` (${t.psychology.after.note})` : ''} · błędy: ${names(journal, 'mistakeTags', t.psychology.mistakeTagIds)}`,
    t.status === 'missed' ? `**Powód (missed):** ${names(journal, 'missedReasons', [t.missed.reasonId])}` : null,
    text('Co zrobiłem dobrze', t.psychology.didWell),
    text('Następnym razem', t.psychology.nextTime),
    text('Notatki', t.notes),
    t.tradingViewUrl ? `**TradingView:** ${t.tradingViewUrl}` : null,
    t.screens.length ? `**Screeny:** ${screensLine(t.screens)}` : null
  ]
  return `${lines.filter((l) => l !== null).join('\n')}\n`
}

export function dayPlanToMarkdown(d: DayPlan, journal: JournalFile, trades: readonly Trade[] = []): string {
  const wd = zoned(`${d.date}T16:00:00.000Z`, 'NY').setLocale('pl').toFormat('cccc')
  const out: string[] = [`## Plan dnia ${d.date} (${wd})`, '']
  for (const p of d.pairs) {
    const dec = journal.settings.pairs.find((x) => x.symbol === p.pair)?.priceDecimals ?? 5
    out.push(`### ${p.pair}`, '', '| TF | Bias | Uzasadnienie |', '|---|---|---|')
    for (const tf of ['W', 'D', 'H4', 'H1'] as const) {
      const b = p.bias[tf]
      out.push(`| ${tf} | ${b.direction ? BIAS[b.direction] : '—'} | ${b.reason.replace(/\|/g, '/') || ''} |`)
    }
    out.push('')
    if (p.drawOnLiquidity.trim()) out.push(`**Draw on liquidity:** ${p.drawOnLiquidity.trim()}`)
    if (p.keyLevels.length) out.push(`**Poziomy:** ${p.keyLevels.map((l) => `${l.label || 'poziom'} ${l.price == null ? '—' : l.price.toFixed(dec)}`).join(' · ')}`)
    if (p.scenarioPrimary.trim()) out.push(`**Scenariusz główny:** ${p.scenarioPrimary.trim()}`)
    if (p.scenarioAlternative.trim()) out.push(`**Scenariusz alternatywny:** ${p.scenarioAlternative.trim()}`)
    if (p.screens.length) out.push(`**Screeny:** ${screensLine(p.screens)}`)
    out.push('')
  }
  const im = d.intermarket.filter((x) => x.relation || x.read.trim())
  if (im.length) out.push(`**Intermarket:** ${im.map((x) => `${x.instrument} ${x.relation ? REL[x.relation] : ''}${x.read.trim() ? ` (${x.read.trim()})` : ''}`.trim()).join(' · ')}`)
  if (d.news.length)
    out.push(`**Newsy high-impact:** ${[...d.news].sort((a, b) => (a.time < b.time ? -1 : 1)).map((n) => `${formatClock(n.time, 'NY')} NY ${n.currency} ${n.title}`.trim()).join(' · ')}`)
  if (d.review.vsPlan || d.review.whatHappened.trim()) {
    out.push('', '### Po sesji', '')
    if (d.review.vsPlan) out.push(`**Wobec planu:** ${VS[d.review.vsPlan]}`)
    if (d.review.whatHappened.trim()) out.push(d.review.whatHappened.trim())
    if (d.review.notes.trim()) out.push(`**Wnioski:** ${d.review.notes.trim()}`)
  }
  const ctx = metricsContext(journal.settings)
  const dayTrades = trades.filter((t) => tradeMetrics(t, ctx).tradingDate === d.date)
  if (dayTrades.length) {
    out.push('', '### Transakcje', '')
    for (const t of dayTrades) {
      const m = tradeMetrics(t, ctx)
      out.push(`- ${formatClock(t.entryTime, 'NY')} NY ${t.pair} ${t.direction} – ${t.status === 'missed' ? 'missed' : r2(m.resultR)}`)
    }
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n')}\n`
}
