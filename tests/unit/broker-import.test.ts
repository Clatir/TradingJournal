import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createTrade } from '@shared/defaults'
import { parseBrokerRows, parseBrokerSheets, parseBrokerTime, parseNumber } from '@shared/import/broker'
import { applyBrokerMatch, brokerTimeToUtc, matchBrokerTrades, pairForSymbol, tradeFromBroker, type BrokerMatch } from '@shared/import/match'
import { decodeText, excelSerialToText, htmlRows, parseCsv, textRows, xlsxDateStyles, xlsxSharedStrings, xlsxSheetRows, xlsxSheets } from '@shared/import/tables'
import { tradeSchema, type Trade } from '@shared/schema'

// MT4 "Save as Detailed Report" (simplified): account block, closed transactions with a deposit, a partial close
// (two tickets, same open time and price), a cancelled pending order, totals, then the next section.
const MT4_HTML = readFileSync(join(__dirname, '../fixtures/broker-mt4-statement.htm'), 'utf8')

// MT5 report saved by a Polish Excel as CSV: semicolons, decimal commas, Polish headers ("Czas" and "Cena" twice).
const MT5_CSV = [
  'Raport transakcji;;;;;;;;;;;;',
  'Nazwa:;Trader;;;;;;;;;;;',
  'Konto:;5555 (USD, Demo, Hedge);;;;;;;;;;;',
  'Pozycje;;;;;;;;;;;;',
  'Czas;Pozycja;Symbol;Typ;Wolumen;Cena;S / L;T / P;Czas;Cena;Prowizja;Swap;Zysk',
  '2026.10.05 15:30:00;7001;EURUSD.pro;buy;0,3;1,08500;1,08300;;2026.10.05 18:00:00;1,08700;-2,10;0,00;60,00',
  '2026.10.06 16:05:30;7002;GBPUSD.pro;sell;0,2;1,30000;1,30200;1,29500;2026.10.06 16:40:00;1,30200;-1,40;-0,35;-40,00',
  ';;;;;;;;;;;;',
  'Zlecenia;;;;;;;;;;;;',
  'Czas otwarcia;Zlecenie;Symbol;Typ;Wolumen;Cena;S / L;T / P;Czas;Stan;Komentarz;;',
  '2026.10.05 15:30:00;9001;EURUSD.pro;buy;0,3 / 0,3;market;;;2026.10.05 15:30:00;filled;;;'
].join('\r\n')

// XTB xStation "closed positions" (English export): account block, header further down, Polish time, rollover.
const XTB_ROWS = [
  ['Name and surname', 'Trader'],
  ['Account', '12345678'],
  ['Currency', 'PLN'],
  [],
  ['Position', 'Symbol', 'Type', 'Volume', 'Open time', 'Open price', 'Close time', 'Close price', 'Open origin', 'Close origin', 'Purchase value', 'Sale value', 'SL', 'TP', 'Margin', 'Commission', 'Swap', 'Rollover', 'Gross P/L', 'Comment'],
  ['900001', 'EURUSD', 'BUY', '0.5', '05.10.2026 13:30:00', '1.085', '05.10.2026 16:00:00', '1.087', 'xStation5', 'xStation5', '', '', '1.083', '0', '', '0', '0', '-0.5', '385.4', ''],
  ['900002', 'AUDUSD', 'SELL', '1', '06.10.2026 08:15:00', '0.66', '', '', 'xStation5', '', '', '', '0', '0', '', '0', '0', '0', '', '']
]

