import { describe, expect, it } from 'vitest'
import { createDayPlan, createDefaultJournal, createTrade } from '@shared/defaults'
import { csvNumber, csvText, tradesToCsv } from '@shared/export/csv'
import { dayPlanToMarkdown, tradeToMarkdown } from '@shared/export/markdown'
import { parseTradingViewCsv, weekExtremes, weeksInBars } from '@shared/calc/ohlc'
import { newId } from '@shared/ids'

const journal = createDefaultJournal()
const model = journal.dictionaries.entryModels[0]!
const trade = createTrade({
  pair: 'EURUSD',
  direction: 'long',
  entryTime: '2026-03-16T07:30:00.000Z',
  entryModelId: model.id,
  prices: { entry: 1.085, stopLoss: 1.0835, takeProfit1: 1.088, takeProfit2: null },
  exits: [{ id: newId(), time: '2026-03-16T09:10:00.000Z', price: 1.088, percent: 100, note: 'TP1' }],
  notes: 'Sweep PDL; potem "MSS"\nwejście w FVG',
  psychology: { before: { score: 4, note: 'spokojny' }, during: { score: 3, note: '' }, after: { score: 4, note: '' }, mistakeTagIds: [], didWell: '=czekałem', nextTime: '' }
})

describe('CSV dla Excela (PL)', () => {
  const csv = tradesToCsv([trade], journal)
  const lines = csv.split('\r\n')

  it('BOM, średnik, CRLF, nagłówek po polsku', () => {
    expect(csv.startsWith('﻿ID;Data NY;Godzina NY;')).toBe(true)
    expect(csv.endsWith('\r\n')).toBe(true)
    expect(lines).toHaveLength(3)
  })

  it('przecinek dziesiętny i czasy NY/WAW', () => {
    expect(lines[1]).toContain(';2026-03-16;03:30;2026-03-16;08:30;2026-03-16T07:30:00.000Z;EURUSD;long;zamknięta;London + SB London;')
    expect(lines[1]).toContain(';1,08500;1,08350;1,08800;;')
    expect(lines[1]).toContain(';15,0;2,00;2,00;30,0;')
    expect(lines[0]).toContain(';Wynik kwota (waluta konta);Ryzyko %;Ryzyko kwota;Waluta kwot;Loty;')
  })

  it('cudzysłowy, nowe linie i neutralizacja formuł', () => {
    expect(csv).toContain('"Sweep PDL; potem ""MSS""\nwejście w FVG"')
    expect(csvText('=SUMA(A1)')).toBe("'=SUMA(A1)")
    expect(lines[1]).toContain(";'=czekałem;")
    expect(csvNumber(-1.5, 2)).toBe('-1,50')
    expect(csvNumber(null)).toBe('')
  })

  it('loty bez obcinania cyfr (krok lota 0.001)', () => {
    const row = (lots: number) => tradesToCsv([{ ...trade, lots }], journal).split('\r\n')[1]
    expect(row(0.123)).toContain(';0,123;')
    expect(row(0.4)).toContain(';0,40;')
  })
})

