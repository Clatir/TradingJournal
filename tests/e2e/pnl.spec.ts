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

    // Own instrument: name, smallest lot and pip value per smallest lot.
    await instrument('Własny')
    await expect(page.getByTestId('pnl-missing')).toContainText('wartość pipsa')
    await page.getByTestId('pnl-custom-name').fill('US30')
    await page.getByTestId('pnl-min-lot').fill('0.1')
    await page.getByTestId('pnl-pip-value').fill('0.5')
    await page.getByTestId('pnl-lots').fill('0.3')
    await page.getByTestId('pnl-pips').fill('40')
    await page.getByRole('radio', { name: 'Strata', exact: true }).click()
    await expect(amount).toHaveText('−60.00 USD')
    await page.getByTestId('pnl-pips').click()
    await page.screenshot({ path: shots('45-kalkulator-zysku-straty') })

    const settings = async () => (JSON.parse(await fs.readFile(join(dataDir, 'journal.json'), 'utf8')) as { settings: { risk: Record<string, any> } }).settings.risk
    // Stored per 1.00 lot (0.5 per 0.1 lot = 5 per lot).
    await expect.poll(async () => (await settings()).pipValuesPerLot, { timeout: 8000 }).toEqual({ CUSTOM: 5 })
    expect((await settings()).customInstrument).toEqual({ name: 'US30', minLot: 0.1 })
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
