import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launch } from './app'

const M = '−' // minus sign of amounts and pips

test('partiale: zamknąć całość teraz czy podzielić (do 4 części), zysk / strata każdego wariantu', async () => {
  const { app, page, errors } = await launch()
  try {
    await expect(page.getByTestId('journal-table')).toBeVisible()
    await page.keyboard.press('Control+6')
    const panel = page.getByTestId('partials')
    await panel.scrollIntoViewIfNeeded()
    // EURUSD on a USD account: 10 USD per pip for 1 lot. 1 lot, SL 20, +30 now; half now, half at +60.
    await page.getByTestId('part-lots').fill('1')
    await page.getByTestId('part-sl').fill('20')
    await page.getByTestId('part-now').fill('30')
    await expect(page.getByTestId('part-close-now')).toHaveText('+300.00 USD')
    await expect(page.getByTestId('part-best')).toHaveText('+450.00 USD')
    await expect(page.getByTestId('part-worst')).toHaveText('+50.00 USD')
    await expect(page.getByTestId('part-row-1')).toContainText('0.50')
    await expect(page.getByTestId('part-row-1')).toContainText('teraz +30 pips')
    await expect(page.getByTestId('part-row-1')).toContainText('+150.00 USD')
    await expect(page.getByTestId('part-row-2')).toContainText('cel +60 pips')
    await expect(page.getByTestId('part-row-2')).toContainText('+300.00 USD')
    await expect(page.getByTestId('part-scenario-0')).toContainText(`cena wraca przed pierwszym celem – reszta na SL (${M}20 pips)`)
    await expect(page.getByTestId('part-scenario-0')).toContainText(`${M}250.00 USD`)
    await expect(page.getByTestId('part-scenario-1')).toContainText('wszystkie cele osiągnięte')
    await expect(page.getByTestId('part-scenario-1')).toContainText('+150.00 USD')
    await expect(page.getByTestId('part-verdict')).toHaveText(
      'Podział daje więcej niż zamknięcie teraz, jeśli cena dojdzie do celu +60 pips. Jeśli cena wróci przed pierwszym celem, wyjdziesz o 250.00 USD gorzej niż przy zamknięciu teraz.'
    )
    // Stop of the rest at break-even after the first partial.
    await page.getByTestId('part-be').getByRole('switch').click()
    await expect(page.getByTestId('part-worst')).toHaveText('+150.00 USD')
    await expect(page.getByTestId('part-scenario-0')).toContainText('reszta na BE')

    // Up to 4 parts: even shares, the last one takes the rest.
    await page.getByTestId('part-add').click()
    await page.getByTestId('part-add').click()
    await expect(page.getByTestId('part-add')).toHaveText('Limit: 4 partiale')
    await expect(page.getByTestId('part-add')).toBeDisabled()
    await expect(page.getByTestId('part-4-pct')).toHaveText('reszta 25%')
    await expect(page.getByTestId('part-rows').locator('tbody tr')).toHaveCount(4)
    await expect(page.getByTestId('part-scenarios').locator('tbody tr')).toHaveCount(4) // 0, 1, 2, 3 targets reached
    await page.screenshot({ path: join('test-results', 'screens', '48b-partiale.png'), fullPage: true })
    // A part switched to "Cel" gets a target field; a target not beyond now is refused with a message.
    await page.getByTestId('part-1').getByRole('radio', { name: 'Cel', exact: true }).click()
    await page.getByTestId('part-1-target').fill('25')
    await expect(page.getByTestId('part-error')).toHaveText('Cel części 1 (25 pips) nie jest dalej niż obecny wynik (30 pips) – wybierz „teraz”.')
    await page.getByTestId('part-1-del').click()
    await expect(page.getByTestId('part-rows').locator('tbody tr')).toHaveCount(3)
    await expect(page.getByTestId('part-add')).toHaveText('+ Dodaj partial')
    // Too small a position for the split.
    await page.getByTestId('part-lots').fill('0.02')
    await expect(page.getByTestId('part-error')).toContainText('Pozycja 0.02 lota jest za mała na taki podział')
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})
