import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { launch } from './app'

const panel = (page: Page, title: string) => page.locator('section', { has: page.locator('h2', { hasText: title }) })

async function settingsTab(page: Page, id: string) {
  await page.keyboard.press('Control+,')
  await page.getByTestId(`settings-tab-${id}`).click()
}

test('ustawienia: wszystkie opcje przyjmują poprawne wartości i odrzucają niepoprawne', async () => {
  test.setTimeout(120_000)
  const { app, page, dataDir, errors } = await launch()
  const journal = async () => JSON.parse(await fs.readFile(join(dataDir, 'journal.json'), 'utf8')) as any
  try {
    await expect(page.getByTestId('journal-table')).toBeVisible()

    // Pairs: lower case is normalised, duplicates and bad symbols are refused, JPY gets pip 0.01.
    await settingsTab(page, 'pairs')
    const pairs = panel(page, 'Pary walutowe')
    const addPair = async (sym: string, quote: string) => {
      await pairs.getByPlaceholder('np. GBPUSD', { exact: true }).fill(sym)
      await pairs.getByPlaceholder('USD', { exact: true }).fill(quote)
      await pairs.getByRole('button', { name: 'Dodaj parę' }).click()
    }
    await addPair('gbpusd', 'usd')
    await addPair('GBPUSD', 'USD')
    await expect(page.getByText('Ta para już jest na liście.')).toBeVisible()
    await addPair('AB', 'USD')
    await expect(page.getByText('Symbol: 3–12 wielkich liter/cyfr, np. GBPUSD.')).toBeVisible()
    await addPair('USDJPY', 'JPY')
    await expect
      .poll(async () => (await journal()).settings.pairs.filter((p: any) => ['GBPUSD', 'USDJPY'].includes(p.symbol)).map((p: any) => `${p.symbol}:${p.pipSize}:${p.quoteCurrency}`))
      .toEqual(['GBPUSD:0.0001:USD', 'USDJPY:0.01:JPY'])
    const pip = pairs.locator('input.num.text-right').first()
    await pip.fill('0')
    await pip.press('Tab')
    await expect(pip).toHaveValue('0.0001')

    // Killzones: times are parsed, nonsense is refused, an empty window is flagged, names can be retyped.
    await settingsTab(page, 'killzones')
    const kz = panel(page, "Killzone'y")
    const clocks = kz.locator('input.num.text-center')
    await clocks.nth(0).fill('2:30')
    await clocks.nth(0).press('Enter')
    await expect(clocks.nth(0)).toHaveValue('02:30')
    await clocks.nth(0).fill('25:99')
    await clocks.nth(0).press('Enter')
    await expect(clocks.nth(0)).toHaveValue('02:30')
    await clocks.nth(0).fill('0200')
    await clocks.nth(0).press('Enter')
    await expect(clocks.nth(0)).toHaveValue('02:00')
    await kz.getByRole('button', { name: 'Dodaj' }).click()
    const count = await clocks.count()
    await clocks.nth(count - 2).fill('10:00')
    await clocks.nth(count - 2).press('Enter')
    await clocks.nth(count - 1).fill('10:00')
    await clocks.nth(count - 1).press('Enter')
    await expect(page.getByTestId('kz-empty-warning')).toContainText('„Nowa”: początek = koniec (10:00)')
    const name = kz.getByRole('textbox', { name: 'Nazwa killzone' }).last()
    await name.fill('')
    await name.press('Enter')
    await expect(name).toHaveValue('Nowa') // an empty name keeps the old one
    await name.fill('Asia')
    await name.press('Enter')
    await expect(page.getByTestId('kz-empty-warning')).toContainText('„Asia”')
    await clocks.nth(count - 2).fill('20:00')
    await clocks.nth(count - 2).press('Enter')
    await expect(page.getByTestId('kz-empty-warning')).toHaveCount(0)

    // Rules: every switch toggles, a zero threshold is ignored, a decimal comma works.
    await settingsTab(page, 'rules')
    const rules = panel(page, 'Zasady')
    const switches = rules.getByRole('switch')
    await expect(switches).toHaveCount(6)
    for (let i = 0; i < 6; i++) await switches.nth(i).click()
    for (let i = 0; i < 6; i++) await expect(switches.nth(i)).toHaveAttribute('aria-checked', 'false')
    for (let i = 0; i < 6; i++) await switches.nth(i).click()
    const maxSl = rules.locator('input').first()
    await maxSl.fill('0')
    await maxSl.press('Tab')
    await expect(maxSl).toHaveValue('20.0')
    await maxSl.fill('12,5')
    await maxSl.press('Tab')
    await expect(maxSl).toHaveValue('12.5')
    await rules.getByRole('radio', { name: 'H4', exact: true }).click()

    // Dictionaries: duplicates are refused when adding and when renaming.
    await settingsTab(page, 'dictionaries')
    const models = panel(page, 'Modele wejścia')
    const add = models.getByPlaceholder('np. Sweep → MSS → FVG')
    await add.fill('turtle SOUP')
    await add.press('Enter')
    await expect(page.getByText('Taka pozycja już istnieje.')).toBeVisible()
    await add.fill('Judas Swing')
    await add.press('Enter')
    const first = models.getByRole('textbox', { name: 'Modele wejścia' }).first()
    const original = await first.inputValue()
    await first.fill('Judas swing')
    await first.press('Enter')
    await expect(page.getByText('„Judas swing” już jest na liście.')).toBeVisible()
    await expect(first).toHaveValue(original)
    await first.fill('Sweep → MSS → FVG (M5)')
    await first.press('Enter')
    const tfs = panel(page, 'Interwały')
    await tfs.locator('input').fill('m30')
    await tfs.getByRole('button', { name: 'Dodaj' }).click()
    await tfs.locator('input').fill('M30')
    await tfs.getByRole('button', { name: 'Dodaj' }).click()
    await expect(tfs.getByRole('button', { name: 'Usuń M30' })).toHaveCount(1)

    // Screens: every compression mode can be chosen.
    await settingsTab(page, 'screens')
    for (const mode of ['Stratny', 'Bezstratnie', 'Auto (zalecane)']) {
      await page.getByRole('radio', { name: mode, exact: true }).click()
      await expect(page.getByRole('radio', { name: mode, exact: true })).toHaveAttribute('aria-checked', 'true')
    }

    // Risk: invalid currency, zero contract and zero lot step are refused; a finer lot step shows more decimals.
    await settingsTab(page, 'display')
    const currency = page.getByTestId('risk-currency')
    await currency.fill('us')
    await currency.press('Tab')
    await expect(currency).toHaveValue('USD')
    const contract = panel(page, 'Ryzyko').locator('input').nth(2)
    await contract.fill('0')
    await contract.press('Tab')
    await expect(contract).toHaveValue('100000')
    await page.getByTestId('risk-lot-step').fill('0')
    await page.getByTestId('risk-lot-step').press('Tab')
    await expect(page.getByTestId('risk-lot-step')).toHaveValue('0.01')
    await page.getByTestId('risk-lot-step').fill('0.001')
    await page.getByTestId('risk-lot-step').press('Tab')

    await page.keyboard.press('Control+6')
    await page.getByTestId('calc-balance').fill('10000')
    await page.getByTestId('calc-risk').fill('0.37')
    await page.getByTestId('calc-sl').fill('13')
    await expect(page.getByTestId('calc-lots')).toHaveText('0.284')

    // Account currency: rates are kept per currency, never reinterpreted.
    await page.getByTestId('pnl').getByRole('radio', { name: 'EURGBP', exact: true }).click()
    await page.getByTestId('pnl-rate').fill('1.35')
    await page.getByTestId('pnl-lots').fill('0.1')
    await page.getByTestId('pnl-pips').fill('10')
    await expect(page.getByTestId('pnl-amount')).toHaveText('+13.50 USD')
    await settingsTab(page, 'display')
    await currency.fill('pln')
    await currency.press('Tab')
    await expect(page.getByText(/Waluta konta: PLN/)).toBeVisible()
    await page.keyboard.press('Control+6')
    await expect(page.getByTestId('pnl-missing')).toHaveText('Wpisz kurs GBP → PLN albo wartość pipsa.')
    await page.getByTestId('pnl-rate').fill('4.95')
    await expect(page.getByTestId('pnl-amount')).toHaveText('+49.50 PLN')
    await settingsTab(page, 'display')
    await currency.fill('USD')
    await currency.press('Tab')
    await page.keyboard.press('Control+6')
    await expect(page.getByTestId('pnl-amount')).toHaveText('+13.50 USD')

    // Trade editor: lots with the finer step are kept as typed.
    await page.keyboard.press('Control+n')
    await expect(page.getByTestId('trade-editor')).toBeVisible()
    const lots = page.getByTestId('trade-editor').locator('div', { has: page.getByText('Loty', { exact: true }) }).locator('input').last()
    await lots.fill('0.123')
    await lots.press('Tab')
    await expect(lots).toHaveValue('0.123')

    // Every screen opens without errors with these settings.
    for (const key of ['Control+1', 'Control+2', 'Control+3', 'Control+4', 'Control+5', 'Control+6']) {
      await page.keyboard.press(key)
      await page.waitForTimeout(150)
    }
    await expect
      .poll(async () => {
        const j = await journal()
        return [j.settings.rules.maxStopPips.value, j.settings.rules.htfBias.timeframe, j.settings.risk.lotStep, j.settings.screens.mode, j.dictionaries.entryModels[0].name]
      })
      .toEqual([12.5, 'H4', 0.001, 'auto', 'Sweep → MSS → FVG (M5)'])
    const risk = (await journal()).settings.risk
    expect(risk.conversionRates).toEqual({ GBP: 1.35 })
    expect(risk.byAccountCurrency).toEqual({ PLN: { conversionRates: { GBP: 4.95 }, pipValuesPerLot: {} } })
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})

test('kursy NBP: pobieranie z lokalnego serwera, kurs w kalkulatorach, kurs ręczny i powrót do NBP', async () => {
  test.setTimeout(120_000)
  const { createServer } = await import('node:http')
  let mode: 'ok' | 'error' = 'ok'
  let requests = 0
  const table = [
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
  const server = createServer((_req, res) => {
    requests++
    if (mode === 'error') res.writeHead(500).end()
    else res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(table))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as { port: number }).port
  const { app, page, dataDir, errors } = await launch({ env: { ICTJ_NBP_URL: `http://127.0.0.1:${port}`, ICTJ_NBP_FETCH_DELAY_MS: '300' } })
  const journal = async () => JSON.parse(await fs.readFile(join(dataDir, 'journal.json'), 'utf8')) as any
  try {
    await expect(page.getByTestId('journal-table')).toBeVisible()
    // Fetched automatically shortly after start (the journal had no table yet).
    await expect.poll(async () => (await journal()).settings.fx.nbp?.no ?? null, { timeout: 15_000 }).toBe('192/A/NBP/2026')
    expect(requests).toBe(1)
    await settingsTab(page, 'display')
    await expect(page.getByTestId('fx-nbp-info')).toContainText('Tabela A NBP nr 192/A/NBP/2026 z dnia 2026-10-02')
    await page.getByTestId('fx-panel').scrollIntoViewIfNeeded()
    await page.screenshot({ path: join('test-results', 'screens', '49-kursy-walut.png') })

    // Account in PLN: EURUSD pip value 0.10 USD × 3.8881 from the table.
    const currency = page.getByTestId('risk-currency')
    await currency.fill('PLN')
    await currency.press('Tab')
    await page.keyboard.press('Control+6')
    await page.getByTestId('pnl').getByRole('radio', { name: 'EURUSD', exact: true }).click()
    const rate = page.getByTestId('pnl-rate')
    await expect(rate).toHaveValue('3.8881')
    await expect(page.getByTestId('pnl').getByText('kurs NBP z dnia 2026-10-02 — możesz wpisać własny')).toBeVisible()
    await page.getByTestId('pnl-lots').fill('0.5')
    await page.getByTestId('pnl-pips').fill('20')
    await expect(page.getByTestId('pnl-amount')).toHaveText('+388.81 PLN')
    // The position calculator uses the same rate.
    await expect(page.getByTestId('calc-rate')).toHaveValue('3.8881')

    // A typed rate wins until "przywróć kurs NBP".
    await rate.fill('4')
    await expect(page.getByTestId('pnl-amount')).toHaveText('+400.00 PLN')
    await page.getByTestId('pnl-lots').click()
    await expect(page.getByTestId('pnl').getByText('kurs wpisany ręcznie')).toBeVisible()
    await expect.poll(async () => (await journal()).settings.risk.conversionRates).toEqual({ USD: 4 })
    await page.screenshot({ path: join('test-results', 'screens', '47-kurs-nbp-reczny.png') })
    await page.getByTestId('pnl-rate-nbp').click()
    await expect(rate).toHaveValue('3.8881')
    await expect(page.getByTestId('pnl-amount')).toHaveText('+388.81 PLN')
    await expect.poll(async () => (await journal()).settings.risk.conversionRates).toEqual({})

    // Nothing typed by hand is left in the settings list.
    await settingsTab(page, 'display')
    await expect(page.getByTestId('fx-panel')).toContainText('Brak – wszystkie kursy pochodzą z tabeli NBP.')

    // Manual refresh: same table → "aktualne"; server error → message, the old table stays.
    await page.getByTestId('fx-refresh').click()
    await expect(page.getByText('Kursy NBP są aktualne: tabela 192/A/NBP/2026 z dnia 2026-10-02.')).toBeVisible()
    mode = 'error'
    await page.getByTestId('fx-refresh').click()
    await expect(page.getByText('Nie udało się pobrać kursów NBP: serwer NBP odpowiedział błędem 500. Zostają kursy z dnia 2026-10-02.')).toBeVisible()
    expect((await journal()).settings.fx.nbp.no).toBe('192/A/NBP/2026')

    // Switching the automatic fetch off is saved.
    await page.getByTestId('fx-auto').getByRole('switch').click()
    await expect.poll(async () => (await journal()).settings.fx.autoFetch).toBe(false)
    expect(errors).toEqual([])
  } finally {
    await app.close()
    server.close()
  }
})

test('kalkulator w PLN: kwoty po kursie NBP (konto w USD), wartość pipsa z tabeli; bez sieci ostatnia tabela', async () => {
  test.setTimeout(120_000)
  const { createServer } = await import('node:http')
  let mode: 'ok' | 'error' = 'ok'
  const table = [
    { table: 'A', no: '192/A/NBP/2026', effectiveDate: '2026-10-02', rates: [{ currency: 'dolar amerykański', code: 'USD', mid: 3.8881 }, { currency: 'euro', code: 'EUR', mid: 4.3745 }] }
  ]
  const server = createServer((_req, res) => {
    if (mode === 'error') res.writeHead(500).end()
    else res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(table))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const env = { ICTJ_NBP_URL: `http://127.0.0.1:${(server.address() as { port: number }).port}`, ICTJ_NBP_FETCH_DELAY_MS: '300' }
  const first = await launch({ env })
  const journal = async () => JSON.parse(await fs.readFile(join(first.dataDir, 'journal.json'), 'utf8')) as any
  /** 1 % of 38 881 PLN with SL 20 pips: pip of 1 lot = 10 USD × 3.8881 = 38.88 PLN → 388.81 / 777.62 = 0.50 lota. */
  const expectPlnResult = async (page: Page) => {
    await page.getByTestId('calc-risk').fill('1')
    await page.getByTestId('calc-sl').fill('20')
    await expect(page.getByTestId('calc-lots')).toHaveText('0.50')
    await expect(page.getByTestId('calc-pip-value')).toContainText('38.88 PLN')
    await expect(page.getByTestId('calc-pip-value-source')).toHaveText('kurs USD/PLN 3.8881 (NBP 2026-10-02)')
  }
  try {
    const page = first.page
    await expect(page.getByTestId('journal-table')).toBeVisible()
    await expect.poll(async () => (await journal()).settings.fx.nbp?.no ?? null, { timeout: 15_000 }).toBe('192/A/NBP/2026')
    // A trade with a risk of 50 USD (the account is in USD): 2R at TP1 = +100 USD.
    await page.keyboard.press('Control+n')
    await page.getByTestId('price-entry').fill('1.0850')
    await page.getByTestId('price-sl').fill('1.0835')
    await page.getByTestId('price-tp1').fill('1.0880')
    await page.getByTestId('quick-TP1').click()
    await page.keyboard.press('Control+Shift+4') // amounts visible
    await page.getByTestId('trade-risk-amount').fill('50')
    await expect(page.getByTestId('result-money')).toHaveText('+100.00 USD')
    // The calculator works in PLN although the account is in USD; the capital is typed in PLN.
    await page.keyboard.press('Control+6')
    await expect(page.getByTestId('calc-currency')).toHaveValue('PLN')
    await page.getByTestId('calc-balance').fill('38881')
    await page.getByTestId('calc-balance').press('Tab')
    await expect(page.getByTestId('calc-currency-hint')).toHaveText('waluta kalkulatora; konto w USD: 10\u00a0000.00 USD · kurs 3.8881 (NBP 2026-10-02)')
    await expectPlnResult(page)
    // A typed rate far from NBP is flagged (and can be put back).
    await page.getByTestId('calc-rate').fill('4.2')
    await page.getByTestId('calc-rate').press('Tab')
    await expect(page.getByTestId('calc-rate-stale')).toContainText('odbiega od NBP (3.8881) o +8.0%')
    await page.getByTestId('calc-rate-nbp').click()
    await expect(page.getByTestId('calc-rate')).toHaveValue('3.8881')
    await expect(page.getByTestId('calc-rate-stale')).toHaveCount(0)
    // The P/L calculator and the partials are in PLN as well (EURUSD: 0.10 USD × 3.8881 per pip of 0.01 lota).
    await page.getByTestId('pnl').getByRole('radio', { name: 'EURUSD', exact: true }).click()
    await page.getByTestId('pnl-lots').fill('0.5')
    await page.getByTestId('pnl-pips').fill('20')
    await expect(page.getByTestId('pnl-amount')).toHaveText('+388.81 PLN')
    await expect(page.getByTestId('pnl-pip-value')).toHaveValue('0.38881')
    await page.getByTestId('part-lots').fill('1')
    await page.getByTestId('part-sl').fill('20')
    await page.getByTestId('part-now').fill('30')
    await expect(page.getByTestId('part-close-now')).toHaveText('+1166.43 PLN')
    await page.screenshot({ path: join('test-results', 'screens', '48-kalkulator-pln.png') })
    await expect.poll(async () => (await journal()).settings.risk).toMatchObject({ accountCurrency: 'USD', accountBalance: 10000, calcCurrency: 'PLN' })
    // The account itself in PLN (settings): the balance follows at the NBP rate; the trade keeps its USD amounts.
    await page.keyboard.press('Control+,')
    await page.getByTestId('settings-tab-display').click()
    await page.getByTestId('risk-currency').fill('PLN')
    await page.getByTestId('risk-currency').press('Tab')
    await expect(page.getByText(/Kapitał przeliczony: 10\s000\.00 USD → 38\s881\.00 PLN \(kurs 3\.8881 NBP\)/)).toBeVisible()
    await expect.poll(async () => (await journal()).settings.risk).toMatchObject({ accountCurrency: 'PLN', accountBalance: 38881, legacyAmountCurrency: 'USD' })
    await page.keyboard.press('Control+1')
    await page.getByTestId('journal-row').first().dblclick()
    await expect(page.getByTestId('result-money')).toHaveText('+100.00 USD ≈ +388.81 PLN')
    // Amounts typed in the wrong currency: the currency of the trade's amounts can be changed (no conversion).
    await expect(page.getByTestId('trade-amount-currency')).toHaveValue('USD')
    await page.getByTestId('trade-amount-currency').fill('PLN')
    await page.getByTestId('trade-amount-currency').press('Tab')
    await expect(page.getByTestId('result-money')).toHaveText('+100.00 PLN')
    expect(first.errors).toEqual([])
  } finally {
    await first.app.close()
  }
  // Offline: the server fails, the calculator keeps computing with the last fetched table.
  mode = 'error'
  const second = await launch({ dataDir: first.dataDir, userData: first.userData, env })
  try {
    const page = second.page
    await expect(page.getByTestId('journal-table')).toBeVisible()
    await page.keyboard.press('Control+,')
    await page.getByTestId('settings-tab-display').click()
    await page.getByTestId('fx-refresh').click()
    await expect(page.getByText('Nie udało się pobrać kursów NBP: serwer NBP odpowiedział błędem 500. Zostają kursy z dnia 2026-10-02.')).toBeVisible()
    await page.keyboard.press('Control+6')
    await expect(page.getByTestId('calc-currency')).toHaveValue('PLN')
    await expectPlnResult(page)
    expect(second.errors).toEqual([])
  } finally {
    await second.app.close()
    server.close()
  }
})
