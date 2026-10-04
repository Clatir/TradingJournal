/**
 * Month table of a payout forecast, shared by "Kopiuj tabelę" (TSV), CSV and XLSX: headers and rows with
 * numbers as numbers (rounded like the screen shows them). Columns of the improvements appear only when the
 * table on screen has them.
 */
import { calendarOf, goalQueue, type ForecastInput, type ForecastResult } from '../calc/forecast'
import type { Forecast } from '../schema'

export type ForecastCell = number | string | null
export type ForecastColumnKind = 'int' | 'text' | 'pct' | 'money' | 'pips' | 'lot'
export interface ForecastColumn {
  key: string
  header: string
  kind: ForecastColumnKind
}
export interface ForecastTableData {
  columns: ForecastColumn[]
  rows: ForecastCell[][]
}

/** Decimal places of each kind of number in exports. */
export const KIND_DECIMALS: Record<ForecastColumnKind, number | null> = { int: 0, text: null, pct: 4, money: 2, pips: 2, lot: 4 }

/** Which optional columns the month table shows. */
export interface ForecastColumnsVisible {
  tax: boolean
  pips: boolean
  lot: boolean
  goals: boolean
}

export function forecastColumnsVisible(scenario: Pick<Forecast, 'tax' | 'gain' | 'pips' | 'loss'>, input: Pick<ForecastInput, 'goals' | 'horizon'>): ForecastColumnsVisible {
  const pipsMode = scenario.gain === 'pips'
  return {
    tax: scenario.tax.enabled,
    pips: pipsMode && (scenario.pips.pipsMode === 'random' || scenario.loss.probability > 0),
    lot: pipsMode && scenario.pips.lotMode !== 'fixed',
    goals: goalQueue(input.goals, input.horizon).length > 0
  }
}

/** Percentage without trailing zeros: 50 → "50%", 46.5 → "46.5%". */
export const shortPercent = (v: number): string => `${Number(v.toFixed(2))}%`

/** Rounded the way exports show it; never −0. */
export function roundFor(kind: ForecastColumnKind, v: number): number {
  const d = KIND_DECIMALS[kind]
  return d == null ? v : Number(v.toFixed(d)) || 0
}

export const goalName = (name: string): string => name.trim() || 'Bez nazwy'

export function forecastColumns(scenario: Forecast, visible: ForecastColumnsVisible): ForecastColumn[] {
  const fund = scenario.keep === 'fund'
  const p = shortPercent(scenario.payoutPercent)
  const cols: Array<ForecastColumn | false> = [
    { key: 'k', header: 'Nr miesiąca', kind: 'int' },
    { key: 'label', header: 'Miesiąc', kind: 'text' },
    { key: 'rate', header: 'Zwrot [%]', kind: 'pct' },
    { key: 'deposit', header: 'Wpłata', kind: 'money' },
    visible.tax && { key: 'tax', header: 'Podatek', kind: 'money' },
    visible.pips && { key: 'pips', header: 'Pipsy', kind: 'pips' },
    visible.lot && { key: 'lot', header: 'Lot', kind: 'lot' },
    { key: 'start', header: fund ? 'Masa obrotowa na początku' : 'Kapitał na początku', kind: 'money' },
    { key: 'profit', header: 'Zysk', kind: 'money' },
    { key: 'payout', header: fund ? `Odkładana wypłata (${p})` : `Wypłata (${p})`, kind: 'money' },
    { key: 'pot', header: fund ? 'Fundusz celowy' : 'Odłożona gotówka', kind: 'money' },
    visible.goals && { key: 'goal', header: 'Cel zakupowy', kind: 'text' },
    visible.goals && { key: 'goalAmount', header: 'Kwota na cel', kind: 'money' },
    { key: 'end', header: fund ? 'Masa obrotowa na koniec' : 'Kapitał na koniec', kind: 'money' }
  ]
  return cols.filter((c): c is ForecastColumn => !!c)
}

export function forecastTable(sim: ForecastResult, scenario: Forecast, input: Pick<ForecastInput, 'goals' | 'horizon'>): ForecastTableData {
  const columns = forecastColumns(scenario, forecastColumnsVisible(scenario, input))
  const rows = sim.rows.map((r) =>
    columns.map((c): ForecastCell => {
      switch (c.key) {
        case 'k':
          return r.k
        case 'label':
          return r.label
        case 'rate':
          return roundFor('pct', r.rate * 100)
        case 'tax':
          return r.tax > 0 ? roundFor('money', r.tax) : null
        case 'pips':
          return r.pips == null ? null : roundFor('pips', r.pips)
        case 'lot':
          return r.lot == null ? null : roundFor('lot', r.lot)
        case 'goal':
          return r.buys.map((b) => goalName(b.name)).join(' + ')
        case 'goalAmount':
          return r.buys.length ? roundFor('money', r.buys.reduce((s, b) => s + b.amount, 0)) : null
        default:
          return roundFor('money', r[c.key as 'deposit' | 'start' | 'profit' | 'payout' | 'pot' | 'end'])
      }
    })
  )
  return { columns, rows }
}

/** A number with a decimal comma and no thousands separator (Polish Excel). */
export function commaNumber(v: number, kind: ForecastColumnKind): string {
  const d = KIND_DECIMALS[kind]
  return (d == null ? String(v) : v.toFixed(d)).replace('.', ',')
}

/** "Kopiuj tabelę": tab-separated, decimal comma, no thousands separator, CRLF. */
export function forecastTsv(table: ForecastTableData): string {
  const text = (s: string) => s.replace(/[\t\r\n]+/g, ' ')
  const cell = (v: ForecastCell, kind: ForecastColumnKind) => (v == null ? '' : typeof v === 'number' ? commaNumber(v, kind) : text(v))
  return [table.columns.map((c) => text(c.header)).join('\t'), ...table.rows.map((r) => r.map((v, i) => cell(v, table.columns[i]!.kind)).join('\t'))].join('\r\n')
}

/** One calendar year of the forecast table (chapter 7.3). */
export interface ForecastYear {
  year: number
  fromK: number
  toK: number
  /** Compound return of the year: Π(1 + r) − 1, as a fraction. */
  rate: number
  /** Net deposits (withdrawals negative). */
  deposit: number
  tax: number
  profit: number
  payout: number
  /** Set aside / fund and capital / mass at the end of the year. */
  pot: number
  end: number
  /** Goals bought in the year and their total. */
  buys: number
  spent: number
}

/** Year summaries: after December of every calendar year and after the last row. */
export function forecastYears(sim: ForecastResult, input: Pick<ForecastInput, 'm0' | 'y0'>): ForecastYear[] {
  const years: ForecastYear[] = []
  let cur: ForecastYear | null = null
  let growth = 1
  for (const r of sim.rows) {
    const { year } = calendarOf(r.k, input.m0, input.y0)
    if (!cur || cur.year !== year) {
      cur = { year, fromK: r.k, toK: r.k, rate: 0, deposit: 0, tax: 0, profit: 0, payout: 0, pot: 0, end: 0, buys: 0, spent: 0 }
      growth = 1
      years.push(cur)
    }
    growth *= 1 + r.rate
    cur.toK = r.k
    cur.rate = growth - 1
    cur.deposit += r.deposit
    cur.tax += r.tax
    cur.profit += r.profit
    cur.payout += r.payout
    cur.pot = r.pot
    cur.end = r.end
    cur.buys += r.buys.length
    cur.spent += r.buys.reduce((s, b) => s + b.amount, 0)
  }
  return years
}
