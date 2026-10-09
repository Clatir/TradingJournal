import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launch } from './app'
import { seed } from './seed'

const shots = (name: string) => join('test-results', 'screens', `${name}.png`)

/**
 * A synthetic TradingView chart (scripts/tv-screens.mjs, not a real account) with a Long Position tool: EURUSD long
 * 1.11827, SL 1.11503, TP 1.12807, stopped out – MAE −32.4, MFE 2.7 pips. A fixed file, so every system reads the same.
 */
const FIXTURE = join(__dirname, '../fixtures/tv/tv-00-EURUSD-long-red-stop.png')

test('screen „po” z TradingView uzupełnia MAE / MFE; okno z podglądem, pominięciem świecy wejścia i ręczną poprawką', async () => {
  const dataDir = await seed([])
  const { app, page, errors } = await launch({ dataDir })
  try {
    await expect(page.getByTestId('journal-table')).toBeVisible()
    await page.keyboard.press('Control+n')
    await expect(page.getByTestId('trade-editor')).toBeVisible()
    await page.getByTestId('price-entry').fill('1.11827')
    await page.getByTestId('price-sl').fill('1.11503')
    await page.getByTestId('price-tp1').fill('1.12807')
    await page.getByTestId('quick-SL').click()

    const png = (await fs.readFile(FIXTURE)).toString('base64')
    await app.evaluate(async ({ clipboard, ClipboardItem }, b64) => {
      const blob = new Blob([Buffer.from(b64, 'base64')], { type: 'image/png' })
      await clipboard.write([new ClipboardItem({ 'image/png': blob })])
    }, png)
    await page.getByTestId('screen-zone-after').click()
    await page.keyboard.press('Control+v')
    await expect(page.getByTestId('screen-card')).toHaveCount(1, { timeout: 20_000 })

    // Filled in the background from the saved "po" screen.
    const mae = page.getByLabel('MAE w pipsach')
    const mfe = page.getByLabel('MFE w pipsach')
    await expect(mae).not.toHaveValue('', { timeout: 60_000 })
    const num = async (l: typeof mae) => Number((await l.inputValue()).replace('−', '-'))
    expect(Math.abs((await num(mae)) - -32.4)).toBeLessThanOrEqual(0.6)
    expect(Math.abs((await num(mfe)) - 2.7)).toBeLessThanOrEqual(0.6)

    // The dialog: the same reading with the tool and both extremes marked.
    await page.getByTestId('tv-open').click()
    await expect(page.getByTestId('tv-mae')).toBeVisible({ timeout: 60_000 })
    await expect(page.getByTestId('tv-preview')).toBeVisible()
    await expect(page.getByTestId('tv-mark-mae')).toHaveCount(1)
    await expect(page.getByTestId('tv-screen-result')).toContainText('SL')
    await page.screenshot({ path: shots('80-tv-excursions') })
    // The best price for the position came in the entry candle: flagged; leaving the candle out measures again
    // without OCR.
    await expect(page.getByTestId('tv-screen-result')).toContainText('ze świecy wejścia')
    const mfeBefore = Number((await page.getByTestId('tv-mfe').textContent())!.replace('−', '-'))
    await page.getByTestId('tv-skip-entry').locator('button').click()
    await expect(page.getByTestId('tv-screen-result')).not.toContainText('ze świecy wejścia', { timeout: 30_000 })
    await expect(page.getByTestId('tv-busy')).toHaveCount(0, { timeout: 30_000 })
    expect(Number((await page.getByTestId('tv-mfe').textContent())!.replace('−', '-'))).toBeLessThanOrEqual(mfeBefore)
    // A manual correction is what gets written.
    await page.getByTestId('tv-mae-input').fill('-30')
    await page.getByTestId('tv-mae-input').press('Tab')
    await page.getByTestId('tv-apply').click()
    await expect(page.getByTestId('tv-dialog')).toHaveCount(0)
    await expect(mae).toHaveValue('-30.0')
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})
