import { promises as fs } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
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
  await expect(page.getByTestId('fc-name')).toHaveText('Scenariusz 1')
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
    await fill(page, 'fc-lot', '0.005')
    await expect(page.getByTestId('fc-lot').locator('..').locator('..')).toContainText('Mniej niż najmniejszy lot (0.01).')
    expect(errors).toEqual([])
  } finally {
    await app.close()
    server.close()
  }
})
