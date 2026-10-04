import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launch } from './app'

const shots = (name: string) => join('test-results', 'screens', `tour-${name}.png`)

/** Visual tour on demo data – screenshots of every screen (uploaded as CI artifacts). */
test('wycieczka po ekranach na danych przykładowych', async () => {
  const { app, page, errors } = await launch()
  try {
    await expect(page.getByTestId('journal-table')).toBeVisible()
    await page.getByTestId('nav-settings').click()
    await page.getByTestId('enter-sample').click()
    await expect(page.getByTestId('analytics')).toBeVisible({ timeout: 60_000 })
    await expect(page.getByTestId('kpis')).toContainText('27', { timeout: 30_000 })

    await page.keyboard.press('Control+1')
    await expect(page.getByTestId('journal-row').first()).toBeVisible()
    await page.screenshot({ path: shots('1-dziennik') })

    // Open a trade that has screenshots.
    const rows = page.getByTestId('journal-row')
    const n = await rows.count()
    for (let i = 0; i < n; i++) {
      const row = rows.nth(i)
      if ((await row.textContent())?.match(/\d$/)) {
        await row.dblclick()
        break
      }
    }
    await expect(page.getByTestId('trade-editor')).toBeVisible()
    await page.waitForTimeout(300)
    await page.screenshot({ path: shots('2-transakcja') })
    const cards = page.getByTestId('screen-card')
    if ((await cards.count()) > 1) {
      await cards.first().locator('img').click()
      await page.getByTestId('compare').click()
      await expect(page.getByTestId('compare-bar')).toBeVisible()
      await page.waitForTimeout(300)
      await page.screenshot({ path: shots('3-porownanie') })
      await page.keyboard.press('Escape')
    }

    await page.getByTestId('nav-day').click()
    await page.keyboard.press('Alt+ArrowLeft')
    await page.waitForTimeout(300)
    await page.screenshot({ path: shots('4-plan-dnia') })

    await page.getByTestId('nav-library').click()
    await page.getByTestId('library-card').first().click()
    await page.waitForTimeout(300)
    await page.screenshot({ path: shots('5-biblioteka') })

    await page.getByTestId('nav-week').click()
    await page.getByTitle('Poprzedni tydzień').click()
    await page.getByTitle('Poprzedni tydzień').click()
    await page.waitForTimeout(300)
    await page.screenshot({ path: shots('6-tydzien') })

    // The demo has one forecast scenario (neutral numbers, fixed draws).
    await page.getByTestId('nav-forecast').click()
    await expect(page.getByTestId('fc-name')).toHaveValue('Scenariusz 1')
    await expect(page.getByTestId('fc-goal-3-flex').getByRole('switch')).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByTestId('fc-sum-fundGain')).toBeVisible()
    await page.waitForTimeout(300)
    await page.screenshot({ path: shots('6b-prognoza') })

    await page.getByTestId('nav-help').click()
    await expect(page.getByTestId('shortcuts')).toBeVisible()
    await page.screenshot({ path: shots('7-skroty') })
    await page.keyboard.press('Escape')
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})
