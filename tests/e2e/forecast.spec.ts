import { promises as fs } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launch } from './app'

const shots = (name: string) => join('test-results', 'screens', `${name}.png`)

const NBP_TABLE = [
  {
    table: 'A',
    no: '192/A/NBP/2026',
    effectiveDate: '2026-10-02',
    rates: [
      { currency: 'dolar amerykański', code: 'USD', mid: 3.8881 },
      { currency: 'euro', code: 'EUR', mid: 4.3745 },
      { currency: 'funt szterling', code: 'GBP', mid: 5.1353 },
      { currency: 'dolar australijski', code: 'AUD', mid: 2.699 }
    ]
  }
]

async function nbpServer(): Promise<{ server: Server; url: string }> {
  const server = createServer((_req, res) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(NBP_TABLE)))
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  return { server, url: `http://127.0.0.1:${(server.address() as { port: number }).port}` }
}

const fill = async (page: Page, testId: string, value: string) => {
  await page.getByTestId(testId).fill(value)
  await page.getByTestId(testId).press('Tab')
}
const radio = (page: Page, group: string, name: string) => page.getByRole('radiogroup', { name: group }).getByRole('radio', { name, exact: true })

/** Ctrl+7 → empty state → first scenario, set up like the prototype tests (T1): 11%, 10%, 10 000 + 2 000, 11-2026, 50 months, goals 6/12/19, cash, PLN. */
async function firstScenarioLikeT1(page: Page) {
  await expect(page.getByTestId('journal-table')).toBeVisible()
  await page.keyboard.press('Control+7')
  await expect(page.getByTestId('fc-empty')).toBeVisible()
  await expect(page.getByTestId('fc-empty')).toContainText('Utwórz pierwszy scenariusz')
  await page.getByTestId('fc-create-first').click()
  await expect(page.getByTestId('fc-name')).toHaveValue('Scenariusz 1')
  await fill(page, 'fc-currency', 'PLN')
  await radio(page, 'Rodzaj zwrotu', 'Stały').click()
  await fill(page, 'fc-pct-fixed', '11')
  await fill(page, 'fc-payout', '10')
  await fill(page, 'fc-start', '10000')
  await fill(page, 'fc-monthly', '2000')
  await page.getByTestId('fc-first-month').selectOption({ label: 'listopad' })
  await fill(page, 'fc-first-year', '2026')
  await fill(page, 'fc-months', '50')
  for (let i = 0; i < 3; i++) await page.getByTestId('fc-goal-add').click()
  await expect(page.getByTestId('fc-goal-count')).toHaveText('3 / 10')
  await expect(page.getByTestId('fc-goal-3-month')).toHaveValue('18')
  await fill(page, 'fc-goal-3-month', '19')
  await radio(page, 'Tryb odkładania', 'Gotówka').click()
}

