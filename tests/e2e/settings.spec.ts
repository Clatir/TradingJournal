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
