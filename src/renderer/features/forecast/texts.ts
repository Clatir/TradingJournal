/**
 * Texts of the payout forecast page built from the calculation result (pure, unit-tested): goal status
 * lines, summary cells, the table description and the pip mode summary.
 */
import { goalQueue, monthLabel, type ForecastInput, type ForecastResult, type GoalResult } from '@shared/calc/forecast'
import { goalName } from '@shared/export/forecast'
import type { PipValue } from '@shared/instruments'
import type { Forecast, ForecastGoal } from '@shared/schema'
import { countLabel, fmtAmount, fmtPct, plural } from '../../lib/format'

export interface TextPart {
  text: string
  strong?: boolean
  accent?: boolean
  dim?: boolean
}
export interface GoalStatus {
  tone: 'warn' | 'dim' | 'normal'
  parts: TextPart[]
}

export const monthsLabel = (n: number): string => countLabel(n, 'miesiąc', 'miesiące', 'miesięcy')

const when = (k: number, m0: number, y0: number) => `mies. ${k} (${monthLabel(k, m0, y0)})`

/** Status line under a goal (chapter 9), in the order of the conditions there. */
export function goalStatus(
  goal: ForecastGoal,
  ctx: {
    scenario: Pick<Forecast, 'keep' | 'currency' | 'goals'>
    input: Pick<ForecastInput, 'horizon' | 'm0' | 'y0'>
    /** Null when the scenario cannot be calculated (pip mode without a pip value or rate). */
    result: ForecastResult | null
    /** Second run kept in cash (fund mode only). */
    cash: ForecastResult | null
  }
): GoalStatus {
  const { scenario, input, result, cash } = ctx
  const cur = scenario.currency
  const nameOf = (id: string) => goalName(scenario.goals.find((g) => g.id === id)?.name ?? '')
  if (goal.month == null || !Number.isInteger(goal.month) || goal.month < 1 || goal.month > 240)
    return { tone: 'warn', parts: [{ text: 'Wpisz numer miesiąca od 1 do 240.' }] }
  if (!goal.enabled) return { tone: 'dim', parts: [{ text: 'Wyłączony, nie wpływa na tabelę.' }] }
  if (goal.month > input.horizon)
    return { tone: 'dim', parts: [{ text: `Poza tabelą, która ma ${monthsLabel(input.horizon)}. Zwiększ liczbę miesięcy.` }] }
  if (!result) return { tone: 'dim', parts: [{ text: '—' }] }
  const r = result.goals[goal.id]
  if (!r) return { tone: 'dim', parts: [{ text: 'Nie bierze udziału w obliczeniach.' }] }
  if ('blockedBy' in r) return { tone: 'warn', parts: [{ text: `Czeka na cel „${nameOf(r.blockedBy)}”, który nie uzbierał się do końca tabeli.` }] }

  const parts: TextPart[] = []
  let tone: GoalStatus['tone'] = 'normal'
  if ('pending' in r) {
    tone = 'warn'
    const where = scenario.keep === 'fund' ? 'w funduszu jest' : 'w gotówce jest'
    parts.push({
      text:
        goal.amount != null
          ? `Nie uzbierał się do końca tabeli: ${where} ${fmtAmount(r.have)} z ${fmtAmount(goal.amount, cur)}.`
          : `Nie uzbierał się do końca tabeli: ${where} ${fmtAmount(r.have, cur)}.`
    })
  } else if (r.empty) {
    return {
      tone: 'warn',
      parts: [{ text: r.after ? `Nic nie dostał: w tym samym miesiącu wszystko zabrał cel „${nameOf(r.after)}”.` : 'Nic nie dostał: odłożona pula była pusta.' }]
    }
  } else {
    if (r.whole) parts.push({ text: fmtAmount(r.amount, cur), strong: true, accent: true }, { text: ` w ${when(r.month, input.m0, input.y0)}` })
    else parts.push({ text: 'Kupiony w ' }, { text: when(r.month, input.m0, input.y0), strong: true })
    if (r.month > r.planned) parts.push({ text: `, ${r.month - r.planned} mies. po planie` })
  }
  if (scenario.keep === 'fund' && cash) parts.push({ text: ` · ${cashComparison(goal, cash.goals[goal.id], cur)}`, dim: true })
  return { tone, parts }
}