describe('pliki od brokera → wiersze', () => {
  it('kodowanie: BOM UTF-8 / UTF-16, bez BOM UTF-8, inaczej Windows-1250', () => {
    const text = 'Czas zamknięcia;Zysk'
    const utf16 = new Uint8Array([0xff, 0xfe, ...Array.from(text).flatMap((ch) => [ch.charCodeAt(0) & 0xff, ch.charCodeAt(0) >> 8])])
    expect(decodeText(utf16)).toBe(text)
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(text)]))).toBe(text)
    expect(decodeText(new TextEncoder().encode(text))).toBe(text)
    const cp1250 = new Uint8Array([...new TextEncoder().encode('Czas zamkni'), 0xea, ...new TextEncoder().encode('cia')])
    expect(decodeText(cp1250)).toBe('Czas zamknięcia')
  })

  it('CSV: separator, cudzysłowy, CRLF', () => {
    expect(parseCsv('a;b;c\r\n"x;y";"z ""q""";3\r\n')).toEqual([
      ['a', 'b', 'c'],
      ['x;y', 'z "q"', '3']
    ])
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2']
    ])
    expect(parseCsv('a\tb,c\n1\t2,5')).toEqual([
      ['a', 'b,c'],
      ['1', '2,5']
    ])
  })

  it('HTML: ukryte komórki (MT5) nie zajmują kolumny', () => {
    expect(htmlRows('<table><tr><td>2026.10.05</td><td class="hidden" colspan="8"></td><td>EURUSD</td></tr></table>')).toEqual([['2026.10.05', 'EURUSD']])
  })

  it('HTML: komórki bez znaczników, encje, colspan rozwinięty w puste komórki', () => {
    const rows = htmlRows('<table><tr><td colspan=2><b>A &amp; B</b></td><td>S&nbsp;/&nbsp;L</td></tr><tr><th>x<br>y</th><td>&#8722;1</td></table>')
    expect(rows).toEqual([
      ['A & B', '', 'S / L'],
      ['x y', '−1']
    ])
    expect(textRows('<html><table><tr><td>1</td></tr></table>')).toEqual([['1']])
    expect(textRows('a;b')).toEqual([['a', 'b']])
  })

  it('XLSX: arkusze, wspólne teksty, tekst w komórce, daty ze stylu', () => {
    const shared = xlsxSharedStrings('<sst><si><t>Open time</t></si><si><r><t>EUR</t></r><r><t xml:space="preserve">USD</t></r></si></sst>')
    expect(shared).toEqual(['Open time', 'EURUSD'])
    const styles = xlsxDateStyles(
      '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="dd/mm/yyyy\\ hh:mm:ss"/><numFmt numFmtId="165" formatCode="#,##0.00\\ &quot;zł&quot;"/></numFmts><cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="165"/><xf numFmtId="22"/></cellXfs></styleSheet>'
    )
    expect([...styles]).toEqual([1, 3])
    const sheet =
      '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>' +
      '<row r="2"><c r="A2" s="1"><v>46300.5625</v></c><c r="B2" t="inlineStr"><is><t>BUY</t></is></c><c r="C2" s="2"><v>12.5</v></c><c r="D2"/></row></sheetData></worksheet>'
    expect(xlsxSheetRows(sheet, shared, styles)).toEqual([
      ['Open time', '', 'EURUSD'],
      ['2026-10-05 13:30:00', 'BUY', '12.5', '']
    ])
    expect(excelSerialToText(46300)).toBe('2026-10-05 00:00:00')
    expect(
      xlsxSheets(
        '<workbook><sheets><sheet name="CLOSED POSITION HISTORY" sheetId="1" r:id="rId1"/><sheet name="CASH &amp; OPS" sheetId="2" r:id="rId2"/></sheets></workbook>',
        '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>'
      )
    ).toEqual([
      { name: 'CLOSED POSITION HISTORY', path: 'xl/worksheets/sheet1.xml' },
      { name: 'CASH & OPS', path: 'xl/worksheets/sheet2.xml' }
    ])
  })

  it('liczby i czasy w formatach brokerów', () => {
    expect([parseNumber('1 234,56'), parseNumber('1,234.56'), parseNumber('1.234,56'), parseNumber('1,08523'), parseNumber('−3.20'), parseNumber('10 000.00')]).toEqual([
      1234.56, 1234.56, 1234.56, 1.08523, -3.2, 10000
    ])
    expect([parseNumber(''), parseNumber('cancelled'), parseNumber('0,3 / 0,3')]).toEqual([null, null, null])
    expect(parseBrokerTime('2026.10.05 09:30')).toBe('2026-10-05T09:30:00')
    expect(parseBrokerTime('05.10.2026 13:30:15')).toBe('2026-10-05T13:30:15')
    expect(parseBrokerTime('2026-10-05T13:30:15')).toBe('2026-10-05T13:30:15')
    expect(parseBrokerTime('05/10/2026 13:30')).toBe('2026-10-05T13:30:00')
    expect(parseBrokerTime('2026.13.05 09:30')).toBeNull()
    expect(parseBrokerTime('Deposit')).toBeNull()
  })
})

