import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launch } from './app'

const shots = (name: string) => join('test-results', 'screens', `${name}.png`)

test('dane przykładowe w osobnym folderze + analityka', async () => {
  const { app, page, dataDir, userData, errors } = await launch()
  try {
    await expect(page.getByTestId('journal-table')).toBeVisible()
    await page.getByTestId('nav-settings').click()
    const t0 = Date.now()
    await page.getByTestId('enter-sample').click()
    await expect(page.getByTestId('demo-badge')).toBeVisible({ timeout: 60_000 })
    await expect(page.getByTestId('analytics')).toBeVisible({ timeout: 60_000 })
    await expect(page.getByTestId('kpis')).toContainText('27', { timeout: 30_000 })
    console.log(`dane przykładowe gotowe po ${Date.now() - t0} ms`)
    await expect(page.getByTestId('equity-chart').locator('canvas').first()).toBeVisible()
    await expect(page.getByTestId('compliance-matrix')).toBeVisible()
    await expect(page.getByTestId('calendar-heatmap')).toBeVisible()
    await page.waitForTimeout(400)
    await page.screenshot({ path: shots('21-analityka'), fullPage: false })
    await page.getByTestId('analytics').locator('.overflow-y-auto').first().evaluate((el) => el.scrollTo(0, 2000))
    await page.waitForTimeout(200)
    await page.screenshot({ path: shots('22-analityka-dol') })

    // Demo lives under userData, the real folder stays empty.
    const sampleTrades = await fs.readdir(join(userData, 'sample-journal', 'trades')).catch(() => [])
    expect(sampleTrades.length).toBeGreaterThan(0)
    expect(await fs.readdir(join(dataDir, 'trades'))).toEqual([])

    await page.getByTestId('nav-journal').click()
    await expect(page.getByTestId('journal-row').first()).toBeVisible()
    await page.screenshot({ path: shots('23-dziennik-demo') })

    // Leave demo mode.
    await page.getByTestId('nav-settings').click()
    await page.getByTestId('exit-sample').click()
    await expect(page.getByTestId('demo-badge')).toHaveCount(0)
    await expect(page.getByText('Dziennik jest pusty.')).toBeVisible()
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})
