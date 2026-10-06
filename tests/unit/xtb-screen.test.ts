import { describe, expect, it } from 'vitest'
import { createTrade } from '@shared/defaults'
import {
  applyScreenValues,
  changedScreenFields,
  cleanSymbol,
  combineXtb,
  expectedGross,
  matchInstrument,
  mergeXtb,
  pairFromDescription,
  positionFromTexts,
  resultMismatch,
  valueCharset,
  ocrNumber,
  ocrTime,
  parseTesseractTsv,
  parseXtbScreen,
  screenValues,
  xtbMissing,
  xtbWarnings,
  type OcrWord,
  type XtbPosition
} from '@shared/import/xtbScreen'

let lineSeq = 0
/** One OCR line: words placed left to right from `left` (16 px per character, 12 px gaps). */
function line(text: string, left: number, top: number, height = 30): OcrWord[] {
  const id = `1.${++lineSeq}.1`
  let x = left
  return text.split(' ').map((t) => {
    const w: OcrWord = { text: t, left: x, top, width: t.length * 16, height, conf: 90, line: id }
    x += w.width + 12
    return w
  })
}

/** XTB "Szczegóły pozycji" (dark theme, OCR of the 3× enlarged screenshot): four rows of four columns. */
function xtbPanel(over: Partial<Record<string, string | null>> = {}): OcrWord[] {
  const v = (k: string, d: string): string | null => (k in over ? (over[k] ?? null) : d)
  const cols = [63, 429, 795, 1161]
  const grid: Array<[number, Array<[string | null, string | null, string | null]>]> = [
    [321, [[v('l.type', 'Typ'), v('type', 'Sell'), null], [v('l.volume', 'Wolumen'), v('volume', '0.01'), null], [v('l.profit', 'Zysk/strata'), v('profit', '-7.06'), null], [v('l.gross', 'Zysk brutto'), v('gross', '-7.06'), null]]],
    [527, [[v('l.openPrice', 'Cena otwarcia'), v('openPrice', '1.12414'), null], [v('l.closePrice', 'Cena zamknięcia'), v('closePrice', '1.12595'), null], [v('l.openTime', 'Czas otwarcia'), v('openDate', '06.10.2026'), v('openClock', '09:58')], [v('l.closeTime', 'Czas zamknięcia'), v('closeDate', '06.10.2026'), v('closeClock', '13:22')]]],
    [733, [[v('l.rollover', 'Rolowanie'), v('rollover', '0.00'), null], [v('l.margin', 'Depozyt zabezpiec...'), v('margin', '145.61'), null], [v('l.swap', 'Swap'), v('swap', '0.00'), null], [v('l.commission', 'Prowizja'), v('commission', '0.00'), null]]],
    [939, [[v('l.sl', 'Stop Loss'), v('sl', '1.12643'), null], [v('l.tp', 'Take Profit'), v('tp', '1.10843'), null], [null, null, null], [null, null, null]]]
  ]
  const desc = v('desc', 'Euro to American Dollar currency pair')
  const words: OcrWord[] = [...line(v('title', 'Szczegóły pozycji')!, 63, 48, 61), ...line(v('symbol', 'EURUSD CFD')!, 155, 157, 60), ...(desc ? line(desc, 160, 228, 24) : [])]
  for (const [top, cells] of grid) {
    cells.forEach(([label, value, second], i) => {
      if (label) words.push(...line(label, cols[i]!, top, 33))
      if (value) words.push(...line(value, cols[i]! + 1, top + 51, 30))
      if (second) words.push(...line(second, cols[i]! + 1, top + 97, 27))
    })
  }
  return words
}