describe('markdown', () => {
  it('transakcja: nagłówek, tabela cen, wynik, zasady', () => {
    const md = tradeToMarkdown(trade, journal)
    expect(md).toContain('## EURUSD LONG – 2026-03-16 (pon.) 03:30 NY / 08:30 WAW')
    expect(md).toContain('| 1.08500 | 1.08350 | 1.08800 | — | 15.0 | 2.00 |')
    expect(md).toContain('**Wynik:** +2.00R (+30.0 pips)')
    expect(md).toContain('**Wyjścia:** 100% @ 1.08800 (TP1, 05:10 NY)')
    expect(md).toContain('✓ SL nie większy niż próg (SL 15.0 p ≤ 20 p)')
    expect(md).toContain(`model ${model.name}`)
  })

  it('plan dnia z biasem, newsami i transakcjami', () => {
    const d = createDayPlan('2026-03-16', ['EURUSD'], ['DXY'])
    d.pairs[0]!.bias.D = { direction: 'bullish', reason: 'nad PDH' }
    d.pairs[0]!.drawOnLiquidity = 'PWH'
    d.news.push({ id: newId(), time: '2026-03-16T12:30:00.000Z', currency: 'USD', title: 'CPI', impact: 'high' })
    d.review = { whatHappened: 'Zrealizowany scenariusz główny.', vsPlan: 'matched', notes: '' }
    const md = dayPlanToMarkdown(d, journal, [trade])
    expect(md).toContain('## Plan dnia 2026-03-16 (poniedziałek)')
    expect(md).toContain('| D | bullish | nad PDH |')
    expect(md).toContain('**Newsy high-impact:** 08:30 NY USD CPI')
    expect(md).toContain('**Wobec planu:** zgodnie z planem')
    expect(md).toContain('- 03:30 NY EURUSD long – +2.00R')
  })

  it('plan dnia: same wnioski po sesji też trafiają do markdownu, transakcje w kolejności czasu', () => {
    const d = createDayPlan('2026-03-16', ['EURUSD'], [])
    d.review = { whatHappened: '', vsPlan: null, notes: 'Jutro tylko NY.' }
    const later = createTrade({ pair: 'EURUSD', direction: 'short', entryTime: '2026-03-16T14:05:00.000Z', status: 'missed' })
    const md = dayPlanToMarkdown(d, journal, [later, trade])
    expect(md).toContain('### Po sesji')
    expect(md).toContain('**Wnioski:** Jutro tylko NY.')
    expect(md.indexOf('03:30 NY EURUSD long')).toBeLessThan(md.indexOf('10:05 NY EURUSD short'))
  })
})

describe('import OHLC z TradingView', () => {
  // M15-like bars for Mon 2026-03-09 .. Fri 2026-03-13 (US DST started 2026-03-08 → NY = UTC-4).
  const rows: string[] = ['time,open,high,low,close,Volume']
  const start = Date.UTC(2026, 2, 9, 4, 0) / 1000 // Mon 00:00 NY
  for (let d = 0; d < 5; d++) {
    for (let h = 0; h < 24; h++) {
      const t = start + d * 86400 + h * 3600
      let high = 1.09 + d * 0.001
      let low = 1.08 - d * 0.001
      if (h === 3) high += 0.002 // daily high at 03:00 NY
      if (h === 9) low -= 0.002 // daily low at 09:00 NY
      if (d === 2 && h === 3) high += 0.01 // Wednesday = week high
      if (d === 4 && h === 9) low -= 0.01 // Friday = week low
      rows.push(`${t},1.085,${high},${low},1.085,100`)
    }
  }
  // Sunday evening bar must be ignored.
  rows.push(`${start - 3 * 3600},1.1,1.2,1.0,1.1,1`)
  const csv = rows.join('\n')

  it('parsuje UNIX seconds i liczy ekstrema tygodnia w czasie NY', () => {
    const { bars, skipped } = parseTradingViewCsv(csv)
    expect(skipped).toBe(0)
    expect(weeksInBars(bars)).toEqual(['2026-W11'])
    const w = weekExtremes(bars, '2026-W11')
    expect(w.weekHighDay).toBe('wed')
    expect(w.weekLowDay).toBe('fri')
    expect(w.days[0]).toMatchObject({ day: 'mon', highTimeNy: '03:00', lowTimeNy: '09:00' })
    expect(w.days[4]?.low).toBeCloseTo(1.08 - 0.004 - 0.012, 9)
  })

  it('akceptuje czas ISO z offsetem i separator średnik', () => {
    const iso = 'time;open;high;low;close\n2026-03-10T03:00:00-04:00;1,1;1,2;1,0;1,1\n2026-03-10T05:00:00-04:00;1,1;1,3;1,05;1,1\nbad;1;1;1;1'
    const { bars, skipped } = parseTradingViewCsv(iso)
    expect(skipped).toBe(1)
    const w = weekExtremes(bars, '2026-W11')
    expect(w.days[1]).toMatchObject({ day: 'tue', high: 1.3, highTimeNy: '05:00', low: 1.0, lowTimeNy: '03:00' })
  })

  it('brak kolumn → czytelny błąd', () => {
    expect(() => parseTradingViewCsv('a,b\n1,2')).toThrow(/Export chart data/)
  })
})