/** "w gotówce: …" next to a goal in fund mode. */
function cashComparison(goal: ForecastGoal, r: GoalResult | undefined, cur: string): string {
  if (!r || 'blockedBy' in r || 'pending' in r) return 'w gotówce by się nie uzbierał'
  if (r.empty) return `w gotówce: ${fmtAmount(0, cur)}`
  if (r.whole || goal.amount == null) return `w gotówce: ${fmtAmount(r.amount, cur)}`
  return `w gotówce: mies. ${r.month}`
}

export interface SummaryCell {
  key: string
  label: string
  value: string
  sub: string
  /** The number behind `value` (money in the scenario currency, or percent for the mean return). */
  num: number
}

/** Goals that take part in the table (enabled, valid month within the horizon). */
export function activeGoals(input: Pick<ForecastInput, 'goals' | 'horizon'>): ForecastInput['goals'] {
  return goalQueue(input.goals, input.horizon)
}

/** The six cells of "Podsumowanie" plus tax and withdrawals when they apply (chapter 8). */
export function summaryCells(ctx: {
  scenario: Forecast
  input: ForecastInput
  result: ForecastResult
  cash: ForecastResult | null
}): SummaryCell[] {
  const { scenario, input, result, cash } = ctx
  const t = result.totals
  const cur = scenario.currency
  const fund = scenario.keep === 'fund'
  const N = input.horizon
  const lastMonth = `${N} (${monthLabel(N, input.m0, input.y0)})`
  const queue = activeGoals(input)
  const bought = queue.filter((g) => 'month' in (result.goals[g.id] ?? {})).length
  const waiting = queue.length - bought

  let goalsSub: string
  if (!queue.length) goalsSub = 'brak aktywnych celów'
  else {
    goalsSub = bought ? `kupione: ${countLabel(bought, 'cel', 'cele', 'celów')}` : 'jeszcze żaden cel'
    if (waiting) goalsSub += `, ${waiting} ${plural(waiting, 'czeka', 'czekają', 'czeka')}`
  }

  let meanSub: string
  if (scenario.gain === 'pips') meanSub = 'tyle wychodzi z pipsów'
  else if (scenario.pct.mode === 'fixed') meanSub = 'stały, co miesiąc'
  else {
    const lo = Math.min(scenario.pct.lo, scenario.pct.hi)
    const hi = Math.max(scenario.pct.lo, scenario.pct.hi)
    meanSub = `losowany z ${fmtAmount(lo, undefined, lo % 1 ? 2 : 0)}–${fmtAmount(hi, undefined, hi % 1 ? 2 : 0)}%`
  }
  if (t.lossMonths > 0) meanSub += `, stratnych miesięcy: ${t.lossMonths}`

  const cells: SummaryCell[] = [
    fund
      ? (() => {
          const gain = cash ? t.profit - cash.totals.profit : 0
          return { key: 'fundGain', label: 'Zarobek funduszu', value: fmtAmount(gain, cur), sub: 'o tyle więcej zysku niż przy wypłacie w gotówce', num: gain }
        })()
      : { key: 'last', label: 'Ostatnia wypłata', value: fmtAmount(t.lastPayout, cur), sub: `w miesiącu ${lastMonth}`, num: t.lastPayout },
    { key: 'payout', label: fund ? 'Odłożone z zysku' : 'Suma wypłat', value: fmtAmount(t.payout, cur), sub: `przez ${monthsLabel(N)}`, num: t.payout },
    { key: 'spent', label: 'Na cele zakupowe', value: fmtAmount(t.spent, cur), sub: goalsSub, num: t.spent },
    {
      key: 'pot',
      label: fund ? 'Fundusz celowy' : 'Odłożona gotówka',
      value: fmtAmount(t.pot, cur),
      sub: !fund && !queue.length ? 'wszystkie wypłaty' : 'na koniec, po zakupach',
      num: t.pot
    },
    fund
      ? { key: 'end', label: 'Masa obrotowa', value: fmtAmount(t.end, cur), sub: `kapitał z funduszem po mies. ${lastMonth}`, num: t.end }
      : { key: 'end', label: 'Kapitał na koniec', value: fmtAmount(t.end, cur), sub: `po miesiącu ${lastMonth}`, num: t.end },
    { key: 'mean', label: 'Średni zwrot', value: fmtPct(t.meanRate * 100), sub: meanSub, num: t.meanRate * 100 }
  ]
  if (scenario.tax.enabled)
    cells.push({ key: 'tax', label: 'Podatek zapłacony', value: fmtAmount(t.taxPaid, cur), sub: `do zapłaty po okresie: ${fmtAmount(t.taxOutstanding, cur)}`, num: t.taxPaid })
  if (t.withdrawn > 0) cells.push({ key: 'withdrawn', label: 'Wypłacone z kapitału', value: fmtAmount(t.withdrawn, cur), sub: 'wpłaty ujemne w tabeli', num: t.withdrawn })
  return cells
}