describe('historia pozycji: MT4, MT5, XTB', () => {
  it('MT4 (raport HTML): pozycje zamknięte, partiale scalone, wpłata i zlecenie oczekujące pominięte, koniec na „Open Trades”', () => {
    const t = parseBrokerRows(htmlRows(MT4_HTML))!
    expect(t.format).toBe('mt4')
    expect(t.currency).toBe('USD')
    expect(t.merged).toBe(1)
    expect(t.skipped.map((s) => s.reason)).toEqual(['typ „balance”', 'typ „buy limit”'])
    expect(t.trades).toHaveLength(2)
    expect(t.trades[0]).toMatchObject({
      tickets: ['50001'],
      symbol: 'eurusd',
      direction: 'long',
      volume: 0.5,
      openTime: '2026-10-01T14:30:00',
      openPrice: 1.085,
      closeTime: '2026-10-01T17:45:10',
      closePrice: 1.088,
      stopLoss: 1.0835,
      takeProfit: 1.088,
      profit: 150,
      commission: -3.5,
      swap: 0,
      net: 146.5
    })
    const gbp = t.trades[1]!
    expect(gbp).toMatchObject({ tickets: ['50002', '50004'], direction: 'short', volume: 1, closeTime: '2026-10-02T18:30:00', takeProfit: null, profit: 260, commission: -3.5, swap: -0.4 })
    expect(gbp.closePrice).toBeCloseTo((1.298 + 1.2968) / 2, 9)
    expect(gbp.net).toBeCloseTo(256.1, 9)
    expect(gbp.exits).toEqual([
      { time: '2026-10-02T16:00:00', price: 1.298, volume: 0.5 },
      { time: '2026-10-02T18:30:00', price: 1.2968, volume: 0.5 }
    ])
  })

  it('MT5 (CSV z polskiego Excela): „Czas” i „Cena” dwa razy, sekcja „Zlecenia” nie jest czytana', () => {
    const t = parseBrokerRows(parseCsv(MT5_CSV))!
    expect(t.format).toBe('mt5')
    expect(t.currency).toBe('USD')
    expect(t.trades.map((x) => [x.tickets[0], x.symbol, x.direction, x.volume, x.openTime, x.openPrice, x.closeTime, x.closePrice, x.net])).toEqual([
      ['7001', 'EURUSD.pro', 'long', 0.3, '2026-10-05T15:30:00', 1.085, '2026-10-05T18:00:00', 1.087, 57.9],
      ['7002', 'GBPUSD.pro', 'short', 0.2, '2026-10-06T16:05:30', 1.3, '2026-10-06T16:40:00', 1.302, -41.75]
    ])
    expect(t.trades[1]!.takeProfit).toBe(1.295)
  })

  it('XTB (arkusz): nagłówek niżej, waluta konta, rollover w swapie, pozycja otwarta bez zamknięcia', () => {
    const t = parseBrokerSheets([
      { name: 'CASH OPERATION HISTORY', rows: [['ID', 'Type', 'Time', 'Amount']] },
      { name: 'CLOSED POSITION HISTORY', rows: XTB_ROWS }
    ])!
    expect(t.sheet).toBe('CLOSED POSITION HISTORY')
    expect(t.format).toBe('xtb')
    expect(t.currency).toBe('PLN')
    expect(t.trades[0]).toMatchObject({ tickets: ['900001'], direction: 'long', openTime: '2026-10-05T13:30:00', closePrice: 1.087, swap: -0.5, profit: 385.4, net: 384.9, stopLoss: 1.083, takeProfit: null })
    expect(t.trades[1]).toMatchObject({ direction: 'short', closeTime: null, closePrice: null, exits: [], net: null })
  })

  it('XTB po polsku', () => {
    const rows = [
      ['Pozycja', 'Symbol', 'Typ', 'Wolumen', 'Czas otwarcia', 'Cena otwarcia', 'Czas zamknięcia', 'Cena zamknięcia', 'SL', 'TP', 'Prowizja', 'Swap', 'Rollover', 'Zysk/Strata brutto'],
      ['1', 'EURUSD', 'Sprzedaż', '0,1', '05.10.2026 13:30:00', '1,085', '05.10.2026 14:00:00', '1,084', '0', '0', '0', '0', '0', '38,9']
    ]
    const t = parseBrokerRows(rows)!
    expect(t.format).toBe('xtb')
    expect(t.trades[0]).toMatchObject({ direction: 'short', volume: 0.1, closePrice: 1.084, net: 38.9 })
  })

  it('bez rozpoznanego nagłówka – null', () => {
    expect(parseBrokerRows([['a', 'b'], ['1', '2']])).toBeNull()
    expect(parseBrokerSheets([{ name: 'x', rows: [['a']] }])).toBeNull()
  })
})