test('prognoza: pierwszy scenariusz w gotówce i w funduszu celowym (T1, T2)', async () => {
  const { app, page, dataDir, errors } = await launch()
  try {
    await firstScenarioLikeT1(page)
    // T1: goals without amounts take everything set aside in their month.
    await expect(page.getByTestId('fc-goal-1-status')).toHaveText('1 223.50 PLN w mies. 6 (4-2027)')
    await expect(page.getByTestId('fc-goal-2-status')).toHaveText('3 171.61 PLN w mies. 12 (10-2027)')
    await expect(page.getByTestId('fc-goal-3-status')).toHaveText('8 198.92 PLN w mies. 19 (5-2028)')
    await expect(page.getByTestId('fc-sum-last')).toHaveText('33 686.83 PLN')
    await expect(page.getByTestId('fc-sum-last-sub')).toHaveText('w miesiącu 50 (12-2030)')
    await expect(page.getByTestId('fc-sum-payout')).toHaveText('361 957.80 PLN')
    await expect(page.getByTestId('fc-sum-payout-sub')).toHaveText('przez 50 miesięcy')
    await expect(page.getByTestId('fc-sum-spent')).toHaveText('12 594.03 PLN')
    await expect(page.getByTestId('fc-sum-spent-sub')).toHaveText('kupione: 3 cele')
    await expect(page.getByTestId('fc-sum-pot')).toHaveText('349 363.77 PLN')
    await expect(page.getByTestId('fc-sum-end')).toHaveText('3 365 620.22 PLN')
    await expect(page.getByTestId('fc-sum-end-sub')).toHaveText('po miesiącu 50 (12-2030)')
    await expect(page.getByTestId('fc-sum-mean')).toHaveText('11.00%')
    await expect(page.getByTestId('fc-sum-mean-sub')).toHaveText('stały, co miesiąc')
    await expect(page.getByTestId('fc-table-description')).toHaveText('50 miesięcy, od 11-2026 do 12-2030 · wpłacone łącznie 108 000.00 PLN')
    // Month 1 and the month of the first purchase (checkpoints of chapter 18).
    await expect(page.getByTestId('fc-row-1')).toContainText('1 100.00')
    await expect(page.getByTestId('fc-row-1')).toContainText('10 990.00')
    await expect(page.getByTestId('fc-row-6')).toHaveClass(/fc-buy/)
    await expect(page.getByTestId('fc-row-6')).toContainText('Cel 1')
    await expect(page.getByTestId('fc-row-7')).toContainText('na: Cel 2')
    await page.screenshot({ path: shots('50-prognoza-gotowka'), fullPage: true })

    // T2: the same with the purpose fund, compared with the cash run.
    await radio(page, 'Tryb odkładania', 'Fundusz celowy').click()
    await expect(page.getByTestId('fc-keep-description')).toContainText('Odkładanej wypłaty nie wypłacasz')
    await expect(page.getByTestId('fc-goal-1-status')).toHaveText('1 252.99 PLN w mies. 6 (4-2027) · w gotówce: 1 223.50 PLN')
    await expect(page.getByTestId('fc-goal-2-status')).toHaveText('3 279.04 PLN w mies. 12 (10-2027) · w gotówce: 3 171.61 PLN')
    await expect(page.getByTestId('fc-goal-3-status')).toHaveText('8 605.07 PLN w mies. 19 (5-2028) · w gotówce: 8 198.92 PLN')
    await expect(page.getByTestId('fc-sum-fundGain')).toHaveText('951 461.91 PLN')
    await expect(page.getByTestId('fc-sum-payout')).toHaveText('457 103.99 PLN')
    await expect(page.getByTestId('fc-sum-end')).toHaveText('4 665 902.84 PLN')
    await expect(page.getByTestId('fc-sum-end-sub')).toHaveText('kapitał z funduszem po mies. 50 (12-2030)')
    await expect(page.getByTestId('fc-col-payout')).toContainText('Odkładana wypłata (10%)')
    await expect(page.getByTestId('fc-row-1')).toContainText('11 100.00')
    await page.screenshot({ path: shots('51-prognoza-fundusz'), fullPage: true })

    // The scenario is a file in forecasts/.
    await expect
      .poll(async () => (await fs.readdir(join(dataDir, 'forecasts')).catch(() => [])).filter((n) => n.endsWith('.json')).length, { timeout: 8000 })
      .toBe(1)
    const [file] = (await fs.readdir(join(dataDir, 'forecasts'))).filter((n) => n.endsWith('.json'))
    await expect
      .poll(async () => JSON.parse(await fs.readFile(join(dataDir, 'forecasts', file!), 'utf8')).keep, { timeout: 8000 })
      .toBe('fund')
    const saved = JSON.parse(await fs.readFile(join(dataDir, 'forecasts', file!), 'utf8'))
    expect(saved).toMatchObject({ name: 'Scenariusz 1', currency: 'PLN', payoutPercent: 10, startCapital: 10000, monthlyDeposit: 2000, firstMonth: '2026-11', months: 50 })
    expect(saved.goals.map((g: { name: string; month: number }) => `${g.name}:${g.month}`)).toEqual(['Cel 1:6', 'Cel 2:12', 'Cel 3:19'])
    expect(saved.draws.rate).toHaveLength(240)
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})

test('prognoza: suwak, pole i szybki wybór wypłaty; nagłówek kolumny', async () => {
  const { app, page, errors } = await launch()
  try {
    await firstScenarioLikeT1(page)
    const field = page.getByTestId('fc-payout')
    const range = page.getByTestId('fc-payout-range')
    const header = page.getByTestId('fc-col-payout')
    await expect(header).toContainText('Wypłata (10%)')
    // slider → field
    await range.focus()
    await page.keyboard.press('End')
    await expect(field).toHaveValue('100')
    await expect(header).toContainText('Wypłata (100%)')
    await page.keyboard.press('ArrowLeft')
    await expect(field).toHaveValue('99')
    // field → slider (46.5 is allowed; the slider shows the nearest position), values out of range are clipped
    await fill(page, 'fc-payout', '46,5')
    await expect(field).toHaveValue('46.5')
    await expect(range).toHaveValue('47')
    await expect(header).toContainText('Wypłata (46.5%)')
    await fill(page, 'fc-payout', '150')
    await expect(field).toHaveValue('100')
    // An emptied required field: error border, the value comes back on blur.
    await field.fill('')
    await expect(field).toHaveAttribute('aria-invalid', 'true')
    await field.press('Tab')
    await expect(field).toHaveValue('100')
    await field.focus()
    await page.keyboard.press('Shift+ArrowDown')
    await expect(field).toHaveValue('90')
    // quick choice
    await page.getByTestId('fc-quick-25').click()
    await expect(field).toHaveValue('25')
    await expect(range).toHaveValue('25')
    await expect(page.getByTestId('fc-quick-25')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('fc-quick-10')).toHaveAttribute('aria-pressed', 'false')
    await expect(header).toContainText('Wypłata (25%)')
    // Arrow steps finer than the shown places (11 + 0.5); negatives use U+2212 and both minus signs are accepted.
    const pct = page.getByTestId('fc-pct-fixed')
    await pct.focus()
    await page.keyboard.press('ArrowUp')
    await expect(pct).toHaveValue('11.5')
    await page.keyboard.press('ArrowDown')
    await expect(pct).toHaveValue('11')
    await fill(page, 'fc-pct-fixed', '\u22122,5')
    await page.keyboard.press('Tab')
    await expect(pct).toHaveValue('\u22122.5')
    await fill(page, 'fc-pct-fixed', '11')
    // the bar sticks to the top while the page scrolls
    await page.getByTestId('fc-table').scrollIntoViewIfNeeded()
    await expect(page.getByTestId('fc-payout-bar')).toBeInViewport()
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})

test('prognoza: wpłaty niestandardowe w tabeli (fokus, Enter, kwota ujemna, przywracanie)', async () => {
  const { app, page, errors } = await launch()
  try {
    await firstScenarioLikeT1(page)
    const dep3 = page.getByTestId('fc-dep-3')
    await expect(dep3).toHaveAttribute('placeholder', '2\u00a0000.00') // thousands grouped with U+00A0
    await expect(page.getByTestId('fc-dep-1')).toHaveAttribute('placeholder', '0.00')
    await expect(dep3).toHaveAttribute('aria-label', 'Wpłata w miesiącu 3 (1-2027)')
    // Typed character by character: the table recalculates and the field keeps focus.
    await dep3.click()
    for (const ch of '5000') {
      await page.keyboard.type(ch)
      await expect(dep3).toBeFocused()
    }
    await expect(dep3).toHaveValue('5000')
    await expect(page.getByTestId('fc-table-description')).toContainText('wpłacone łącznie 111 000.00 PLN (1 wpłata niestandardowa)')
    // capital at the start of month 3: 3 000 more than with the standard deposit (16 276.01)
    await expect(page.getByTestId('fc-row-3')).toContainText('19 276.01')
    // Enter goes to the next month, with the content selected.
    await page.keyboard.press('Enter')
    const dep4 = page.getByTestId('fc-dep-4')
    await expect(dep4).toBeFocused()
    await page.keyboard.type('-1000')
    await expect(page.getByTestId('fc-table-description')).toContainText('(2 wpłaty niestandardowe) · wypłacone z kapitału 1 000.00 PLN')
    await page.keyboard.press('ArrowUp')
    await expect(dep3).toBeFocused()
    await expect(dep4).toHaveValue('−1\u00a0000.00')
    await expect(dep4).toHaveAttribute('data-custom', 'true')
    await expect(page.getByTestId('fc-sum-withdrawn')).toHaveText('1 000.00 PLN')
    // Invalid text: red border, state unchanged; after leaving the field the last valid value is back.
    await page.keyboard.type('abc')
    await expect(dep3).toHaveAttribute('aria-invalid', 'true')
    // The red border wins over the highlight of a custom deposit (#f6465d).
    await expect(dep3).toHaveAttribute('data-custom', 'true')
    await expect(dep3).toHaveCSS('border-top-color', 'rgb(246, 70, 93)')
    await expect(page.getByTestId('fc-row-3')).toContainText('19 276.01')
    await page.keyboard.press('Tab')
    await expect(dep3).toHaveValue('5\u00a0000.00')
    // 0 is a custom deposit too; clearing the field brings the standard one back.
    await dep4.fill('0')
    await expect(page.getByTestId('fc-table-description')).not.toContainText('wypłacone z kapitału')
    await dep4.fill('')
    await expect(page.getByTestId('fc-table-description')).toContainText('(1 wpłata niestandardowa)')
    await page.screenshot({ path: shots('52-prognoza-wplaty') })
    await page.getByTestId('fc-reset-deposits').click()
    await expect(page.getByTestId('fc-reset-deposits')).toHaveCount(0)
    await expect(dep3).toHaveValue('')
    await expect(page.getByTestId('fc-table-description')).toHaveText('50 miesięcy, od 11-2026 do 12-2030 · wpłacone łącznie 108 000.00 PLN')
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})

test('prognoza: cel z kwotą kupiony później niż w planie; pola celów', async () => {
  const { app, page, errors } = await launch()
  try {
    await firstScenarioLikeT1(page)
    await fill(page, 'fc-goal-1-amount', '2000')
    await expect(page.getByTestId('fc-goal-1-status')).toHaveText('Kupiony w mies. 8 (6-2027), 2 mies. po planie')
    await expect(page.getByTestId('fc-goal-2-status')).toHaveText('2 395.11 PLN w mies. 12 (10-2027)')
    // 0 and negative amounts are refused; an empty amount = a goal without an amount.
    await page.getByTestId('fc-goal-1-amount').fill('0')
    await expect(page.getByTestId('fc-goal-1-amount')).toHaveAttribute('aria-invalid', 'true')
    await page.getByTestId('fc-goal-1-amount').press('Tab')
    await expect(page.getByTestId('fc-goal-1-amount')).toHaveValue('2000')
    // A month outside 1–240 is not clipped: error border, warning status, the goal leaves the table.
    await page.getByTestId('fc-goal-3-month').fill('300')
    await page.getByTestId('fc-goal-3-month').press('Tab')
    await expect(page.getByTestId('fc-goal-3-month')).toHaveValue('300')
    await expect(page.getByTestId('fc-goal-3-month')).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByTestId('fc-goal-3-status')).toHaveText('Wpisz numer miesiąca od 1 do 240.')
    await fill(page, 'fc-goal-3-month', '60')
    await expect(page.getByTestId('fc-goal-3-status')).toHaveText('Poza tabelą, która ma 50 miesięcy. Zwiększ liczbę miesięcy.')
    // Text that is not a whole number is refused like in other fields: state unchanged, the value is back on blur.
    await page.getByTestId('fc-goal-3-month').fill('5.5')
    await expect(page.getByTestId('fc-goal-3-month')).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByTestId('fc-goal-3-status')).toHaveText('Poza tabelą, która ma 50 miesięcy. Zwiększ liczbę miesięcy.')
    await page.getByTestId('fc-goal-3-month').press('Tab')
    await expect(page.getByTestId('fc-goal-3-month')).toHaveValue('60')
    // A switched off goal is ignored.
    await page.getByTestId('fc-goal-2-on').getByRole('switch').click()
    await expect(page.getByTestId('fc-goal-2-status')).toHaveText('Wyłączony, nie wpływa na tabelę.')
    await expect(page.getByTestId('fc-sum-spent-sub')).toHaveText('kupione: 1 cel')
    // Two goals without an amount in the same month: the second one gets nothing.
    await page.getByTestId('fc-goal-2-on').getByRole('switch').click()
    await fill(page, 'fc-goal-1-amount', '')
    await fill(page, 'fc-goal-3-month', '12')
    await expect(page.getByTestId('fc-goal-3-status')).toHaveText('Nic nie dostał: w tym samym miesiącu wszystko zabrał cel „Cel 2”.')
    // New goal: name selected for typing, month = the latest + 6; removing focuses "+ Dodaj cel".
    await page.getByTestId('fc-goal-add').click()
    await expect(page.getByTestId('fc-goal-4-name')).toBeFocused()
    await expect(page.getByTestId('fc-goal-4-month')).toHaveValue('18')
    await page.keyboard.type('Wakacje')
    await expect(page.getByTestId('fc-goal-4-name')).toHaveValue('Wakacje')
    await page.getByTestId('fc-goal-4-del').click()
    await expect(page.getByTestId('fc-goal-add')).toBeFocused()
    await expect(page.getByTestId('fc-goal-count')).toHaveText('3 / 10')
    await page.screenshot({ path: shots('53-prognoza-cele'), fullPage: true })
    // At 10 goals the button is disabled and says so.
    for (let i = 0; i < 7; i++) await page.getByTestId('fc-goal-add').click()
    await expect(page.getByTestId('fc-goal-count')).toHaveText('10 / 10')
    await expect(page.getByTestId('fc-goal-add')).toBeDisabled()
    await expect(page.getByTestId('fc-goal-add')).toHaveText('Limit: 10 celów')
    // The page links to the profit / loss calculator in either mode.
    await page.getByTestId('fc-open-calculator').click()
    await expect(page.getByTestId('pnl')).toBeVisible()
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})

test('prognoza: tryb pipsowy z kursem NBP z lokalnego serwera (T7)', async () => {
  const { server, url } = await nbpServer()
  const { app, page, errors } = await launch({ env: { ICTJ_NBP_URL: url, ICTJ_NBP_FETCH_DELAY_MS: '600000' } })
  try {
    await firstScenarioLikeT1(page)
    await radio(page, 'Tryb prognozy zysku', 'Pipsowy').click()
    await expect(radio(page, 'Instrument', 'EURUSD')).toHaveAttribute('aria-checked', 'true')
    // Without a USD → PLN rate there is nothing to calculate.
    await expect(page.getByTestId('fc-pips-missing')).toHaveText('Wpisz kurs USD → PLN w polu wyżej albo wartość pipsa w kalkulatorze zysku / straty.')
    await expect(page.getByTestId('fc-table-empty')).toBeVisible()
    await expect(page.getByTestId('fc-summary-empty')).toBeVisible()
    // Random pips cannot be spread without a rate either – but this is not "no randomness".
    await expect(page.getByTestId('fc-mc-run')).toBeDisabled()
    await expect(page.getByTestId('fc-spread')).toContainText('Rozrzut będzie dostępny, gdy prognozę da się policzyć')
    await expect(page.getByTestId('fc-spread')).not.toContainText('nie ma losowości')
    // The NBP table (button in the settings) fills the rate.
    await page.keyboard.press('Control+,')
    await page.getByTestId('settings-tab-display').click()
    await page.getByTestId('fx-refresh').click()
    await expect(page.getByText('Pobrano kursy NBP: tabela 192/A/NBP/2026 z dnia 2026-10-02.')).toBeVisible()
    await page.keyboard.press('Control+7')
    await expect(page.getByTestId('fc-rate')).toHaveValue('3.8881')
    await expect(page.getByTestId('forecast').getByText('kurs NBP z dnia 2026-10-02 — możesz wpisać własny')).toBeVisible()
    await expect(page.getByTestId('fc-pip-value')).toHaveText('0.10 USD za 1 pips przy 0.01 lota × kurs 3.8881 = 0.3888 PLN')
    await expect(page.getByTestId('fc-pips-summary')).toHaveText('Zysk co miesiąc: 777.62 PLN. 200 pipsów × 0.10 USD × 10 = 200.00 USD, po kursie 3.8881')
    await expect(page.getByTestId('fc-lot').locator('..').locator('..')).toContainText('to 10 × najmniejszy lot (0.01)')
    await expect(page.getByTestId('fc-goal-1-status')).toHaveText('466.57 PLN w mies. 6 (4-2027)')
    await expect(page.getByTestId('fc-goal-3-status')).toHaveText('544.33 PLN w mies. 19 (5-2028)')
    await expect(page.getByTestId('fc-sum-end')).toHaveText('142 992.90 PLN')
    await expect(page.getByTestId('fc-sum-mean-sub')).toHaveText('tyle wychodzi z pipsów')
    await expect(page.getByTestId('fc-row-1')).toContainText('777.62')
    await page.screenshot({ path: shots('54-prognoza-pipsy'), fullPage: true })
    // A typed rate changes the pip value; a lot smaller than the smallest lot is flagged.
    await fill(page, 'fc-rate', '4')
    await expect(page.getByTestId('fc-pips-summary')).toContainText('Zysk co miesiąc: 800.00 PLN')
    // The lot steps by the smallest lot even when the value shows fewer places (0.1 → 0.11 → 0.1).
    const lot = page.getByTestId('fc-lot')
    await lot.focus()
    await page.keyboard.press('ArrowUp')
    await expect(lot).toHaveValue('0.11')
    await page.keyboard.press('ArrowDown')
    await expect(lot).toHaveValue('0.1')
    await fill(page, 'fc-lot', '0.005')
    await expect(page.getByTestId('fc-lot').locator('..').locator('..')).toContainText('Mniej niż najmniejszy lot (0.01).')
    expect(errors).toEqual([])
  } finally {
    await app.close()
    server.close()
  }
})

test('prognoza: podatek, miesiące stratne, „może poczekać”, pipsy losowe, lot z ryzyka, podsumowania roczne', async () => {
  const { server, url } = await nbpServer()
  const { app, page, errors } = await launch({ env: { ICTJ_NBP_URL: url, ICTJ_NBP_FETCH_DELAY_MS: '200' } })
  const headers = () => page.getByTestId('fc-table').locator('thead th').allInnerTexts()
  try {
    await firstScenarioLikeT1(page)
    // Tax: a column, the summary cells and the yearly rows.
    expect((await headers()).join('|')).not.toContain('Podatek')
    await page.getByTestId('fc-tax').getByRole('switch').click()
    await expect(page.getByTestId('fc-tax-rate')).toHaveValue('19')
    await expect(page.getByTestId('fc-tax-month')).toHaveValue('4')
    await expect.poll(async () => (await headers()).some((h) => h.startsWith('Podatek'))).toBe(true)
    await expect(page.getByTestId('fc-sum-tax')).toBeVisible()
    await expect(page.getByTestId('fc-sum-tax-sub')).toContainText('do zapłaty po okresie:')
    // tax for 2026 (2 months) is paid in April 2027 = month 6
    await expect(page.getByTestId('fc-row-6').locator('td').nth(3)).not.toHaveText('')
    await expect(page.getByTestId('fc-row-5').locator('td').nth(3)).toHaveText('')

    // Yearly rows; folding one year and all of them.
    await expect(page.getByTestId('fc-year-2027')).toContainText('Rok 2027')
    await expect(page.getByTestId('fc-year-2027')).toContainText('2 cele')
    await page.getByTestId('fc-year-2027').click()
    await expect(page.getByTestId('fc-row-5')).toHaveCount(0)
    await expect(page.getByTestId('fc-row-15')).toBeVisible()
    await page.getByTestId('fc-year-2027').click()
    await expect(page.getByTestId('fc-row-5')).toBeVisible()
    await page.getByTestId('fc-years-toggle').click()
    await expect(page.getByTestId('fc-table').locator('tbody tr')).toHaveCount(5)
    await expect(page.getByTestId('fc-years-toggle')).toHaveText('Rozwiń lata')
    await page.getByTestId('fc-years-toggle').click()
    await expect(page.getByTestId('fc-table').locator('tbody tr')).toHaveCount(55)

    // "Może poczekać": only with an amount; a waiting goal does not block the next ones.
    await expect(page.getByTestId('fc-goal-1-flex')).toHaveAttribute('aria-disabled', 'true')
    await fill(page, 'fc-goal-1-amount', '50000000')
    await expect(page.getByTestId('fc-goal-2-status')).toHaveText('Czeka na cel „Cel 1”, który nie uzbierał się do końca tabeli.')
    await page.getByTestId('fc-goal-1-flex').getByRole('switch').click()
    await expect(page.getByTestId('fc-goal-1-status')).toContainText('Nie uzbierał się do końca tabeli: w gotówce jest')
    await expect(page.getByTestId('fc-goal-2-status')).toContainText('w mies. 12 (10-2027)')
    await expect(page.getByTestId('fc-sum-spent-sub')).toHaveText('kupione: 2 cele, 1 czeka')

    // Loss months (percent mode): range, re-draw, the summary counts them; losing months are red.
    await fill(page, 'fc-loss-prob', '30')
    await expect(page.getByTestId('fc-loss-lo')).toHaveValue('2')
    await expect(page.getByTestId('fc-loss-hi')).toHaveValue('5')
    await expect(page.getByTestId('fc-sum-mean-sub')).toContainText('stratnych miesięcy:')
    await expect(page.getByTestId('fc-table').locator('td.text-down').first()).toBeVisible()
    await page.getByTestId('fc-reroll-loss').click()
    await expect(page.getByText('Wylosowano nowy scenariusz.')).toBeVisible()

    // Pip mode: random pips (column Pipsy) and a lot from risk (column Lot) with a maximum.
    await radio(page, 'Tryb prognozy zysku', 'Pipsowy').click()
    await expect(page.getByTestId('fc-rate')).toHaveValue('3.8881', { timeout: 15_000 })
    await expect.poll(async () => (await headers()).some((h) => h.startsWith('Pipsy'))).toBe(true) // losing months show pips
    await radio(page, 'Pipsy w miesiącu', 'Losowe z zakresu').click()
    await fill(page, 'fc-pips-lo', '-100')
    await fill(page, 'fc-pips-hi', '300')
    await expect(page.getByTestId('fc-reroll-pips')).toBeVisible()
    await radio(page, 'Wielkość lota', 'Lot z ryzyka').click()
    await fill(page, 'fc-risk', '1')
    await fill(page, 'fc-stop', '20')
    await fill(page, 'fc-lot-max', '0.5')
    await expect.poll(async () => (await headers()).some((h) => h.startsWith('Lot'))).toBe(true)
    await expect(page.getByTestId('fc-pips-summary')).toHaveText('Zysk zmienia się co miesiąc; lot i pipsy każdego miesiąca są w tabeli.')
    // 1% of 10 000 PLN with SL 20 pips and 0.3888 PLN per pip for 0.01 lot → 0.12 lota
    await expect(page.getByTestId('fc-row-1')).toContainText('0.12')
    await radio(page, 'Wielkość lota', 'Lot na kwotę kapitału').click()
    await expect(page.getByTestId('fc-lot-per')).toHaveValue('0.01')
    await expect(page.getByTestId('fc-lot-per-amount')).toHaveValue('1000')
    await page.screenshot({ path: shots('55-prognoza-usprawnienia') })
    expect(errors).toEqual([])
  } finally {
    await app.close()
    server.close()
  }
})

test('prognoza: scenariusze – duplikuj, zmień nazwę, porównaj, usuń (plik znika z forecasts/)', async () => {
  const { app, page, dataDir, errors } = await launch()
  const files = async () => (await fs.readdir(join(dataDir, 'forecasts')).catch(() => [] as string[])).filter((n) => n.endsWith('.json'))
  try {
    await firstScenarioLikeT1(page)
    await expect.poll(files, { timeout: 8000 }).toHaveLength(1)
    // Duplicate (button): same draws and settings, name "(kopia)".
    await page.getByTestId('fc-duplicate').click()
    await expect(page.getByTestId('fc-name')).toHaveValue('Scenariusz 1 (kopia)')
    await expect(page.getByText('Utworzono kopię: „Scenariusz 1 (kopia)”.')).toBeVisible()
    await expect(page.getByTestId('fc-sum-end')).toHaveText('3 365 620.22 PLN')
    // Ctrl+Shift+D copies the scenario on screen – now the copy, hence "(kopia) (kopia)" ("(kopia 2)": unit tests).
    await page.getByTestId('fc-sum-end').click()
    await page.keyboard.press('Control+Shift+D')
    await expect(page.getByTestId('fc-name')).toHaveValue('Scenariusz 1 (kopia) (kopia)')
    await expect.poll(files, { timeout: 8000 }).toHaveLength(3)

    // Rename: empty and duplicate names are refused with a message.
    const name = page.getByTestId('fc-name')
    await name.fill('')
    await name.press('Enter')
    await expect(page.getByText('Nazwa scenariusza nie może być pusta.')).toBeVisible()
    await expect(name).toHaveValue('Scenariusz 1 (kopia) (kopia)')
    await name.fill('scenariusz 1')
    await name.press('Enter')
    await expect(page.getByText('Scenariusz „scenariusz 1” już jest.')).toBeVisible()
    await name.fill('Fundusz 46%')
    await name.press('Enter')
    await expect(name).toHaveValue('Fundusz 46%')
    // The list is sorted by name.
    await expect(page.getByTestId('fc-scenario').locator('option')).toHaveText(['Fundusz 46%', 'Scenariusz 1', 'Scenariusz 1 (kopia)'])
    await radio(page, 'Tryb odkładania', 'Fundusz celowy').click()
    await page.getByTestId('fc-quick-46').click()

    // Notes.
    await page.getByTestId('fc-notes-toggle').click()
    await page.getByTestId('fc-notes').fill('Wariant z funduszem celowym')

    // Compare with "Scenariusz 1" (cash): different saving modes → only comparable rows.
    await page.getByTestId('fc-compare').selectOption({ label: 'Scenariusz 1' })
    await expect(page.getByTestId('fc-compare-panel')).toContainText('różne tryby odkładania')
    await expect(page.getByTestId('fc-cmp-end')).toContainText('3 365 620.22 PLN')
    // goals without an amount take the whole fund out of the mass, so the sign depends on the numbers: just green or red
    await expect(page.getByTestId('fc-cmp-end-diff')).toHaveClass(/text-(up|down)/)
    await expect(page.getByTestId('fc-cmp-end-diff')).toHaveText(/^[+−]\d/)
    await expect(page.getByTestId('fc-cmp-mean-diff')).toHaveText('0.00%')
    await expect(page.getByTestId('fc-compare-panel')).toContainText('mies. 6 (4-2027)')
    await page.screenshot({ path: shots('56-prognoza-porownanie'), fullPage: true })
    // The same mode: all summary rows; the copy without changes differs by zero.
    await page.getByTestId('fc-scenario').selectOption({ label: 'Scenariusz 1 (kopia)' })
    await page.getByTestId('fc-compare').selectOption({ label: 'Scenariusz 1' })
    await expect(page.getByTestId('fc-cmp-last')).toBeVisible()
    await expect(page.getByTestId('fc-cmp-end-diff')).toHaveText('0.00 PLN')
    await page.getByTestId('fc-compare').selectOption({ label: '—' })
    await expect(page.getByTestId('fc-compare-panel')).toHaveCount(0)

    // Delete with the in-page confirmation; the file goes away.
    const before = await files()
    await page.getByTestId('fc-delete').click()
    await expect(page.getByTestId('fc-delete-question')).toHaveText(/Usunąć scenariusz „Scenariusz 1 \(kopia\)”\?/)
    await page.getByTestId('fc-delete-cancel').click()
    await expect(page.getByTestId('fc-delete-question')).toHaveCount(0)
    await page.getByTestId('fc-delete').click()
    await page.getByTestId('fc-delete-confirm').click()
    await expect(page.getByTestId('fc-scenario').locator('option')).toHaveText(['Fundusz 46%', 'Scenariusz 1'])
    await expect.poll(files, { timeout: 8000 }).toHaveLength(2)
    expect(before.length - (await files()).length).toBe(1)
    // Saving is asynchronous (debounced): wait until the files carry the last edits.
    const readAll = async () => Promise.all((await files()).map(async (f) => JSON.parse(await fs.readFile(join(dataDir, 'forecasts', f), 'utf8'))))
    await expect
      .poll(async () => (await readAll()).map((f) => `${f.name}|${f.keep}|${f.payoutPercent}|${f.notes}`).sort(), { timeout: 8000 })
      .toEqual(['Fundusz 46%|fund|46|Wariant z funduszem celowym', 'Scenariusz 1|cash|10|'])
    const saved = await readAll()
    expect(saved[0].draws).toEqual(saved[1].draws)
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})

test('prognoza: po ponownym uruchomieniu scenariusz i losowania są te same; brakujące losowania są dolosowane', async () => {
  const first = await launch()
  let mean = ''
  let end = ''
  let file = ''
  try {
    await expect(first.page.getByTestId('journal-table')).toBeVisible()
    await first.page.keyboard.press('Control+7')
    await first.page.getByTestId('fc-create-first').click()
    // the default return is random (7–10%)
    await expect(radio(first.page, 'Rodzaj zwrotu', 'Losowy z zakresu')).toHaveAttribute('aria-checked', 'true')
    await fill(first.page, 'fc-payout', '30')
    mean = (await first.page.getByTestId('fc-sum-mean').textContent()) ?? ''
    end = (await first.page.getByTestId('fc-sum-end').textContent()) ?? ''
    expect(mean).toMatch(/^[789]\.\d\d%$/)
    await expect.poll(async () => (await fs.readdir(join(first.dataDir, 'forecasts')).catch(() => [])).length, { timeout: 8000 }).toBe(1)
    file = join(first.dataDir, 'forecasts', (await fs.readdir(join(first.dataDir, 'forecasts')))[0]!)
    await expect.poll(async () => JSON.parse(await fs.readFile(file, 'utf8')).payoutPercent, { timeout: 8000 }).toBe(30)
  } finally {
    await first.app.close()
  }
  const draws = JSON.parse(await fs.readFile(file, 'utf8')).draws

  const second = await launch({ dataDir: first.dataDir, userData: first.userData })
  try {
    await expect(second.page.getByTestId('journal-table')).toBeVisible()
    await second.page.keyboard.press('Control+7')
    await expect(second.page.getByTestId('fc-payout')).toHaveValue('30')
    await expect(second.page.getByTestId('fc-sum-mean')).toHaveText(mean)
    await expect(second.page.getByTestId('fc-sum-end')).toHaveText(end)
    expect(JSON.parse(await fs.readFile(file, 'utf8')).draws).toEqual(draws)
  } finally {
    await second.app.close()
  }

  // A hand-edited file with fewer numbers: the missing ones are drawn when the scenario opens, the rest stay.
  const edited = JSON.parse(await fs.readFile(file, 'utf8'))
  edited.draws.rate = edited.draws.rate.slice(0, 10)
  await fs.writeFile(file, `${JSON.stringify(edited, null, 2)}\n`)
  const third = await launch({ dataDir: first.dataDir, userData: first.userData })
  try {
    await expect(third.page.getByTestId('journal-table')).toBeVisible()
    await third.page.keyboard.press('Control+7')
    await expect.poll(async () => JSON.parse(await fs.readFile(file, 'utf8')).draws.rate.length, { timeout: 8000 }).toBe(240)
    const after = JSON.parse(await fs.readFile(file, 'utf8')).draws
    expect(after.rate.slice(0, 10)).toEqual(draws.rate.slice(0, 10))
    expect(after.loss).toEqual(draws.loss)
    expect(third.errors).toEqual([])
  } finally {
    await third.app.close()
  }
})

test('prognoza: folder tylko do odczytu – scenariusz widoczny, zmiany nie są przyjmowane', async () => {
  const first = await launch()
  try {
    await firstScenarioLikeT1(first.page)
    await expect.poll(async () => (await fs.readdir(join(first.dataDir, 'forecasts')).catch(() => [])).length, { timeout: 8000 }).toBe(1)
  } finally {
    await first.app.close()
  }
  // A folder written by a newer app version is read-only.
  const journalPath = join(first.dataDir, 'journal.json')
  const journal = JSON.parse(await fs.readFile(journalPath, 'utf8'))
  await fs.writeFile(journalPath, `${JSON.stringify({ ...journal, schemaVersion: 99 }, null, 2)}\n`)
  const second = await launch({ dataDir: first.dataDir, userData: first.userData })
  try {
    await expect(second.page.getByTestId('journal-table')).toBeVisible()
    await second.page.keyboard.press('Control+7')
    await expect(second.page.getByTestId('fc-name')).toHaveValue('Scenariusz 1')
    await expect(second.page.getByTestId('fc-sum-end')).toHaveText('3 365 620.22 PLN')
    await expect(second.page.getByTestId('fc-new')).toBeDisabled()
    await expect(second.page.getByTestId('fc-duplicate')).toBeDisabled()
    await expect(second.page.getByTestId('fc-delete')).toBeDisabled()
    await expect(second.page.getByTestId('fc-goal-add')).toBeDisabled()
    await fill(second.page, 'fc-payout', '50')
    await expect(second.page.getByTestId('fc-payout')).toHaveValue('10')
    await second.page.keyboard.press('Control+Shift+D')
    await expect(second.page.getByTestId('fc-name')).toHaveValue('Scenariusz 1')
  } finally {
    await second.app.close()
  }
})

test('prognoza: rozrzut wyników (200 przebiegów), wykres z legendą i porównaniem', async () => {
  const { app, page, errors } = await launch()
  try {
    await firstScenarioLikeT1(page)
    // A fixed return has no randomness.
    await expect(page.getByTestId('fc-mc-run')).toBeDisabled()
    await expect(page.getByTestId('fc-spread')).toContainText('Ten scenariusz nie ma losowości, więc każdy przebieg jest taki sam.')
    await expect(page.getByTestId('fc-chart-legend')).toContainText('Kapitał')
    await expect(page.getByTestId('fc-chart-legend')).toContainText('Odłożona gotówka')
    await expect(page.getByTestId('fc-chart-spread')).toHaveCount(0)

    await radio(page, 'Rodzaj zwrotu', 'Losowy z zakresu').click()
    await radio(page, 'Liczba przebiegów', '200').click()
    await page.getByTestId('fc-mc-run').click()
    await expect(page.getByTestId('fc-mc-table')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('fc-mc-table')).toContainText('200 przebiegów')
    await expect(page.getByTestId('fc-mc-table')).toContainText('Pesymistyczny (5%)')
    await expect(page.getByTestId('fc-mc-table')).toContainText('Typowy (50%)')
    await expect(page.getByTestId('fc-mc-table')).toContainText('Optymistyczny (95%)')
    await expect(page.getByTestId('fc-mc-end')).toContainText('Kapitał na koniec')
    await expect(page.getByTestId('fc-mc-below')).toContainText('Szansa, że na koniec masz mniej kapitału, niż wpłaciłeś: 0.0%')
    await expect(page.getByTestId('fc-mc-goals')).toContainText('w 100% przebiegów')
    // The chart shows the spread (toggle and legend).
    await expect(page.getByTestId('fc-legend-spread')).toContainText('rozrzut 5% / 95% (200 przebiegów)')
    await expect(page.getByTestId('fc-legend-median')).toBeVisible()
    await page.getByTestId('fc-chart-spread').getByRole('switch').click()
    await expect(page.getByTestId('fc-legend-spread')).toHaveCount(0)
    await page.getByTestId('fc-chart-spread').getByRole('switch').click()
    await expect(page.getByTestId('fc-legend-spread')).toBeVisible()
    // Logarithmic scale.
    await radio(page, 'Skala', 'Logarytmiczna').click()
    await expect(radio(page, 'Skala', 'Logarytmiczna')).toHaveAttribute('aria-checked', 'true')
    await page.getByTestId('fc-chart').scrollIntoViewIfNeeded()
    await page.screenshot({ path: shots('57-prognoza-wykres-rozrzut') })
    // Another number of runs makes the result stale as well; back at 200 it is current again.
    await radio(page, 'Liczba przebiegów', '1000').click()
    await expect(page.getByTestId('fc-mc-stale')).toBeVisible()
    await radio(page, 'Liczba przebiegów', '200').click()
    await expect(page.getByTestId('fc-mc-stale')).toHaveCount(0)
    // A changed scenario marks the result as stale.
    await fill(page, 'fc-pct-hi', '12')
    await expect(page.getByTestId('fc-mc-stale')).toHaveText('nieaktualny — policz ponownie')
    await expect(page.getByTestId('fc-legend-spread')).toHaveCount(0)
    // The compared scenario is a dashed line with its name in the legend.
    await page.getByTestId('fc-duplicate').click()
    await page.getByTestId('fc-compare').selectOption({ label: 'Scenariusz 1' })
    await expect(page.getByTestId('fc-legend-compare')).toHaveText('Scenariusz 1')
    // Capital 0 in a month: the logarithmic scale is disabled (with a hint) and the chart goes back to linear.
    await fill(page, 'fc-start', '0')
    await expect(radio(page, 'Skala', 'Logarytmiczna')).toBeDisabled()
    await expect(radio(page, 'Skala', 'Logarytmiczna')).toHaveAttribute('title', /większy od zera/)
    await expect(radio(page, 'Skala', 'Liniowa')).toHaveAttribute('aria-checked', 'true')
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})

/** Replace the "Zapisz jako" dialog (like tests/e2e/stage4.spec.ts). */
async function stubSaveDialog(app: ElectronApplication, save: string): Promise<void> {
  await app.evaluate(({ dialog }, path) => {
    const d = dialog as unknown as Record<string, unknown>
    d.showSaveDialog = async (_w: unknown, opts: { defaultPath?: string }) => ({ canceled: false, filePath: path.replace('{name}', opts?.defaultPath ?? 'plik') })
  }, save)
}

test('prognoza: eksport CSV (zawartość) i XLSX (plik ZIP), kopiowanie tabeli', async () => {
  const { app, page, errors } = await launch()
  const out = await fs.mkdtemp(join(tmpdir(), 'ictj-fc-out-'))
  try {
    await firstScenarioLikeT1(page)
    await stubSaveDialog(app, join(out, '{name}'))
    // CSV: semicolons, BOM, CRLF, decimal comma; name prognoza-<slug>-<date>.csv
    await page.getByTestId('fc-csv').click()
    await expect.poll(async () => (await fs.readdir(out)).filter((n) => n.endsWith('.csv')).length, { timeout: 8000 }).toBe(1)
    const csvName = (await fs.readdir(out)).find((n) => n.endsWith('.csv'))!
    expect(csvName).toMatch(/^prognoza-scenariusz-1-\d{4}-\d{2}-\d{2}\.csv$/)
    const csv = await fs.readFile(join(out, csvName), 'utf8')
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    const lines = csv.slice(1).split('\r\n')
    expect(lines[0]).toBe('Nr miesiąca;Miesiąc;Zwrot [%];Wpłata;Kapitał na początku;Zysk;Wypłata (10%);Odłożona gotówka;Cel zakupowy;Kwota na cel;Kapitał na koniec')
    expect(lines[1]).toBe('1;11-2026;11,0000;0,00;10000,00;1100,00;110,00;110,00;;;10990,00')
    expect(lines[6]).toBe('6;4-2027;11,0000;2000,00;28217,94;3103,97;310,40;0,00;Cel 1;1223,50;31011,52')
    expect(lines[50]).toMatch(/;3365620,22$/)
    // XLSX: a ZIP file with the workbook.
    await page.getByTestId('fc-xlsx').click()
    await expect.poll(async () => (await fs.readdir(out)).filter((n) => n.endsWith('.xlsx')).length, { timeout: 8000 }).toBe(1)
    const xlsx = await fs.readFile(join(out, (await fs.readdir(out)).find((n) => n.endsWith('.xlsx'))!))
    expect(xlsx.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
    expect(xlsx.includes(Buffer.from('xl/worksheets/sheet4.xml'))).toBe(true)
    // Copy: TSV in the clipboard.
    await page.getByTestId('fc-copy').click()
    await expect(page.getByText('Skopiowano. Wklej w Excelu (Ctrl+V).')).toBeVisible()
    const text = await app.evaluate(({ clipboard }) => clipboard.readText())
    expect(text.split('\r\n')[1]).toBe('1\t11-2026\t11,0000\t0,00\t10000,00\t1100,00\t110,00\t110,00\t\t\t10990,00')
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})