/** Custom deposits that count (month within the table). */
export function customDepositCount(scenario: Pick<Forecast, 'deposits'>, horizon: number): number {
  return Object.keys(scenario.deposits).filter((k) => Number(k) >= 1 && Number(k) <= horizon).length
}

/** "50 miesięcy, od 11-2026 do 12-2030 · wpłacone łącznie 108 000.00 PLN (3 wpłaty niestandardowe) · …" */
export function tableDescription(scenario: Forecast, input: ForecastInput, result: ForecastResult): string {
  const N = input.horizon
  const cur = scenario.currency
  const custom = customDepositCount(scenario, N)
  let text = `${monthsLabel(N)}, od ${monthLabel(1, input.m0, input.y0)} do ${monthLabel(N, input.m0, input.y0)} · wpłacone łącznie ${fmtAmount(result.totals.paidIn, cur)}`
  if (custom) text += ` (${countLabel(custom, 'wpłata niestandardowa', 'wpłaty niestandardowe', 'wpłat niestandardowych')})`
  if (result.totals.withdrawn > 0) text += ` · wypłacone z kapitału ${fmtAmount(result.totals.withdrawn, cur)}`
  return text
}

const numberText = (v: number, min = 0) => {
  const s = String(Number(v.toFixed(4)))
  const decimals = s.includes('.') ? s.split('.')[1]!.length : 0
  return v.toFixed(Math.max(min, decimals)).replace('-', '−')
}

export const pipsLabel = (pips: number): string => `${numberText(pips)} ${plural(pips, 'pips', 'pipsy', 'pipsów', 'pipsa')}`

/** "0.10 USD za 1 pips przy 0.01 lota × kurs 3.8881 = 0.3888 PLN" */
export function pipValueText(pip: PipValue, currency: string): string {
  const base = `${numberText(pip.base, 2)} ${pip.currency} za 1 pips przy ${pip.minLot} lota`
  const manual = pip.source === 'manual' ? ' (wpisana ręcznie)' : ''
  if (pip.currency === currency) return `${base}${manual}`
  return `${base}${manual} × kurs ${pip.rate} = ${pip.value.toFixed(4)} ${currency}`
}

/** Fixed lot and fixed pips: profit of every month, with the calculation. */
export function fixedPipsSummary(pips: number, lot: number, pip: PipValue, currency: string): { profit: string; detail: string } {
  const units = Math.round((lot / pip.minLot) * 1e6) / 1e6
  const profit = pips * pip.value * units
  const inBase = pips * pip.base * units
  const rate = pip.currency === currency ? '' : `, po kursie ${pip.rate}`
  return {
    profit: fmtAmount(profit, currency),
    detail: `${pipsLabel(pips)} × ${numberText(pip.base, 2)} ${pip.currency} × ${Number(units.toFixed(4))} = ${fmtAmount(inBase, pip.currency)}${rate}`
  }
}