describe('dopasowanie do dziennika', () => {
  it('czas serwera MT = NY + 7 h (także przy zmianie czasu), Warszawa, UTC', () => {
    expect(brokerTimeToUtc('2026-10-01T14:30:00', 'mt')).toBe('2026-10-01T11:30:00.000Z') // 07:30 EDT
    expect(brokerTimeToUtc('2026-01-15T14:30:00', 'mt')).toBe('2026-01-15T12:30:00.000Z') // 07:30 EST
    // 29.10.2026: Europe already on winter time, New York still on summer time – server time follows New York.
    expect(brokerTimeToUtc('2026-10-29T14:30:00', 'mt')).toBe('2026-10-29T11:30:00.000Z')
    expect(brokerTimeToUtc('2026-10-05T13:30:00', 'Europe/Warsaw')).toBe('2026-10-05T11:30:00.000Z')
    expect(brokerTimeToUtc('2026-10-05T13:30:00', 'UTC')).toBe('2026-10-05T13:30:00.000Z')
  })

  it('symbol brokera → para z dziennika', () => {
    const pairs = ['EURUSD', 'GBPUSD', 'XAUUSD', 'WTI']
    expect(pairForSymbol('eurusd', pairs)).toBe('EURUSD')
    expect(pairForSymbol('EURUSD.pro', pairs)).toBe('EURUSD')
    expect(pairForSymbol('GBPUSDm', pairs)).toBe('GBPUSD')
    expect(pairForSymbol('#XAUUSD', pairs)).toBe('XAUUSD')
    expect(pairForSymbol('OIL.WTI', pairs)).toBe('WTI')
    expect(pairForSymbol('US500', pairs)).toBeNull()
  })

  const pairs = ['EURUSD', 'GBPUSD']
  const journal = (over: Partial<Trade>[]): Trade[] =>
    over.map((o) => createTrade({ pair: 'EURUSD', direction: 'long', entryTime: '2026-10-01T11:30:00.000Z', ...o }))

  it('para + kierunek + czas wejścia w tolerancji, najbliższy pierwszy, jeden do jednego; już zaimportowane po tickecie', () => {
    const positions = parseBrokerRows(htmlRows(MT4_HTML))!.trades
    const trades = journal([
      { entryTime: '2026-10-01T11:33:00.000Z' }, // EURUSD long, 3 min after the broker
      { entryTime: '2026-10-01T11:29:00.000Z' }, // nearer (1 min before) – wins
      { pair: 'GBPUSD', direction: 'long', entryTime: '2026-10-02T12:00:00.000Z' }, // wrong direction
      { pair: 'GBPUSD', direction: 'short', entryTime: '2026-10-02T12:00:00.000Z', status: 'missed' }, // missed never matches
      { pair: 'GBPUSD', direction: 'short', entryTime: '2026-10-03T09:00:00.000Z' } // after the last close – not listed
    ])
    const r = matchBrokerTrades(positions, trades, pairs, { zone: 'mt', toleranceMinutes: 5 })
    expect(r.matches.map((m) => [m.status, m.tradeId, m.diffMinutes])).toEqual([
      ['matched', trades[1]!.id, -1],
      ['new', null, null]
    ])
    expect(r.matches[1]!.openUtc).toBe('2026-10-02T12:00:00.000Z')
    expect(r.journalOnly.map((t) => t.id)).toEqual([trades[0]!.id, trades[2]!.id])

    const [first] = journal([{ entryTime: '2026-10-01T11:30:00.000Z' }])
    const linked = applyBrokerMatch(first!, matchBrokerTrades(positions, [first!], pairs, { zone: 'mt', toleranceMinutes: 5 }).matches[0]!, OPTS).trade
    const again = matchBrokerTrades(positions, [linked], pairs, { zone: 'mt', toleranceMinutes: 5 })
    expect(again.matches[0]).toMatchObject({ status: 'imported', tradeId: linked.id, diffMinutes: 0 })
    // Linked by ticket even far outside the tolerance (the entry time was corrected by hand).
    const moved = { ...linked, entryTime: '2026-10-01T13:00:00.000Z' }
    expect(matchBrokerTrades(positions, [moved], pairs, { zone: 'mt', toleranceMinutes: 5 }).matches[0]).toMatchObject({ status: 'imported', diffMinutes: 90 })
  })

  it('nieznany symbol i zły czas', () => {
    const r = matchBrokerTrades(parseBrokerRows(parseCsv(MT5_CSV))!.trades, [], ['EURUSD'], { zone: 'mt', toleranceMinutes: 5 })
    expect(r.matches.map((m) => m.status)).toEqual(['new', 'unknown-symbol'])
  })

  const OPTS = { currency: 'USD', defaultAmountCurrency: 'USD', overwrite: false, now: '2026-10-05T12:00:00.000Z', zone: 'mt' as const }
  const matchOf = (trades: Trade[], index = 0): BrokerMatch => matchBrokerTrades(parseBrokerRows(htmlRows(MT4_HTML))!.trades, trades, pairs, { zone: 'mt', toleranceMinutes: 5 }).matches[index]!

  it('uzupełnienie wpisu: puste pola z raportu, wynik netto w walucie konta brokera, dane brokera zapisane', () => {
    const [t] = journal([{ status: 'open', prices: { entry: 1.0851, stopLoss: 1.0836, takeProfit1: null, takeProfit2: null } }])
    const { trade, note } = applyBrokerMatch(t!, matchOf([t!]), OPTS)
    expect(note.currencyConflict).toBe(false)
    expect(trade.status).toBe('closed')
    expect(trade.prices).toMatchObject({ entry: 1.0851, stopLoss: 1.0836, takeProfit1: 1.088 }) // entry kept, TP filled
    expect(trade.exits.map(({ id: _id, ...x }) => x)).toEqual([{ time: '2026-10-01T14:45:10.000Z', price: 1.088, percent: 100, note: '' }])
    expect(trade.lots).toBe(0.5)
    expect(trade.pnlAmountOverride).toBe(146.5)
    expect(trade.amountCurrency).toBe('USD')
    expect(trade.broker).toMatchObject({ tickets: ['50001'], net: 146.5, commission: -3.5, currency: 'USD', openTime: '2026-10-01T11:30:00.000Z', importedAt: OPTS.now })
    expect(tradeSchema.safeParse(trade).success).toBe(true)
  })

  it('bez nadpisywania wpisane wartości zostają; z nadpisaniem – wartości brokera', () => {
    const [t] = journal([{ lots: 0.4, pnlAmountOverride: 140, amountCurrency: 'USD', exits: [{ id: '01K6H3Z0W8Q4M2N5P7R9S1T3V5', time: null, price: 1.0879, percent: 100, note: '' }] }])
    const kept = applyBrokerMatch(t!, matchOf([t!]), OPTS).trade
    expect([kept.lots, kept.pnlAmountOverride, kept.exits[0]!.price]).toEqual([0.4, 140, 1.0879])
    const over = applyBrokerMatch(t!, matchOf([t!]), { ...OPTS, overwrite: true }).trade
    expect([over.lots, over.pnlAmountOverride, over.exits[0]!.price, over.prices.entry]).toEqual([0.5, 146.5, 1.088, 1.085])
  })

  it('kwota ryzyka w innej walucie niż konto brokera – wynik nie jest ustawiany (flaga)', () => {
    const [t] = journal([{ riskAmount: 200, amountCurrency: 'PLN' }])
    const r = applyBrokerMatch(t!, matchOf([t!]), OPTS)
    expect(r.note.currencyConflict).toBe(true)
    expect(r.trade.pnlAmountOverride).toBeNull()
    expect(r.trade.amountCurrency).toBe('PLN')
    // Old entries without their own currency use the default one.
    const legacy = applyBrokerMatch({ ...t!, amountCurrency: null }, matchOf([t!]), { ...OPTS, defaultAmountCurrency: 'PLN' })
    expect(legacy.note.currencyConflict).toBe(true)
  })

  it('pozycja zaimportowana jako otwarta (albo przed ostatnim partialem) wraca do uzupełnienia po zmianie u brokera', () => {
    const all = parseBrokerRows(htmlRows(MT4_HTML))!.trades
    const gbp = all[1]!
    // First import: only the first part was closed (one exit, half the volume, its own result).
    const firstPart = { ...gbp, tickets: ['50002'], volume: 0.5, exits: [gbp.exits[0]!], closeTime: gbp.exits[0]!.time, closePrice: 1.298, net: 96.5 }
    const [t] = journal([{ pair: 'GBPUSD', direction: 'short', entryTime: '2026-10-02T12:00:00.000Z' }])
    const m1 = matchBrokerTrades([firstPart], [t!], pairs, { zone: 'mt', toleranceMinutes: 5 }).matches[0]!
    const after1 = applyBrokerMatch(t!, m1, OPTS).trade
    expect([after1.lots, after1.pnlAmountOverride, after1.exits.length]).toEqual([0.5, 96.5, 1])
    expect(matchBrokerTrades([firstPart], [after1], pairs, { zone: 'mt', toleranceMinutes: 5 }).matches[0]!.status).toBe('imported')
    // The whole position later: matched again by ticket, the values of the first import are replaced.
    const m2 = matchBrokerTrades([gbp], [after1], pairs, { zone: 'mt', toleranceMinutes: 5 }).matches[0]!
    expect(m2).toMatchObject({ status: 'matched', tradeId: t!.id })
    const after2 = applyBrokerMatch(after1, m2, OPTS).trade
    expect([after2.lots, after2.pnlAmountOverride, after2.exits.map((x) => x.percent)]).toEqual([1, 256.1, [50, 50]])
    // A value typed by hand after the first import stays.
    const typed = applyBrokerMatch({ ...after1, pnlAmountOverride: 90 }, m2, OPTS).trade
    expect(typed.pnlAmountOverride).toBe(90)
  })

  it('nowy wpis z pozycji: wyjścia z partiali, SL tylko po stronie straty', () => {
    const m = matchOf([], 1)
    const t = tradeFromBroker(m, OPTS)!
    expect(tradeSchema.safeParse(t).success).toBe(true)
    expect(t).toMatchObject({ pair: 'GBPUSD', direction: 'short', status: 'closed', entryTime: '2026-10-02T12:00:00.000Z', lots: 1, amountCurrency: 'USD' })
    expect(t.prices).toEqual({ entry: 1.3, stopLoss: 1.302, takeProfit1: null, takeProfit2: null })
    expect(t.exits.map((x) => [x.time, x.price, x.percent])).toEqual([
      ['2026-10-02T13:00:00.000Z', 1.298, 50],
      ['2026-10-02T15:30:00.000Z', 1.2968, 50]
    ])
    expect(t.pnlAmountOverride).toBe(256.1)
    expect(t.broker?.tickets).toEqual(['50002', '50004'])
    // Stop moved to break-even (= entry) or into profit is not the initial stop.
    const be = { ...m, broker: { ...m.broker, stopLoss: 1.3 } }
    expect(tradeFromBroker(be, OPTS)!.prices.stopLoss).toBeNull()
    expect(tradeFromBroker({ ...m, pair: null }, OPTS)).toBeNull()
  })
})