describe('screen XTB → pozycja', () => {
  it('odczytuje wszystkie pola panelu „Szczegóły pozycji”', () => {
    const p = parseXtbScreen(xtbPanel())!
    expect(p).toMatchObject({
      symbol: 'EURUSD',
      direction: 'short',
      volume: 0.01,
      profit: -7.06,
      gross: -7.06,
      openPrice: 1.12414,
      closePrice: 1.12595,
      openTime: '2026-10-06T09:58:00',
      closeTime: '2026-10-06T13:22:00',
      rollover: 0,
      margin: 145.61,
      swap: 0,
      commission: 0,
      stopLoss: 1.12643,
      takeProfit: 1.10843
    })
    expect(xtbMissing(p)).toEqual([])
    expect(xtbWarnings(p)).toEqual([])
  })

  it('błędy OCR w etykietach i liczbach (bez polskich znaków, literówki, O zamiast 0)', () => {
    const p = parseXtbScreen(
      xtbPanel({ title: 'Szczegély pozyciji', 'l.gross': 'Zysk beutto', 'l.closeTime': 'Czas zamknigcia', 'l.closePrice': 'Cena zamkniecia', profit: '—7.O6', symbol: 'EURUSD Cr' })
    )!
    expect(p.symbol).toBe('EURUSD')
    expect(p.profit).toBe(-7.06)
    expect(p.gross).toBe(-7.06)
    expect(p.closePrice).toBe(1.12595)
    expect(p.closeTime).toBe('2026-10-06T13:22:00')
  })

  it('cena bez kropki dziesiętnej wraca do skali pozostałych cen (z ostrzeżeniem); symbol sklejony z „CFD”', () => {
    const p = parseXtbScreen(xtbPanel({ openPrice: '112414', symbol: 'EURUSDcrD' }))!
    expect(p.openPrice).toBe(1.12414)
    expect(p.undotted).toEqual(['openPrice'])
    expect(p.symbol).toBe('EURUSD')
    expect(xtbWarnings(p)).toEqual(['Bez kropki dziesiętnej odczytano: cena otwarcia – sprawdź (cena dopasowana do skali pozostałych).'])
    // Another pass that read it with the point wins.
    const merged = mergeXtb(p, parseXtbScreen(xtbPanel({ openPrice: '1.12415' })))!
    expect(merged.openPrice).toBe(1.12415)
    expect(merged.undotted).toEqual([])
    // Oil: 90.37 vs a lost point in "8683".
    const oil = parseXtbScreen(xtbPanel({ openPrice: '90.37', closePrice: '8683', sl: '90.84', tp: '86.83' }))!
    expect(oil.closePrice).toBe(86.83)
    // No price with a point to compare with: kept, marked, and replaced by a pass that read the point.
    const bare = parseXtbScreen(xtbPanel({ openPrice: '11244', closePrice: null, sl: null, tp: null }))!
    expect(bare.openPrice).toBe(11244)
    expect(bare.undotted).toEqual(['openPrice'])
    const fixed = mergeXtb(bare, parseXtbScreen(xtbPanel({ closePrice: '112595', sl: '1.12643' })))!
    expect(fixed.openPrice).toBe(1.12414)
    expect(fixed.closePrice).toBe(1.12595)
    expect(fixed.undotted).toEqual(['closePrice'])
  })

  it('brak rozpoznanej etykiety nie skleja wartości dwóch kolumn', () => {
    const p = parseXtbScreen(xtbPanel({ 'l.margin': null }))!
    expect(p.rollover).toBe(0)
    expect(p.margin).toBeNull()
    expect(p.swap).toBe(0)
  })

  it('pusta wartość nie bierze wartości z następnego wiersza; 0 jako SL / TP = brak', () => {
    const p = parseXtbScreen(xtbPanel({ volume: null, tp: '0.00' }))!
    expect(p.volume).toBeNull()
    expect(p.takeProfit).toBeNull()
    expect(xtbMissing(p)).toEqual(['wolumen'])
  })

  it('układ „etykieta wartość” w jednym wierszu (xStation po angielsku), Buy', () => {
    const rows = ['Type Buy', 'Volume 0.50', 'Open price 1.08500', 'Close price 1.08700', 'Open time 05.10.2026 13:30:15', 'Close time 05.10.2026 16:00:00', 'Profit 385.40', 'Stop Loss 1.08300']
    const words = [...line('GBPUSD', 40, 10), ...rows.flatMap((r, i) => line(r, 40, 80 + i * 50))]
    const p = parseXtbScreen(words)!
    expect(p).toMatchObject({
      symbol: 'GBPUSD',
      direction: 'long',
      volume: 0.5,
      openPrice: 1.085,
      closePrice: 1.087,
      openTime: '2026-10-05T13:30:15',
      closeTime: '2026-10-05T16:00:00',
      profit: 385.4,
      stopLoss: 1.083,
      takeProfit: null
    })
  })

  it('obraz bez panelu pozycji → null', () => {
    expect(parseXtbScreen(line('EURUSD H1 1.12414 1.12595 Sell', 10, 10))).toBeNull()
    expect(xtbMissing(null)).toEqual(['wszystko'])
  })

  it('TSV z Tesseracta → słowa (tylko poziom 5 z tekstem)', () => {
    const tsv = [
      'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
      '1\t1\t0\t0\t0\t0\t0\t0\t2712\t996\t-1\t',
      '4\t1\t2\t1\t1\t0\t159\t176\t220\t29\t-1\t',
      '5\t1\t2\t1\t1\t1\t155\t157\t140\t60\t89.97\tEURUSD',
      '5\t1\t2\t1\t1\t2\t320\t157\t59\t60\t50.4\t ',
      '5\t1\t5\t1\t1\t1\t429\t321\t150\t27\t88.8\tWolumen'
    ].join('\n')
    expect(parseTesseractTsv(tsv)).toEqual([
      { text: 'EURUSD', left: 155, top: 157, width: 140, height: 60, conf: 89.97, line: '2.1.1' },
      { text: 'Wolumen', left: 429, top: 321, width: 150, height: 27, conf: 88.8, line: '5.1.1' }
    ])
  })

  it('liczby i czasy z OCR', () => {
    expect(ocrNumber('-7.06')).toBe(-7.06)
    expect(ocrNumber('–12,5 PLN')).toBe(-12.5)
    expect(ocrNumber('1 234.56')).toBe(1234.56)
    expect(ocrNumber('1.l2414')).toBe(1.12414)
    expect(ocrNumber('—')).toBeNull()
    expect(ocrNumber('Sell')).toBeNull()
    expect(ocrTime('06.10.2026 09:58')).toBe('2026-10-06T09:58:00')
    expect(ocrTime('06.10.2026, 09.58.07')).toBe('2026-10-06T09:58:07')
    expect(ocrTime('06.10.2026 0958')).toBe('2026-10-06T09:58:00')
    expect(ocrTime('2026-10-06 13:22')).toBe('2026-10-06T13:22:00')
    expect(ocrTime('06.10.2026')).toBe('2026-10-06T00:00:00')
    expect(ocrTime('31.02.2026 25:00')).toBeNull()
    expect(ocrTime('brak')).toBeNull()
  })

  it('kontrola spójności: kierunek a wynik, netto a brutto, SL po stronie zysku', () => {
    const base = parseXtbScreen(xtbPanel())!
    expect(xtbWarnings({ ...base, direction: 'long' })).toEqual([
      'Kierunek nie zgadza się z wynikiem i cenami – sprawdź typ (Buy / Sell) i ceny.',
      'Stop Loss jest po stronie zysku (przesunięty) – nie mówi o ryzyku wejścia.'
    ])
    expect(xtbWarnings({ ...base, gross: -5 })).toEqual(['Zysk/strata różni się od zysku brutto z kosztami – sprawdź odczytane kwoty.'])
    // A small gain eaten by the commission is consistent.
    expect(xtbWarnings({ ...base, closePrice: 1.12404, gross: 0.1, commission: -0.5, profit: -0.4 })).toEqual([])
  })

  it('scalanie dwóch odczytów: wartości pierwszego, braki z drugiego', () => {
    const a = parseXtbScreen(xtbPanel({ profit: '—', 'l.margin': null }))!
    const b = parseXtbScreen(xtbPanel({ type: '—' }))!
    const m = mergeXtb(a, b)!
    expect(m.profit).toBe(-7.06)
    expect(m.margin).toBe(145.61)
    expect(m.direction).toBe('short')
    expect(mergeXtb(null, b)).toMatchObject({ profit: -7.06, direction: null, margin: 145.61 })
  })
})