/** "to 10 × najmniejszy lot (0.01)" or "Mniej niż najmniejszy lot (0.01)." */
export function lotHint(lot: number, minLot: number): string {
  const units = lot / minLot
  if (units < 1 - 1e-9) return `Mniej niż najmniejszy lot (${minLot}).`
  return `to ${Number(units.toFixed(2))} × najmniejszy lot (${minLot})`
}

export interface CompareRow {
  key: string
  label: string
  a: string
  b: string
  /** Difference a − b; null when it is not comparable (different currencies or a missing cell). */
  diff: string | null
  sign: -1 | 0 | 1
}

/** Signed difference: "+1 250.00 PLN", "−0.50%", "0.00 PLN". */
function signedDiff(v: number, unit: string, pct: boolean): string {
  const text = pct ? fmtPct(Math.abs(v)) : fmtAmount(Math.abs(v), unit)
  const zero = text === (pct ? fmtPct(0) : fmtAmount(0, unit))
  return zero ? text : `${v > 0 ? '+' : '\u2212'}${text}`
}

/**
 * "Porównanie" (chapter 12): rows = summary cells, columns = this scenario, the other one and the difference.
 * With different saving modes only the cells that mean the same in both are compared.
 */
export function compareRows(a: { scenario: Forecast; cells: SummaryCell[] }, b: { scenario: Forecast; cells: SummaryCell[] }): CompareRow[] {
  const sameMode = a.scenario.keep === b.scenario.keep
  const sameCurrency = a.scenario.currency === b.scenario.currency
  const neutral: Record<string, string> = {
    payout: 'Suma wypłat / odłożone z zysku',
    spent: 'Na cele zakupowe',
    pot: 'Odłożone na koniec',
    end: 'Kapitał / masa obrotowa na koniec',
    mean: 'Średni zwrot'
  }
  const keys = sameMode ? [...new Set([...a.cells.map((c) => c.key), ...b.cells.map((c) => c.key)])] : Object.keys(neutral)
  return keys.map((key) => {
    const ca = a.cells.find((c) => c.key === key)
    const cb = b.cells.find((c) => c.key === key)
    const pct = key === 'mean'
    const comparable = !!ca && !!cb && (pct || sameCurrency)
    const d = comparable ? ca.num - cb.num : 0
    const diff = comparable ? signedDiff(d, a.scenario.currency, pct) : null
    const sign = !diff || /^0\.00/.test(diff) ? 0 : d > 0 ? 1 : -1
    return { key, label: sameMode ? (ca ?? cb)!.label : neutral[key]!, a: ca?.value ?? '—', b: cb?.value ?? '—', diff, sign }
  })
}

/** Goal line of the comparison: "mies. 6 (4-2027)", "nie uzbierał się", "wyłączony"… */
export function goalOutcome(goal: ForecastGoal, result: ForecastResult, input: Pick<ForecastInput, 'm0' | 'y0' | 'horizon'>): string {
  if (!goal.enabled) return 'wyłączony'
  if (goal.month == null) return 'bez miesiąca'
  if (goal.month > input.horizon) return 'poza tabelą'
  const r = result.goals[goal.id]
  if (!r) return '—'
  if ('blockedBy' in r || 'pending' in r) return 'nie uzbierał się'
  return `mies. ${r.month} (${monthLabel(r.month, input.m0, input.y0)})`
}

const MONTHS_GENITIVE = ['styczniu', 'lutym', 'marcu', 'kwietniu', 'maju', 'czerwcu', 'lipcu', 'sierpniu', 'wrześniu', 'październiku', 'listopadzie', 'grudniu']
/** A plain number with the typographic minus (U+2212). */
const signed = (v: number) => String(Number(v.toFixed(4))).replace('-', '\u2212')
const range = (a: number, b: number) => `${signed(Math.min(a, b))}–${signed(Math.max(a, b))}`

