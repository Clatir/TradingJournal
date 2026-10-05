/**
 * Broker history (closed positions) from rows of cells: MT4 statement ("Closed Transactions"), MT5 report
 * ("Positions"), XTB xStation ("Closed positions"), also with Polish headers or saved as CSV by Excel.
 * The header row is found by column names; partial closes of one position (same symbol, side, open time and price)
 * are merged into one trade with several exits. Times stay as the file's wall clock (zone chosen when matching).
 */
import type { Rows } from './tables'

export type BrokerFormat = 'mt4' | 'mt5' | 'xtb' | 'other'

export interface BrokerExit {
  /** Wall clock of the file, "YYYY-MM-DDTHH:mm:ss". */
  time: string
  price: number
  volume: number
}

export interface BrokerTrade {
  /** Tickets / position numbers of the merged rows (or "row N" without a ticket column). */
  tickets: string[]
  symbol: string
  direction: 'long' | 'short'
  volume: number
  openTime: string
  openPrice: number
  /** Last exit; null for an open position. */
  closeTime: string | null
  /** Volume-weighted close price. */
  closePrice: number | null
  stopLoss: number | null
  takeProfit: number | null
  /** Gross profit, commission (with taxes / fees) and swap (with rollover), in the account currency of the file. */
  profit: number | null
  commission: number
  swap: number
  /** Net result: the "net" column if there is one, else profit + commission + swap. */
  net: number | null
  exits: BrokerExit[]
  comment: string
}

export interface BrokerTable {
  format: BrokerFormat
  /** Account currency found above the table (e.g. "Currency: USD"), else null. */
  currency: string | null
  trades: BrokerTrade[]
  /** Rows merged into an earlier position (partial closes). */
  merged: number
  skipped: Array<{ row: number; reason: string }>
}

type Role =
  | 'ticket'
  | 'symbol'
  | 'type'
  | 'volume'
  | 'openTime'
  | 'openPrice'
  | 'closeTime'
  | 'closePrice'
  | 'time'
  | 'price'
  | 'sl'
  | 'tp'
  | 'commission'
  | 'swap'
  | 'profit'
  | 'net'
  | 'comment'