describe('screen XTB – trudniejsze odczyty', () => {
  it('etykieta z cyfrą z szumu OCR („2Zysk”), obcięta etykieta sklejona z następną („zabezpiec..Swap”)', () => {
    const tsv = (ws: OcrWord[]) =>
      ['level\tpage\tblock\tpar\tline\tword\tleft\ttop\twidth\theight\tconf\ttext', ...ws.map((w, i) => `5\t1\t${w.line.replace(/\./g, '\t')}\t${i}\t${w.left}\t${w.top}\t${w.width}\t${w.height}\t${w.conf}\t${w.text}`)].join('\n')
    const words = xtbPanel({ 'l.gross': '2Zysk brutto', 'l.margin': 'Depozyt zabezpiec..Swap', 'l.swap': null })
    const p = parseXtbScreen(parseTesseractTsv(tsv(words)))!
    expect(p.gross).toBe(-7.06)
    expect(p.margin).toBe(145.61)
    // "Swap" split off the glued word is a label again; its value is under it.
    expect(p.raw.swap).toBe('0.00')
  })

  it('symbole spoza forex: indeksy z cyframi, ropa rozdzielona na kropce; opis instrumentu', () => {
    expect(parseXtbScreen(xtbPanel({ symbol: 'DE40 CFD', desc: 'Germany 40 index' }))).toMatchObject({ symbol: 'DE40', description: 'Germany 40 index' })
    expect(parseXtbScreen(xtbPanel({ symbol: 'US500 cro' }))!.symbol).toBe('US500')
    expect(parseXtbScreen(xtbPanel({ symbol: 'OIL WTI cFD' }))!.symbol).toBe('OIL.WTI')
    expect(parseXtbScreen(xtbPanel({ symbol: 'EURUSD Cr' }))).toMatchObject({ symbol: 'EURUSD', description: 'Euro to American Dollar currency pair' })
    expect(parseXtbScreen(xtbPanel({ symbol: 'Szczegoly' }))!.symbol).toBeNull()
    // XTB's instrument icon in front of the symbol.
    expect(parseXtbScreen(xtbPanel({ symbol: '‘® EURUSD Cr' }))!.symbol).toBe('EURUSD')
  })

  it('symbol odczytany osobno: bez znaczka CFD, znaki dozwolone przy drugim odczycie', () => {
    expect(cleanSymbol('EURUSDCFD')).toBe('EURUSD')
    expect(cleanSymbol('DE40CRD')).toBe('DE40')
    expect(cleanSymbol('OIL WTI')).toBe('OIL.WTI')
    expect(cleanSymbol('us500')).toBe('US500')
    expect(cleanSymbol('EURCHF')).toBe('EURCHF')
    expect(cleanSymbol('1.2')).toBeNull()
    expect(valueCharset('symbol')).toContain('Z')
    expect(valueCharset('openTime')).toBe('0123456789.:')
    expect(valueCharset('openPrice')).toBe('0123456789.-')
  })

  it('głosowanie odczytów: większość wygrywa, cena bez kropki waży mniej, rozbieżności do sprawdzenia', () => {
    const base = { symbol: 'EURUSD', direction: 'short' as const }
    const a = positionFromTexts({ openPrice: '1.12414', closePrice: '1.12595', volume: '0.01' }, base)
    const b = positionFromTexts({ openPrice: '1.12414', closePrice: '1.12696', volume: '0.01' }, base)
    const c = positionFromTexts({ openPrice: '112414', closePrice: '1.12595', volume: '10' }, { symbol: 'EURUSDCFD', direction: null })
    const p = combineXtb([
      { position: c, weight: 1.2 },
      { position: a, weight: 1 },
      { position: b, weight: 0.9 }
    ])!
    expect(p).toMatchObject({ openPrice: 1.12414, closePrice: 1.12595, volume: 0.01, direction: 'short', symbol: 'EURUSD' })
    expect(p.undotted).toEqual([])
    expect(p.uncertain).toEqual({ symbol: ['EURUSDCFD'], closePrice: ['1.12696'], volume: ['10'] })
    expect(p.symbols).toEqual(['EURUSD', 'EURUSDCFD'])
    // A doubled digit merged by OCR ("0.84311" → "0.8431"): the longer reading wins even when outvoted.
    const d = combineXtb([
      { position: positionFromTexts({ openPrice: '0.8431' }, base), weight: 1.2 },
      { position: positionFromTexts({ openPrice: '0.8431' }, base), weight: 1 },
      { position: positionFromTexts({ openPrice: '0.84311' }, base), weight: 0.9 }
    ])!
    expect(d.openPrice).toBe(0.84311)
    expect(d.uncertain.openPrice).toEqual(['0.8431'])
    expect(combineXtb([{ position: null, weight: 1 }])).toBeNull()
  })

  it('instrument: dokładnie, z opisu pary walut, albo najbliższy z typowymi pomyłkami OCR', () => {
    const pairs = ['EURUSD', 'GBPUSD', 'AUDUSD', 'OILWTI', 'US500', 'DE40', 'GOLD']
    const m = (symbols: string[], description: string | null = null) => matchInstrument({ symbols, symbol: symbols[0] ?? null, description }, pairs)
    expect(m(['EURUSD'])).toEqual({ pair: 'EURUSD', how: 'exact', read: 'EURUSD' })
    expect(m(['OIL.WTI'])).toMatchObject({ pair: 'OILWTI', how: 'exact' })
    expect(m(['GBPUSD.pro'])).toMatchObject({ pair: 'GBPUSD', how: 'exact' })
    expect(m(['USS00'])).toEqual({ pair: 'US500', how: 'similar', read: 'USS00' })
    expect(m(['DEA40'])).toMatchObject({ pair: 'DE40', how: 'similar' })
    expect(m(['DEA4O0'])).toMatchObject({ pair: 'DE40', how: 'similar' })
    expect(m(['G0LD'])).toMatchObject({ pair: 'GOLD', how: 'similar' })
    expect(m(['EUPUSO'], 'Euro to American Dollar currency pair')).toMatchObject({ pair: 'EURUSD', how: 'description' })
    expect(m([], 'British Pound to Amerlcan Dollar currency pair')).toMatchObject({ pair: 'GBPUSD', how: 'description', read: null })
    // Nothing close enough: the user picks or adds the pair.
    expect(m(['USDJPY'])).toEqual({ pair: null, how: null, read: 'USDJPY' })
    expect(m(['XAGUSD'])).toMatchObject({ pair: null })
  })

  it('para walut z opisu XTB', () => {
    expect(pairFromDescription('Euro to American Dollar currency pair')).toBe('EURUSD')
    expect(pairFromDescription('American Dollar to Japanese Yen currency pair')).toBe('USDJPY')
    expect(pairFromDescription('Euro to Polish Zloty currency pair')).toBe('EURPLN')
    expect(pairFromDescription('New Zealand Dollar to American Dollar currency pair')).toBe('NZDUSD')
    expect(pairFromDescription('Germany 40 index')).toBeNull()
    expect(pairFromDescription('Euro to Euro')).toBeNull()
    expect(pairFromDescription(null)).toBeNull()
  })

  it('wynik z cen i wolumenu a wynik odczytany (błędna cyfra w cenie wychodzi na jaw)', () => {
    // EURUSD short 1.12414 → 1.12595, 0.01 lota, USD→PLN 3.9: −1.81 USD ≈ −7.06 PLN.
    const v = { direction: 'short' as const, entry: 1.12414, exitPrice: 1.12595, lots: 0.01 }
    expect(expectedGross(v, 100000, 3.9)).toBeCloseTo(-7.059, 3)
    expect(resultMismatch(-7.06, expectedGross(v, 100000, 3.9))).toBe(false)
    // 149.512 read as 140.512: a move 40× bigger.
    expect(resultMismatch(-7.06, expectedGross({ ...v, entry: 1.08414 }, 100000, 3.9))).toBe(true)
    expect(resultMismatch(0.4, 0.1)).toBe(false)
    expect(expectedGross({ ...v, lots: null }, 100000, 3.9)).toBeNull()
  })
})

