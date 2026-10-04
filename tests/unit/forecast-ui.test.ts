import { describe, expect, it } from 'vitest'
import { simulateForecast } from '@shared/calc/forecast'
import { createForecast } from '@shared/defaults'
import { forecastColumnsVisible, forecastTable, forecastTsv, shortPercent } from '@shared/export/forecast'
import { forecastInputFrom } from '@shared/forecast-input'
import { newId } from '@shared/ids'
import { settingsSchema, type Forecast } from '@shared/schema'
import { fmtAmount, fmtPct, fmtPctShort, parseAmountInput as parseDeposit } from '../../src/renderer/lib/format'
import { fixedPipsSummary, goalStatus, lotHint, pipValueText, summaryCells, tableDescription } from '../../src/renderer/features/forecast/texts'

const NBSP = ' '
const settings = settingsSchema.parse({ risk: { accountCurrency: 'USD' }, fx: { nbp: { no: '192/A/NBP/2026', effectiveDate: '2026-10-02', fetchedAt: '2026-10-02T12:00:00.000Z', rates: { USD: 3.8881 } } } })

/** The prototype scenario of the reference vectors (T1): 11%, 10%, 10 000 + 2 000, 11-2026, 50 months, goals 6 / 12 / 19, cash. */
function t1(over: Partial<Forecast> = {}): Forecast {
  return {
    ...createForecast({ accountCurrency: 'PLN', accountBalance: 10000 }, [], '2026-11-02T09:00:00.000Z'),
    payoutPercent: 10,
    monthlyDeposit: 2000,
    firstMonth: '2026-11',
    months: 50,
    keep: 'cash',
    pct: { mode: 'fixed', fixed: 11, lo: 7, hi: 10 },
    goals: [
      { id: newId(), name: 'Cel 1', month: 6, amount: null, enabled: true, flexible: false },
      { id: newId(), name: 'Cel 2', month: 12, amount: null, enabled: true, flexible: false },
      { id: newId(), name: 'Cel 3', month: 19, amount: null, enabled: true, flexible: false }
    ],
    ...over
  }
}

function run(f: Forecast) {
  const out = forecastInputFrom(f, settings)
  if (!out.ok) throw new Error('no input')
  const result = simulateForecast(out.input)
  const cash = f.keep === 'fund' ? simulateForecast({ ...out.input, keep: 'cash' }) : null
  return { input: out.input, result, cash, pip: out.pip }
}

const statusText = (f: Forecast, i: number) => {
  const { input, result, cash } = run(f)
  return goalStatus(f.goals[i]!, { scenario: f, input, result, cash }).parts.map((p) => p.text).join('')
}

describe('fmtAmount', () => {
  it('grupy tysięcy twardą spacją, 2 miejsca, bez plusa, minus U+2212, nigdy „−0.00”', () => {
    expect(fmtAmount(1223.5, 'PLN')).toBe(`1${NBSP}223.50 PLN`)
    expect(fmtAmount(3365620.2183, 'PLN')).toBe(`3${NBSP}365${NBSP}620.22 PLN`)
    expect(fmtAmount(-5000)).toBe(`−5${NBSP}000.00`)
    expect(fmtAmount(-0.004, 'PLN')).toBe('0.00 PLN')
    expect(fmtAmount(-0)).toBe('0.00')
    expect(fmtAmount(999.999)).toBe(`1${NBSP}000.00`)
    expect(fmtAmount(12.5, 'USD', 1)).toBe('12.5 USD')
    expect(fmtAmount(null)).toBe('—')
    expect(fmtAmount(Number.NaN, 'PLN')).toBe('—')
  })

  it('procenty', () => {
    expect(fmtPct(11)).toBe('11.00%')
    expect(fmtPct(-2.5)).toBe('−2.50%')
    expect(fmtPct(-0.001)).toBe('0.00%')
    expect(fmtPctShort(50)).toBe('50%')
    expect(fmtPctShort(46.5)).toBe('46.5%')
    expect(shortPercent(10.25)).toBe('10.25%')
  })
})