/** Header text → lowercase ASCII words ("Czas zamknięcia" → "czas zamkniecia", "S / L" → "s/l"). */
export function normHeader(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .replace(/\s*\/\s*/g, '/')
    .replace(/[^a-z0-9/ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const ROLES: Record<string, Role> = {
  ticket: 'ticket',
  order: 'ticket',
  position: 'ticket',
  'position id': 'ticket',
  pozycja: 'ticket',
  'nr pozycji': 'ticket',
  zlecenie: 'ticket',
  symbol: 'symbol',
  item: 'symbol',
  instrument: 'symbol',
  type: 'type',
  typ: 'type',
  side: 'type',
  direction: 'type',
  kierunek: 'type',
  volume: 'volume',
  size: 'volume',
  lots: 'volume',
  lot: 'volume',
  wolumen: 'volume',
  wielkosc: 'volume',
  'open time': 'openTime',
  'czas otwarcia': 'openTime',
  'data otwarcia': 'openTime',
  'open price': 'openPrice',
  'cena otwarcia': 'openPrice',
  'close time': 'closeTime',
  'czas zamkniecia': 'closeTime',
  'data zamkniecia': 'closeTime',
  'close price': 'closePrice',
  'cena zamkniecia': 'closePrice',
  time: 'time',
  czas: 'time',
  price: 'price',
  cena: 'price',
  's/l': 'sl',
  sl: 'sl',
  'stop loss': 'sl',
  't/p': 'tp',
  tp: 'tp',
  'take profit': 'tp',
  commission: 'commission',
  prowizja: 'commission',
  taxes: 'commission',
  podatki: 'commission',
  fee: 'commission',
  oplata: 'commission',
  swap: 'swap',
  swaps: 'swap',
  rollover: 'swap',
  profit: 'profit',
  zysk: 'profit',
  'gross p/l': 'profit',
  'gross profit': 'profit',
  'zysk brutto': 'profit',
  'zysk/strata': 'profit',
  'zysk/strata brutto': 'profit',
  'p/l': 'profit',
  'net p/l': 'net',
  'net profit': 'net',
  'zysk netto': 'net',
  'zysk/strata netto': 'net',
  comment: 'comment',
  komentarz: 'comment'
}

interface Columns {
  ticket?: number
  symbol: number
  type: number
  volume: number
  openTime: number
  openPrice: number
  closeTime?: number
  closePrice?: number
  sl?: number
  tp?: number
  commission: number[]
  swap: number[]
  profit?: number
  net?: number
  comment?: number
}

/** Column indexes of a header row; null when it is not one. "Time" / "Price" twice = open, then close (MT5). */
function headerColumns(row: readonly string[]): Columns | null {
  const roles = row.map((c) => ROLES[normHeader(c)])
  const first = (role: Role) => {
    const i = roles.indexOf(role)
    return i < 0 ? undefined : i
  }
  const all = (role: Role) => roles.flatMap((r, i) => (r === role ? [i] : []))
  const times = all('time')
  const prices = all('price')
  const openTime = first('openTime') ?? times[0]
  const closeTime = first('closeTime') ?? (first('openTime') != null ? times[0] : times[1])
  const openPrice = first('openPrice') ?? prices[0]
  const closePrice = first('closePrice') ?? (first('openPrice') != null ? prices[0] : prices[1])
  const symbol = first('symbol')
  const type = first('type')
  const volume = first('volume')
  if (symbol == null || type == null || volume == null || openTime == null || openPrice == null) return null
  const profit = first('profit')
  const net = first('net')
  if (profit == null && net == null && closePrice == null) return null
  return {
    ticket: first('ticket'),
    symbol,
    type,
    volume,
    openTime,
    openPrice,
    closeTime,
    closePrice,
    sl: first('sl'),
    tp: first('tp'),
    commission: all('commission'),
    swap: all('swap'),
    profit,
    net,
    comment: first('comment')
  }
}

/** "1 234,56", "1,234.56", "-0.5", "−3.20" → number; "" / text → null. */
export function parseNumber(s: string | undefined): number | null {
  if (s == null) return null
  let t = s.replace(/[\s  ']/g, '').replace(/−/g, '-')
  if (!t || !/^[-+]?[\d.,]+$/.test(t)) return null
  const lastDot = t.lastIndexOf('.')
  const lastComma = t.lastIndexOf(',')
  if (lastDot >= 0 && lastComma >= 0) {
    // Both: the last one is the decimal separator.
    t = lastComma > lastDot ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '')
  } else if (lastComma >= 0) t = t.split(',').length > 2 ? t.replace(/,/g, '') : t.replace(',', '.')
  else if (t.split('.').length > 2) t = t.replace(/\./g, '')
  const v = Number(t)
  return Number.isFinite(v) ? v : null
}

const pad = (n: string | number) => String(n).padStart(2, '0')

/**
 * Broker time → wall clock "YYYY-MM-DDTHH:mm:ss": "2026.10.05 09:30[:15]" (MT), "2026-10-05 09:30:15",
 * "2026-10-05T09:30:15", "05.10.2026 09:30:15" and "05/10/2026 09:30" (day first); null when not a date.
 */
export function parseBrokerTime(s: string | undefined): string | null {
  if (!s) return null
  const t = s.trim()
  let m = /^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(t)
  let y: string, mo: string, d: string
  if (m) [y, mo, d] = [m[1]!, m[2]!, m[3]!]
  else {
    m = /^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(t)
    if (!m) return null
    ;[d, mo, y] = [m[1]!, m[2]!, m[3]!]
  }
  const [h, mi, sec] = [m[4] ?? '0', m[5] ?? '0', m[6] ?? '0']
  if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31 || Number(h) > 23 || Number(mi) > 59 || Number(sec) > 59) return null
  return `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(sec)}`
}

function sideOf(s: string): 'long' | 'short' | null {
  const t = normHeader(s)
  if (/limit|stop|balance|credit|deposit|withdraw/.test(t)) return null
  if (/^(buy|long|kupno|kup)\b/.test(t)) return 'long'
  if (/^(sell|short|sprzedaz|sprzedaj)\b/.test(t)) return 'short'
  return null
}

function detectFormat(header: readonly string[]): BrokerFormat {
  const h = header.map(normHeader)
  if (h.includes('item') || h.includes('taxes')) return 'mt4'
  if (h.includes('rollover') || h.some((x) => x.startsWith('gross p/l') || x === 'zysk brutto' || x.startsWith('zysk/strata'))) return 'xtb'
  if (h.filter((x) => x === 'time' || x === 'czas').length >= 2) return 'mt5'
  return 'other'
}

/** "Currency: USD", a "Currency" / "Waluta" cell followed by a code, or "(USD, …)" after "Account:" (MT5). */
function detectCurrency(rows: Rows): string | null {
  for (const row of rows) {
    for (let i = 0; i < row.length; i++) {
      const cell = row[i]!
      const inline = /\b(?:currency|waluta)\s*:?\s*([A-Z]{3})\b/i.exec(cell)
      if (inline) return inline[1]!.toUpperCase()
      if (/^(currency|waluta)\s*:?$/i.test(cell.trim())) {
        const next = row.slice(i + 1).find((c) => c.trim())
        if (next && /^[A-Z]{3}$/.test(next.trim())) return next.trim()
      }
      if (/^(account|konto)\s*:?/i.test(cell)) {
        const m = /\(([A-Z]{3})[,)]/.exec(row.slice(i).join(' '))
        if (m) return m[1]!
      }
    }
  }
  return null
}

const isTitleRow = (row: readonly string[]) => row.filter((c) => c.trim()).length === 1

/** The first table of closed positions in `rows`; null when no header row is recognised. */
export function parseBrokerRows(rows: Rows): BrokerTable | null {
  for (let h = 0; h < rows.length; h++) {
    const cols = headerColumns(rows[h]!)
    if (!cols) continue
    const format = detectFormat(rows[h]!)
    const currency = detectCurrency(rows.slice(0, h))
    const trades: BrokerTrade[] = []
    const skipped: BrokerTable['skipped'] = []
    let merged = 0
    for (let i = h + 1; i < rows.length; i++) {
      const row = rows[i]!
      if (row.every((c) => !c.trim())) continue
      // Next section (title row, another header): the table is over.
      if (isTitleRow(row) && !sideOf(row.find((c) => c.trim()) ?? '')) break
      if (row.filter((c) => ROLES[normHeader(c)]).length >= 4) break
      const side = sideOf(row[cols.type] ?? '')
      if (!side) {
        if ((row[cols.type] ?? '').trim()) skipped.push({ row: i + 1, reason: `typ „${row[cols.type]}”` })
        continue
      }
      const num = (i?: number) => (i == null ? null : parseNumber(row[i]))
      const sum = (idx: number[]) => idx.reduce((s, k) => s + (parseNumber(row[k]) ?? 0), 0)
      const symbol = (row[cols.symbol] ?? '').trim()
      const volume = num(cols.volume)
      const openTime = parseBrokerTime(row[cols.openTime])
      const openPrice = num(cols.openPrice)
      if (!symbol || volume == null || volume <= 0 || !openTime || openPrice == null) {
        skipped.push({ row: i + 1, reason: 'brak symbolu, wolumenu, czasu albo ceny otwarcia' })
        continue
      }
      const closeTime = cols.closeTime != null ? parseBrokerTime(row[cols.closeTime]) : null
      const closePrice = num(cols.closePrice)
      const profit = num(cols.profit)
      const commission = sum(cols.commission)
      const swap = sum(cols.swap)
      const netCol = num(cols.net)
      const trade: BrokerTrade = {
        tickets: [cols.ticket != null && row[cols.ticket]?.trim() ? row[cols.ticket]!.trim() : `wiersz ${i + 1}`],
        symbol,
        direction: side,
        volume,
        openTime,
        openPrice,
        closeTime: closeTime && closePrice != null ? closeTime : null,
        closePrice: closeTime && closePrice != null ? closePrice : null,
        stopLoss: num(cols.sl) || null,
        takeProfit: num(cols.tp) || null,
        profit,
        commission,
        swap,
        net: netCol ?? (profit != null ? profit + commission + swap : null),
        exits: closeTime && closePrice != null ? [{ time: closeTime, price: closePrice, volume }] : [],
        comment: cols.comment != null ? (row[cols.comment] ?? '').trim() : ''
      }
      const same = trades.find(
        (t) => t.symbol === trade.symbol && t.direction === trade.direction && t.openTime === trade.openTime && t.openPrice === trade.openPrice && t.closeTime && trade.closeTime
      )
      if (same) {
        mergeInto(same, trade)
        merged++
      } else trades.push(trade)
    }
    return { format, currency, trades, merged, skipped }
  }
  return null
}

const add = (a: number | null, b: number | null) => (a == null && b == null ? null : (a ?? 0) + (b ?? 0))

function mergeInto(t: BrokerTrade, part: BrokerTrade): void {
  t.tickets.push(...part.tickets)
  t.exits = [...t.exits, ...part.exits].sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0))
  t.volume = Number((t.volume + part.volume).toFixed(8))
  t.closeTime = t.exits.at(-1)!.time
  t.closePrice = Number((t.exits.reduce((s, x) => s + x.price * x.volume, 0) / t.volume).toFixed(6))
  t.profit = add(t.profit, part.profit)
  t.commission += part.commission
  t.swap += part.swap
  t.net = add(t.net, part.net)
  t.stopLoss ??= part.stopLoss
  t.takeProfit ??= part.takeProfit
}

/** The best table of a file with several sheets / tables: the one with the most positions. */
export function parseBrokerSheets(sheets: ReadonlyArray<{ name: string; rows: Rows }>): (BrokerTable & { sheet: string }) | null {
  let best: (BrokerTable & { sheet: string }) | null = null
  for (const s of sheets) {
    const t = parseBrokerRows(s.rows)
    if (t && (!best || t.trades.length > best.trades.length)) best = { ...t, sheet: s.name }
  }
  return best
}
