import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launch } from './app'

const shots = (name: string) => join('test-results', 'screens', `${name}.png`)

test('kalkulator zysku / straty: pary, WTI i instrument własny', async () => {
  const { app, page, dataDir, errors } = await launch()
  try {
    await expect(page.getByTestId('journal-table')).toBeVisible()
    await page.keyboard.press('Control+6')
    await expect(page.getByTestId('pnl')).toBeVisible()
    const amount = page.getByTestId('pnl-amount')
    const instrument = (name: string) => page.getByTestId('pnl').getByRole('radio', { name, exact: true }).click()

    // EURUSD: 0.10 USD per pip for 0.01 lot → 0.5 lot × 20 pips = 100 USD.
    await instrument('EURUSD')
    await expect(page.getByTestId('pnl-pip-value')).toHaveValue('0.1')
    await page.getByTestId('pnl-lots').fill('0.5')
    await page.getByTestId('pnl-pips').fill('20')
    await expect(amount).toHaveText('+100.00 USD')
    await expect(page.getByTestId('pnl-pip-position')).toHaveText('5.0000 USD')

    // A negative number of pips (or the toggle) means a loss.
    await page.getByTestId('pnl-pips').fill('-20')
    await expect(amount).toHaveText('−100.00 USD')
    await page.getByRole('radio', { name: 'Zysk', exact: true }).click()
    await expect(amount).toHaveText('+100.00 USD')

    // AUDUSD behaves like EURUSD for a USD account.
    await instrument('AUDUSD')
    await expect(amount).toHaveText('+100.00 USD')

    // EURGBP needs the GBP → USD rate: 0.1 lot × 10 pips × 0.135 = 13.50 USD.
    await instrument('EURGBP')
    await expect(page.getByTestId('pnl-missing')).toContainText('GBP → USD')
    await page.getByTestId('pnl-rate').fill('1.35')
    await page.getByTestId('pnl-lots').fill('0.1')
    await page.getByTestId('pnl-pips').fill('10')
    await expect(amount).toHaveText('+13.50 USD')

    // EURAUD with the AUD → USD rate.
    await instrument('EURAUD')
    await page.getByTestId('pnl-rate').fill('0.66')
    await expect(amount).toHaveText('+6.60 USD')

    // WTI: 1 lot × 30 pips (0.30 USD per barrel) × 1000 barrels = 300 USD.
    await instrument('WTI')
    await page.getByTestId('pnl-lots').fill('1')
    await page.getByTestId('pnl-pips').fill('30')
    await expect(amount).toHaveText('+300.00 USD')
    // A broker with 100 barrels per lot: own pip value, remembered in the journal settings.
    await page.getByTestId('pnl-pip-value').fill('0.01')
    await expect(amount).toHaveText('+30.00 USD')
    await page.getByTestId('pnl-pip-reset').click()
    await expect(amount).toHaveText('+300.00 USD')

    // Own instrument: name and smallest lot in Settings → Instruments, pip value per smallest lot here.
    await instrument('Własny')
    await expect(page.getByTestId('pnl-missing')).toContainText('wartość pipsa')
    await page.getByTestId('pnl-manage').click()
    await expect(page.getByTestId('instruments')).toBeVisible()
    await page.getByTestId('inst-name-CUSTOM').fill('US30')
    await page.getByTestId('inst-name-CUSTOM').press('Enter')
    await page.getByTestId('inst-minlot-CUSTOM').fill('0.1')
    await page.getByTestId('inst-minlot-CUSTOM').press('Tab')
    await page.keyboard.press('Control+6')
    await instrument('US30')
    await page.getByTestId('pnl-pip-value').fill('0.5')
    await page.getByTestId('pnl-lots').fill('0.3')
    await page.getByTestId('pnl-pips').fill('40')
    await page.getByRole('radio', { name: 'Strata', exact: true }).click()
    await expect(amount).toHaveText('−60.00 USD')
    await page.getByTestId('pnl-pips').click()
    await page.screenshot({ path: shots('45-kalkulator-zysku-straty') })

    const journal = async () => JSON.parse(await fs.readFile(join(dataDir, 'journal.json'), 'utf8')) as { settings: { risk: Record<string, any>; instruments: any[] } }
    const settings = async () => (await journal()).settings.risk
    // Stored per 1.00 lot (0.5 per 0.1 lot = 5 per lot).
    await expect.poll(async () => (await settings()).pipValuesPerLot, { timeout: 8000 }).toEqual({ CUSTOM: 5 })
    expect((await journal()).settings.instruments.find((i) => i.id === 'CUSTOM')).toMatchObject({ name: 'US30', minLot: 0.1, pipSize: null })
    expect((await settings()).conversionRates).toEqual({ GBP: 1.35, AUD: 0.66 })
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})

test('kalkulator zysku / straty: przypadki brzegowe', async () => {
  const { app, page, errors } = await launch()
  try {
    await expect(page.getByTestId('journal-table')).toBeVisible()
    const toCalc = async () => {
      await page.keyboard.press('Control+6')
      await expect(page.getByTestId('pnl')).toBeVisible()
    }
    await toCalc()
    const amount = page.getByTestId('pnl-amount')
    const instrument = (name: string) => page.getByTestId('pnl').getByRole('radio', { name, exact: true }).click()

    // Own WTI pip value keeps its meaning when the lot step changes in the settings.
    await instrument('WTI')
    await page.getByTestId('pnl-lots').fill('1')
    await page.getByTestId('pnl-pips').fill('30')
    await page.getByTestId('pnl-pip-value').fill('0.01')
    await expect(amount).toHaveText('+30.00 USD')
    await page.keyboard.press('Control+,')
    await page.getByTestId('settings-tab-display').click()
    await page.getByTestId('risk-lot-step').fill('0.1')
    await page.getByTestId('risk-lot-step').press('Tab')
    await toCalc()
    await expect(page.getByTestId('pnl-pip-value')).toHaveValue('0.1')
    await expect(amount).toHaveText('+30.00 USD')
    await page.keyboard.press('Control+,')
    await page.getByTestId('settings-tab-display').click()
    await page.getByTestId('risk-lot-step').fill('0.01')
    await page.getByTestId('risk-lot-step').press('Tab')
    await toCalc()
    await expect(page.getByTestId('pnl-pip-value')).toHaveValue('0.01')
    await page.getByTestId('pnl-pip-reset').click()

    // What is shown is what is calculated: no hidden digits.
    await instrument('EURUSD')
    await page.getByTestId('pnl-lots').fill('0.015')
    await page.getByTestId('pnl-pips').fill('12.25')
    await page.getByTestId('pnl-pip-value').click()
    await expect(page.getByTestId('pnl-lots')).toHaveValue('0.015')
    await expect(page.getByTestId('pnl-pips')).toHaveValue('12.25')
    await expect(amount).toHaveText('+1.84 USD') // 0.15 USD × 12.25
    await expect(page.getByTestId('pnl-lot-warning')).toBeVisible()

    // Arrow keys on the pip value: clean numbers.
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    await page.getByTestId('pnl-lots').click()
    await expect(page.getByTestId('pnl-pip-value')).toHaveValue('0.13')
    await page.getByTestId('pnl-pip-reset').click()

    // Zero pips, a non-positive size, large amounts.
    await page.getByTestId('pnl-lots').fill('1')
    await page.getByTestId('pnl-pips').fill('0')
    await expect(amount).toHaveText('0.00 USD')
    await expect(page.getByTestId('pnl-kind')).toHaveText('bez zmian')
    await page.getByTestId('pnl-lots').fill('-0.5')
    await expect(page.getByTestId('pnl-missing')).toHaveText('Wielkość pozycji musi być większa od zera.')
    await page.getByTestId('pnl-lots').fill('500')
    await page.getByTestId('pnl-pips').fill('2500')
    await expect(amount).toHaveText('+12 500 000.00 USD')
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})

test('instrumenty: lista w ustawieniach, wybór w kalkulatorze, archiwizacja; kalkulator pozycji z TP', async () => {
  const { app, page, dataDir, errors } = await launch()
  const journal = async () => JSON.parse(await fs.readFile(join(dataDir, 'journal.json'), 'utf8')) as { settings: { instruments: any[] } }
  try {
    await expect(page.getByTestId('journal-table')).toBeVisible()
    await page.keyboard.press('Control+,')
    await page.getByTestId('settings-tab-instruments').click()
    const table = page.getByTestId('instruments')
    await expect(table.locator('[data-testid^="inst-row-"]')).toHaveCount(6)

    // A new instrument: id from the name, duplicates refused.
    await page.getByTestId('inst-add-name').fill('Złoto XAU')
    await page.getByTestId('inst-add').click()
    await expect(page.getByTestId('inst-row-ZLOTOXAU')).toBeVisible()
    await page.getByTestId('inst-add-name').fill('zloto xau')
    await page.getByTestId('inst-add').click()
    await expect(page.getByText('Instrument o identyfikatorze ZLOTOXAU już jest na liście.')).toBeVisible()
    await page.getByTestId('inst-add-name').fill('x')
    await page.getByTestId('inst-add').click()
    await expect(page.getByText(/co najmniej 2 litery lub cyfry/)).toBeVisible()
    // Gold: 1 pip = 0.1, 100 oz per lot, smallest lot 0.01 → 0.10 USD per pip.
    await page.getByTestId('inst-pip-ZLOTOXAU').fill('0.1')
    await page.getByTestId('inst-contract-ZLOTOXAU').fill('100')
    await page.getByTestId('inst-quote-ZLOTOXAU').fill('USD')
    await page.getByTestId('inst-quote-ZLOTOXAU').press('Tab')
    // Renaming to an existing name is refused.
    await page.getByTestId('inst-name-ZLOTOXAU').fill('WTI')
    await page.getByTestId('inst-name-ZLOTOXAU').press('Enter')
    await expect(page.getByText('„WTI” już jest na liście.')).toBeVisible()
    await expect(page.getByTestId('inst-name-ZLOTOXAU')).toHaveValue('Złoto XAU')
    await page.screenshot({ path: shots('48-instrumenty') })

    // Seven instruments → a list instead of buttons.
    await page.keyboard.press('Control+6')
    const select = page.getByTestId('pnl-instrument')
    await expect(select).toBeVisible()
    await select.selectOption('ZLOTOXAU')
    await expect(page.getByTestId('pnl-pip-value')).toHaveValue('0.1')
    await page.getByTestId('pnl-lots').fill('1')
    await page.getByTestId('pnl-pips').fill('50')
    await expect(page.getByTestId('pnl-amount')).toHaveText('+500.00 USD')

    // Archived instruments leave the selection; an archived one in use gives way to the first on the list.
    await page.keyboard.press('Control+,')
    await page.getByTestId('settings-tab-instruments').click()
    await page.getByTestId('inst-archive-EURAUD').click()
    await page.getByTestId('inst-archive-ZLOTOXAU').click()
    await page.keyboard.press('Control+6')
    await expect(page.getByTestId('pnl-instrument')).toHaveCount(0)
    await expect(page.getByTestId('pnl').getByRole('radio', { name: /Złoto/ })).toHaveCount(0)
    await expect(page.getByTestId('pnl').getByRole('radio', { name: 'EURAUD', exact: true })).toHaveCount(0)
    await expect(page.getByTestId('pnl').getByRole('radio', { name: 'AUDUSD', exact: true })).toHaveAttribute('aria-checked', 'true')
    await page.getByTestId('pnl').getByRole('radio', { name: 'EURUSD', exact: true }).click()
    await expect(page.getByTestId('pnl').getByRole('radio', { name: 'EURUSD', exact: true })).toHaveAttribute('aria-checked', 'true')

    // "Przywróć domyślne" brings archived presets back.
    await page.keyboard.press('Control+,')
    await page.getByTestId('settings-tab-instruments').click()
    await page.getByTestId('inst-restore').click()
    await expect(page.getByTestId('inst-archive-EURAUD')).toHaveText('Archiwizuj')
    await expect(page.getByTestId('inst-archive-ZLOTOXAU')).toHaveText('Przywróć')
    await expect
      .poll(async () => (await journal()).settings.instruments.map((i) => `${i.id}:${i.archived ? 1 : 0}`).join(' '), { timeout: 8000 })
      .toBe('AUDUSD:0 EURGBP:0 EURUSD:0 EURAUD:0 WTI:0 CUSTOM:0 ZLOTOXAU:1')
    expect((await journal()).settings.instruments.at(-1)).toMatchObject({ name: 'Złoto XAU', pipSize: 0.1, contractSize: 100, quoteCurrency: 'USD', minLot: null })

    // Position calculator: 10 000 USD, 1%, SL 20 pips → 0.50 lota; TP 40 pips → 200 USD, 1 : 2.00.
    await page.keyboard.press('Control+6')
    await page.getByTestId('calc-balance').fill('10000')
    await page.getByTestId('calc-risk').fill('1')
    await page.getByTestId('calc-sl').fill('20')
    await expect(page.getByTestId('calc-lots')).toHaveText('0.50')
    await expect(page.getByTestId('calc-tp-profit')).toHaveText('—')
    await expect(page.getByTestId('calc-rr')).toHaveText('—')
    await page.getByTestId('calc-tp').fill('40')
    await expect(page.getByTestId('calc-tp-profit')).toHaveText('200.00 USD')
    await expect(page.getByTestId('calc-tp-profit')).toHaveClass(/text-up/)
    await expect(page.getByTestId('calc-rr')).toHaveText('1 : 2.00')
    await page.screenshot({ path: shots('46-kalkulator-pozycji-tp') })
    // Remembered for the session.
    await page.keyboard.press('Control+1')
    await page.keyboard.press('Control+6')
    await expect(page.getByTestId('calc-tp')).toHaveValue('40.0')

    // Opened from a trade: TP from the distance entry – TP1.
    await page.keyboard.press('Control+n')
    await expect(page.getByTestId('trade-editor')).toBeVisible()
    await page.getByTestId('price-entry').fill('1.08500')
    await page.getByTestId('price-sl').fill('1.08350')
    await page.getByTestId('price-tp1').fill('1.08950')
    await page.getByTestId('open-calc').click()
    await expect(page.getByTestId('calc-sl')).toHaveValue('15.0')
    await expect(page.getByTestId('calc-tp')).toHaveValue('45.0')
    await expect(page.getByTestId('calc-rr')).toHaveText('1 : 3.00')
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})