describe('forecastTable', () => {
  it('kolumny prototypu (gotówka) i wartości wierszy jako liczby', () => {
    const f = t1()
    const { input, result } = run(f)
    const table = forecastTable(result, f, input)
    expect(table.columns.map((c) => c.header)).toEqual([
      'Nr miesiąca',
      'Miesiąc',
      'Zwrot [%]',
      'Wpłata',
      'Kapitał na początku',
      'Zysk',
      'Wypłata (10%)',
      'Odłożona gotówka',
      'Cel zakupowy',
      'Kwota na cel',
      'Kapitał na koniec'
    ])
    expect(table.rows).toHaveLength(50)
    expect(table.rows[0]).toEqual([1, '11-2026', 11, 0, 10000, 1100, 110, 110, '', null, 10990])
    expect(table.rows[5]).toEqual([6, '4-2027', 11, 2000, 28217.94, 3103.97, 310.4, 0, 'Cel 1', 1223.5, 31011.52])
    expect(table.rows[49]![10]).toBe(3365620.22)
  })

  it('fundusz celowy: nagłówki funduszu; bez aktywnych celów bez kolumn celu', () => {
    const f = t1({ keep: 'fund', payoutPercent: 46.5, goals: [{ id: newId(), name: 'Daleki', month: 60, amount: null, enabled: true, flexible: false }] })
    const { input, result } = run(f)
    const table = forecastTable(result, f, input)
    expect(table.columns.map((c) => c.header)).toEqual([
      'Nr miesiąca',
      'Miesiąc',
      'Zwrot [%]',
      'Wpłata',
      'Masa obrotowa na początku',
      'Zysk',
      'Odkładana wypłata (46.5%)',
      'Fundusz celowy',
      'Masa obrotowa na koniec'
    ])
    expect(forecastColumnsVisible(f, input).goals).toBe(false)
  })

  it('TSV do schowka: tabulatory, przecinek dziesiętny, bez separatora tysięcy, CRLF; zwrot z 4 miejscami', () => {
    const f = t1()
    const { input, result } = run(f)
    const tsv = forecastTsv(forecastTable(result, f, input))
    const lines = tsv.split('\r\n')
    expect(lines).toHaveLength(51)
    expect(lines[0]).toBe('Nr miesiąca\tMiesiąc\tZwrot [%]\tWpłata\tKapitał na początku\tZysk\tWypłata (10%)\tOdłożona gotówka\tCel zakupowy\tKwota na cel\tKapitał na koniec')
    expect(lines[1]).toBe('1\t11-2026\t11,0000\t0,00\t10000,00\t1100,00\t110,00\t110,00\t\t\t10990,00')
    expect(lines[6]).toBe('6\t4-2027\t11,0000\t2000,00\t28217,94\t3103,97\t310,40\t0,00\tCel 1\t1223,50\t31011,52')
    expect(tsv).not.toContain('\n\n')
    expect(tsv.endsWith('3365620,22')).toBe(true)
  })
})