describe('screen XTB → transakcja w edytorze', () => {
  const now = '2026-10-06T15:00:00.000Z'
  const position: XtbPosition = parseXtbScreen(xtbPanel({ swap: '-0.40', rollover: '-0.10', commission: '-1.00', profit: '-8.56' }))!

  it('czasy WAW → UTC, para z symbolu, swap z rolowaniem', () => {
    const v = screenValues(position, ['GBPUSD', 'EURUSD'])
    expect(v).toMatchObject({
      pair: 'EURUSD',
      direction: 'short',
      entryTime: '2026-10-06T07:58:00.000Z',
      exitTime: '2026-10-06T11:22:00.000Z',
      entry: 1.12414,
      stopLoss: 1.12643,
      takeProfit: 1.10843,
      lots: 0.01,
      exitPrice: 1.12595,
      result: -8.56,
      commission: -1,
      swap: -0.5
    })
    expect(screenValues(position, ['GBPUSD']).pair).toBeNull()
    // Winter time: Warsaw = UTC + 1.
    expect(screenValues({ ...position, openTime: '2026-12-01T09:00:00' }, []).entryTime).toBe('2026-12-01T08:00:00.000Z')
  })

  it('uzupełnia wybrane pola, zamyka otwartą transakcję, wynik w walucie konta', () => {
    const trade = createTrade({ pair: 'GBPUSD', direction: 'long', entryTime: '2026-10-06T12:00:00.000Z', status: 'open', riskPercent: 0.5, notes: 'mój opis' }, now)
    const v = screenValues(position, ['EURUSD', 'GBPUSD'])
    const changed = changedScreenFields(trade, v, 'PLN')
    expect(changed).toEqual(['pair', 'direction', 'entryTime', 'entry', 'stopLoss', 'takeProfit', 'lots', 'exit', 'result'])
    const t = applyScreenValues(trade, v, new Set(changed), { currency: 'PLN', symbol: 'EURUSD', now })
    expect(t).toMatchObject({
      pair: 'EURUSD',
      direction: 'short',
      entryTime: '2026-10-06T07:58:00.000Z',
      status: 'closed',
      prices: { entry: 1.12414, stopLoss: 1.12643, takeProfit1: 1.10843, takeProfit2: null },
      lots: 0.01,
      pnlAmountOverride: -8.56,
      amountCurrency: 'PLN',
      notes: 'mój opis',
      riskPercent: 0.5,
      broker: { tickets: [], symbol: 'EURUSD', net: -8.56, commission: -1, swap: -0.5, currency: 'PLN', source: 'screen' }
    })
    expect(t.exits).toEqual([{ id: trade.exits[0]!.id, time: '2026-10-06T11:22:00.000Z', price: 1.12595, percent: 100, note: '' }])
    // Applied again: nothing left to change.
    expect(changedScreenFields(t, v, 'PLN')).toEqual([])
  })

  it('niezaznaczone pola zostają bez zmian', () => {
    const trade = createTrade({ pair: 'EURUSD', direction: 'short', entryTime: '2026-10-06T07:58:00.000Z', prices: { entry: 1.1241, stopLoss: 1.127, takeProfit1: null, takeProfit2: null } }, now)
    const v = screenValues(position, ['EURUSD'])
    const t = applyScreenValues(trade, v, new Set(['takeProfit', 'lots']), { currency: 'USD', symbol: 'EURUSD', now })
    expect(t.prices).toEqual({ entry: 1.1241, stopLoss: 1.127, takeProfit1: 1.10843, takeProfit2: null })
    expect(t.lots).toBe(0.01)
    expect(t.exits).toEqual(trade.exits)
    expect(t.pnlAmountOverride).toBeNull()
    expect(t.broker).toBe(trade.broker)
  })
})
