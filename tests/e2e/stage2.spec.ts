import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launch } from './app'

const shots = (name: string) => join('test-results', 'screens', `${name}.png`)

test('plan dnia → bias ustawia kierunek, walidator flaguje, kalkulator liczy loty', async () => {
  const { app, page, dataDir, errors } = await launch()
  try {
    await expect(page.getByTestId('journal-table')).toBeVisible()

    // Day plan for today (NY date).
    await page.keyboard.press('Control+d')
    await expect(page.getByTestId('day-plan')).toBeVisible()
    const date = await page.getByTestId('day-date').inputValue()
    await page.getByRole('radiogroup', { name: 'Bias D' }).getByRole('radio', { name: 'Bullish' }).click()
    await page.getByTestId('bias-reason-D').fill('Displacement nad PDH, cel PWH')
    await page.getByTestId('add-news').click()
    await page.getByTestId('news-title').fill('CPI')
    await page.getByTestId('scenario-primary').fill('Sweep Asia low → MSS M15 → long z FVG')
    const dayFile = join(dataDir, 'days', date.slice(0, 4), `${date}.json`)
    await expect.poll(async () => JSON.parse(await fs.readFile(dayFile, 'utf8').catch(() => '{}')).pairs?.[0]?.bias?.D?.direction, { timeout: 8000 }).toBe('bullish')
    await page.screenshot({ path: shots('11-plan-dnia') })

    // New trade defaults to the bias direction; validator flags broken rules.
    await page.keyboard.press('Control+n')
    await expect(page.getByTestId('trade-editor')).toBeVisible()
    await expect(page.getByRole('radiogroup', { name: 'Kierunek' }).getByRole('radio', { name: 'Long' })).toHaveAttribute('aria-checked', 'true')
    await page.getByTestId('price-entry').fill('1.0850')
    await page.getByTestId('price-sl').fill('1.0825')
    await page.getByTestId('price-tp1').fill('1.0880')
    await expect(page.getByTestId('rule-maxStopPips')).toHaveAttribute('data-status', 'fail')
    await expect(page.getByTestId('rule-minRiskReward')).toHaveAttribute('data-status', 'fail')
    await expect(page.getByTestId('rule-htfBias')).toHaveAttribute('data-status', 'pass')
    await expect(page.getByTestId('rule-newsDay')).toHaveAttribute('data-status', 'info')
    await page.screenshot({ path: shots('12-walidator') })

    // Position calculator for this trade.
    await page.getByTestId('open-calc').click()
    await expect(page.getByTestId('calculator')).toBeVisible()
    await page.getByTestId('calc-balance').fill('10000')
    await page.getByTestId('calc-risk').fill('1')
    await expect(page.getByTestId('calc-sl')).toHaveValue('25.0')
    await expect(page.getByTestId('calc-lots')).toHaveText('0.40')
    await page.screenshot({ path: shots('13-kalkulator') })
    await page.getByTestId('calc-apply').click()
    await expect(page.getByTestId('trade-editor')).toBeVisible()

    const files = async () => {
      const dir = join(dataDir, 'trades', date.slice(0, 4))
      return (await fs.readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith('.json'))
    }
    await expect.poll(async () => (await files()).length, { timeout: 8000 }).toBe(1)
    const tradeFile = join(dataDir, 'trades', date.slice(0, 4), (await files())[0]!)
    await expect.poll(async () => JSON.parse(await fs.readFile(tradeFile, 'utf8')).lots, { timeout: 8000 }).toBe(0.4)
    const json = JSON.parse(await fs.readFile(tradeFile, 'utf8'))
    expect(json.computed.brokenRules.join(' ')).toMatch(/SL nie większy niż próg/)
    expect(json.riskPercent).toBe(1)

    // The journal shows the compliance score.
    await page.getByTestId('nav-journal').click()
    await expect(page.getByTestId('journal-row')).toHaveCount(1)
    await page.screenshot({ path: shots('14-dziennik-zgodnosc') })
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})