/** Scenario parameters as name–value pairs (the "Ustawienia" sheet of the XLSX export). */
export function scenarioSettingsRows(scenario: Forecast, ctx: { input: Pick<ForecastInput, 'm0' | 'y0'>; instrumentName: string | null; pip: PipValue | null; exportedAt: Date }): Array<[string, string]> {
  const cur = scenario.currency
  const rows: Array<[string, string]> = [
    ['Scenariusz', scenario.name],
    ['Waluta scenariusza', cur],
    ['Wypłata z zysku', `${Number(scenario.payoutPercent.toFixed(2))}%`],
    ['Tryb odkładania', scenario.keep === 'fund' ? 'Fundusz celowy' : 'Gotówka'],
    ['Tryb prognozy zysku', scenario.gain === 'pips' ? 'Pipsowy' : 'Procentowy']
  ]
  if (scenario.gain === 'pct') rows.push(['Zwrot co miesiąc', scenario.pct.mode === 'fixed' ? `stały ${signed(scenario.pct.fixed)}%` : `losowy z zakresu ${range(scenario.pct.lo, scenario.pct.hi)}%`])
  else {
    const p = scenario.pips
    rows.push(
      ['Instrument', ctx.instrumentName ? `${ctx.instrumentName} (${p.instrumentId})` : p.instrumentId],
      ['Pipsy w miesiącu', p.pipsMode === 'fixed' ? `stałe ${signed(p.pips)}` : `losowe z zakresu ${range(p.pipsLo, p.pipsHi)}`],
      [
        'Wielkość lota',
        p.lotMode === 'fixed'
          ? `stały lot ${p.lot}`
          : p.lotMode === 'perCapital'
            ? `${p.lotPer} lota na każde ${fmtAmount(p.lotPerAmount, cur)} kapitału`
            : `z ryzyka ${p.riskPercent}%, stop loss ${pipsLabel(p.stopPips)}`
      ]
    )
    if (p.lotMode !== 'fixed') rows.push(['Maksymalny lot', p.lotMax == null ? 'bez limitu' : String(p.lotMax)])
    rows.push(['Wartość pipsa', ctx.pip ? pipValueText(ctx.pip, cur) : 'brak kursu albo wartości pipsa'])
  }
  const l = scenario.loss
  rows.push([
    'Miesiące stratne',
    l.probability > 0
      ? `szansa ${l.probability}%, strata ${scenario.gain === 'pips' ? `${range(l.pipsLo, l.pipsHi)} pipsów` : `${range(l.pctLo, l.pctHi)}% kapitału`}`
      : 'brak'
  ])
  const custom = Object.entries(scenario.deposits)
    .map(([k, v]) => [Number(k), v] as const)
    .sort((a, b) => a[0] - b[0])
  rows.push(
    ['Kapitał na start', fmtAmount(scenario.startCapital, cur)],
    ['Dopłata co miesiąc', fmtAmount(scenario.monthlyDeposit, cur)],
    ['Pierwszy miesiąc', monthLabel(1, ctx.input.m0, ctx.input.y0)],
    ['Liczba miesięcy', String(scenario.months)],
    ['Wpłaty niestandardowe', custom.length ? custom.map(([k, v]) => `mies. ${k}: ${fmtAmount(v)}`).join('; ') : 'brak'],
    ['Podatek od zysków', scenario.tax.enabled ? `${scenario.tax.ratePercent}%, płatny w ${MONTHS_GENITIVE[scenario.tax.payMonth - 1]} następnego roku` : 'nie uwzględniony'],
    ['Notatki', scenario.notes],
    ['Wyeksportowano', ctx.exportedAt.toLocaleString('pl-PL')]
  )
  return rows
}