describe('teksty strony prognozy', () => {
  it('statusy celów w gotówce i w funduszu (porównanie z gotówką)', () => {
    expect(statusText(t1(), 0)).toBe(`1${NBSP}223.50 PLN w mies. 6 (4-2027)`)
    expect(statusText(t1({ keep: 'fund' }), 0)).toBe(`1${NBSP}252.99 PLN w mies. 6 (4-2027) · w gotówce: 1${NBSP}223.50 PLN`)
    const withAmount = t1()
    withAmount.goals[0]!.amount = 2000
    expect(statusText(withAmount, 0)).toBe('Kupiony w mies. 8 (6-2027), 2 mies. po planie')
    expect(statusText({ ...withAmount, keep: 'fund' }, 0)).toBe('Kupiony w mies. 8 (6-2027), 2 mies. po planie · w gotówce: mies. 8')
  })

  it('statusy ostrzeżeń: miesiąc, wyłączony, poza tabelą, blokada, nie uzbierał się, nic nie dostał', () => {
    const f = t1()
    f.goals[0]!.month = null
    expect(statusText(f, 0)).toBe('Wpisz numer miesiąca od 1 do 240.')
    const off = t1()
    off.goals[1]!.enabled = false
    expect(statusText(off, 1)).toBe('Wyłączony, nie wpływa na tabelę.')
    const far = t1()
    far.goals[2]!.month = 60
    expect(statusText(far, 2)).toBe('Poza tabelą, która ma 50 miesięcy. Zwiększ liczbę miesięcy.')
    const big = t1()
    big.goals[0]!.amount = 50_000_000
    expect(statusText(big, 0)).toMatch(/^Nie uzbierał się do końca tabeli: w gotówce jest 361\s957\.80 /) // nothing bought: all payouts
    expect(statusText(big, 0)).toMatch(/ z 50\s000\s000\.00 PLN\.$/)
    expect(statusText(big, 1)).toBe('Czeka na cel „Cel 1”, który nie uzbierał się do końca tabeli.')
    expect(statusText({ ...big, keep: 'fund' }, 0)).toMatch(/^Nie uzbierał się do końca tabeli: w funduszu jest .* · w gotówce by się nie uzbierał$/)
    const same = t1()
    same.goals[2]!.month = 12
    expect(statusText(same, 2)).toBe('Nic nie dostał: w tym samym miesiącu wszystko zabrał cel „Cel 2”.')
    const empty = t1({ payoutPercent: 0 })
    expect(statusText(empty, 0)).toBe('Nic nie dostał: odłożona pula była pusta.')
    const unnamed = t1()
    unnamed.goals[0]!.amount = 50_000_000
    unnamed.goals[0]!.name = '  '
    expect(statusText(unnamed, 1)).toBe('Czeka na cel „Bez nazwy”, który nie uzbierał się do końca tabeli.')
  })

  it('podsumowanie: komórki gotówki (T1) i funduszu (T2)', () => {
    const f = t1()
    const cells = summaryCells({ scenario: f, ...run(f) })
    expect(cells.map((c) => [c.key, c.label, c.value.replace(/ /g, ' '), c.sub])).toEqual([
      ['last', 'Ostatnia wypłata', '33 686.83 PLN', 'w miesiącu 50 (12-2030)'],
      ['payout', 'Suma wypłat', '361 957.80 PLN', 'przez 50 miesięcy'],
      ['spent', 'Na cele zakupowe', '12 594.03 PLN', 'kupione: 3 cele'],
      ['pot', 'Odłożona gotówka', '349 363.77 PLN', 'na koniec, po zakupach'],
      ['end', 'Kapitał na koniec', '3 365 620.22 PLN', 'po miesiącu 50 (12-2030)'],
      ['mean', 'Średni zwrot', '11.00%', 'stały, co miesiąc']
    ])
    const fund = t1({ keep: 'fund' })
    const fc = summaryCells({ scenario: fund, ...run(fund) })
    expect(fc.map((c) => [c.label, c.value.replace(/ /g, ' '), c.sub])).toEqual([
      ['Zarobek funduszu', '951 461.91 PLN', 'o tyle więcej zysku niż przy wypłacie w gotówce'],
      ['Odłożone z zysku', '457 103.99 PLN', 'przez 50 miesięcy'],
      ['Na cele zakupowe', '13 137.09 PLN', 'kupione: 3 cele'],
      ['Fundusz celowy', '443 966.90 PLN', 'na koniec, po zakupach'],
      ['Masa obrotowa', '4 665 902.84 PLN', 'kapitał z funduszem po mies. 50 (12-2030)'],
      ['Średni zwrot', '11.00%', 'stały, co miesiąc']
    ])
  })

  it('podsumowanie: podpisy celów, zwrotu losowego, bez celów, z wypłatą z kapitału', () => {
    const noGoals = t1({ goals: [] })
    const c1 = summaryCells({ scenario: noGoals, ...run(noGoals) })
    expect(c1.find((c) => c.key === 'spent')?.sub).toBe('brak aktywnych celów')
    expect(c1.find((c) => c.key === 'pot')?.sub).toBe('wszystkie wypłaty')
    const waiting = t1()
    waiting.goals[0]!.amount = 50_000_000
    expect(summaryCells({ scenario: waiting, ...run(waiting) }).find((c) => c.key === 'spent')?.sub).toBe('jeszcze żaden cel, 3 czekają')
    const random = t1({ pct: { mode: 'random', fixed: 11, lo: 10, hi: 7 }, deposits: { '5': -1000 } })
    const c2 = summaryCells({ scenario: random, ...run(random) })
    expect(c2.find((c) => c.key === 'mean')?.sub).toBe('losowany z 7–10%')
    expect(c2.find((c) => c.key === 'withdrawn')?.value).toBe(`1${NBSP}000.00 PLN`)
  })

  it('opis tabeli: okres, wpłacone łącznie, wpłaty niestandardowe, wypłaty z kapitału', () => {
    const f = t1()
    expect(tableDescription(f, run(f).input, run(f).result)).toBe(`50 miesięcy, od 11-2026 do 12-2030 · wpłacone łącznie 108${NBSP}000.00 PLN`)
    const custom = t1({ deposits: { '3': 5000, '4': -1000, '7': 0, '80': 1 } })
    const { input, result } = run(custom)
    expect(tableDescription(custom, input, result)).toBe(
      `50 miesięcy, od 11-2026 do 12-2030 · wpłacone łącznie 107${NBSP}000.00 PLN (3 wpłaty niestandardowe) · wypłacone z kapitału 1${NBSP}000.00 PLN` // 10 000 + 46 × 2 000 + 5 000
    )
    const one = t1({ months: 1, deposits: { '1': 500 } })
    const r1 = run(one)
    expect(tableDescription(one, r1.input, r1.result)).toBe(`1 miesiąc, od 11-2026 do 11-2026 · wpłacone łącznie 10${NBSP}500.00 PLN (1 wpłata niestandardowa)`)
  })

  it('tryb pipsowy: wartość pipsa, zysk co miesiąc, podpowiedź lota', () => {
    const f = t1({ gain: 'pips' })
    const { pip } = run(f)
    expect(pipValueText(pip!, 'PLN')).toBe('0.10 USD za 1 pips przy 0.01 lota × kurs 3.8881 = 0.3888 PLN')
    expect(fixedPipsSummary(200, 0.1, pip!, 'PLN')).toEqual({ profit: '777.62 PLN', detail: '200 pipsów × 0.10 USD × 10 = 200.00 USD, po kursie 3.8881' })
    expect(fixedPipsSummary(1, 0.01, pip!, 'PLN').detail).toBe('1 pips × 0.10 USD × 1 = 0.10 USD, po kursie 3.8881')
    expect(fixedPipsSummary(2.5, 0.01, pip!, 'PLN').detail).toMatch(/^2\.5 pipsa × /)
    expect(fixedPipsSummary(-3, 0.01, pip!, 'PLN').detail).toMatch(/^−3 pipsy × .* = −0\.30 USD/)
    const usd = t1({ gain: 'pips', currency: 'USD' })
    const p2 = run(usd).pip!
    expect(pipValueText(p2, 'USD')).toBe('0.10 USD za 1 pips przy 0.01 lota')
    expect(fixedPipsSummary(200, 0.1, p2, 'USD').detail).toBe('200 pipsów × 0.10 USD × 10 = 200.00 USD')
    expect(lotHint(0.1, 0.01)).toBe('to 10 × najmniejszy lot (0.01)')
    expect(lotHint(0.005, 0.01)).toBe('Mniej niż najmniejszy lot (0.01).')
  })

  it('pole wpłaty: spacje, przecinek, minus U+2212; puste = standardowa; tekst = błąd', () => {
    expect(parseDeposit('5 000.00')).toBe(5000)
    expect(parseDeposit('−1 000,5')).toBe(-1000.5)
    expect(parseDeposit('-0')).toBe(-0)
    expect(parseDeposit('')).toBeNull()
    expect(parseDeposit('  ')).toBeNull()
    expect(parseDeposit('abc')).toBeUndefined()
    expect(parseDeposit('1e5')).toBeUndefined()
    expect(parseDeposit('2000000000000')).toBeUndefined()
  })
})
