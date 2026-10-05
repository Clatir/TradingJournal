/**
 * Month table of a payout forecast, shared by "Kopiuj tabelę" (TSV), CSV and XLSX: headers and rows with
 * numbers as numbers (rounded like the screen shows them). Columns of the improvements appear only when the
 * table on screen has them.
 */
import { calendarOf, goalQueue, monthLabel, type ForecastInput, type ForecastResult } from '../calc/forecast'
import type { Forecast, ForecastGoal } from '../schema'
import { csvNumber, csvText } from './csv'
import type { XlsxKind, XlsxSheet } from './xlsx'

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

/** CSV for Polish Excel: semicolon, UTF-8 with BOM, CRLF, decimal comma (existing csvNumber / csvText). */
export function forecastCsv(table: ForecastTableData): string {
  const line = (cells: string[]) => cells.join(';')
  const rows = table.rows.map((r) => line(r.map((v, i) => (typeof v === 'number' ? csvNumber(v, KIND_DECIMALS[table.columns[i]!.kind] ?? undefined) : csvText(v ?? '')))))
  return `\ufeff${[line(table.columns.map((c) => csvText(c.header))), ...rows].join('\r\n')}\r\n`
}

const XLSX_KIND: Record<ForecastColumnKind, XlsxKind> = { int: 'int', text: 'text', pct: 'pct', money: 'money', pips: 'number', lot: 'number' }

/** Simple goal state for the "Cele" sheet when the page does not pass its own texts. */
function defaultGoalState(goal: ForecastGoal, sim: ForecastResult, horizon: number): string {
  if (!goal.enabled) return 'wyłączony'
  if (goal.month == null) return 'bez miesiąca'
  if (goal.month > horizon) return 'poza tabelą'
  const r = sim.goals[goal.id]
  if (!r) return ''
  if ('blockedBy' in r) return 'czeka na wcześniejszy cel'
  if ('pending' in r) return 'nie uzbierał się do końca tabeli'
  if (r.empty) return 'nic nie dostał'
  return r.month > r.planned ? `kupiony, ${r.month - r.planned} mies. po planie` : 'kupiony'
}

/**
 * Workbook of the "XLSX" button (chapter 13): "Prognoza" (months), "Lata", "Cele" and "Ustawienia"
 * (scenario parameters as name–value pairs, `settings` already formatted by the page).
 */
export function forecastWorkbook(args: {
  sim: ForecastResult
  scenario: Forecast
  input: Pick<ForecastInput, 'goals' | 'horizon' | 'm0' | 'y0'>
  settings: Array<[string, string]>
  goalState?: (goal: ForecastGoal) => string
}): XlsxSheet[] {
  const { sim, scenario, input } = args
  const fund = scenario.keep === 'fund'
  const table = forecastTable(sim, scenario, input)
  const months: XlsxSheet = {
    name: 'Prognoza',
    freezeHeader: true,
    columns: table.columns.map((c) => ({ header: c.header, kind: XLSX_KIND[c.kind], width: c.kind === 'text' ? 18 : Math.max(12, c.header.length + 2) })),
    rows: table.rows
  }
  const years: XlsxSheet = {
    name: 'Lata',
    freezeHeader: true,
    columns: [
      { header: 'Rok', kind: 'int' },
      { header: 'Miesiące', kind: 'text' },
      { header: 'Zwrot roczny [%]', kind: 'pct' },
      { header: 'Wpłaty', kind: 'money' },
      { header: 'Podatek', kind: 'money' },
      { header: 'Zysk', kind: 'money' },
      { header: fund ? 'Odkładana wypłata' : 'Wypłata', kind: 'money' },
      { header: fund ? 'Fundusz celowy na koniec' : 'Odłożona gotówka na koniec', kind: 'money', width: 26 },
      { header: 'Zakupione cele', kind: 'int' },
      { header: 'Kwota na cele', kind: 'money' },
      { header: fund ? 'Masa obrotowa na koniec' : 'Kapitał na koniec', kind: 'money', width: 24 }
    ],
    rows: forecastYears(sim, input).map((y) => [
      y.year,
      `${y.fromK}–${y.toK}`,
      roundFor('pct', y.rate * 100),
      roundFor('money', y.deposit),
      roundFor('money', y.tax),
      roundFor('money', y.profit),
      roundFor('money', y.payout),
      roundFor('money', y.pot),
      y.buys,
      roundFor('money', y.spent),
      roundFor('money', y.end)
    ])
  }
  const goals: XlsxSheet = {
    name: 'Cele',
    freezeHeader: true,
    columns: [
      { header: 'Nazwa', kind: 'text', width: 24 },
      { header: 'Planowany miesiąc', kind: 'int' },
      { header: 'Data planowana', kind: 'text' },
      { header: 'Kwota celu', kind: 'money' },
      { header: 'Miesiąc zakupu', kind: 'int' },
      { header: 'Data zakupu', kind: 'text' },
      { header: 'Wydano', kind: 'money' },
      { header: 'Stan', kind: 'text', width: 50 }
    ],
    rows: scenario.goals.map((g) => {
      const r = sim.goals[g.id]
      const bought = r && 'month' in r ? r : null
      const validMonth = g.month != null && g.month >= 1 && g.month <= 240
      return [
        goalName(g.name),
        g.month,
        validMonth ? monthLabel(g.month!, input.m0, input.y0) : null,
        g.amount,
        bought ? bought.month : null,
        bought ? monthLabel(bought.month, input.m0, input.y0) : null,
        bought ? roundFor('money', bought.amount) : null,
        (args.goalState ?? ((goal) => defaultGoalState(goal, sim, input.horizon)))(g)
      ]
    })
  }
  const params: XlsxSheet = {
    name: 'Ustawienia',
    columns: [
      { header: 'Parametr', kind: 'text', width: 34 },
      { header: 'Wartość', kind: 'text', width: 60 }
    ],
    rows: args.settings
  }
  return [months, years, goals, params]
}
