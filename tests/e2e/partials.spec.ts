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
    // Chance of the targets (default 100%): expected result and the suggestion of the more profitable choice.
    await expect(page.getByTestId('part-2-chance')).toHaveValue('100')
    await expect(page.getByTestId('part-row-2-chance')).toHaveText('100%')
    await expect(page.getByTestId('part-expected')).toHaveText('+450.00 USD')
    await expect(page.getByTestId('part-suggestion')).toContainText(
      'Bardziej opłacalny: podział na 2 partiale (50% teraz, 50% +60 pips) – oczekiwany wynik +450.00 USD, +2.25R, o 150.00 USD więcej niż zamknięcie całości teraz na +30 pips (+300.00 USD).'
    )
    // Compared with closing the whole position at the final target (+60): what the partials give up.
    await expect(page.getByTestId('part-final-amount')).toHaveText('+600.00 USD')
    await expect(page.getByTestId('part-final-cost')).toHaveText(
      'Na partialach tracisz wtedy 150.00 USD (0.75R) – tyle kosztuje wcześniejsze zamknięcie części pozycji.'
    )
    await expect(page.getByTestId('part-row-1-cost')).toHaveText(`${M}150.00 USD`)
    await expect(page.getByTestId('part-row-2-cost')).toHaveText('—')
    await expect(page.getByTestId('part-final-expected')).toContainText('trzymanie całości daje oczekiwany wynik +600.00 USD')
    await expect(page.getByTestId('part-final-expected')).toContainText('podział oczekiwany daje o 150.00 USD mniej')
    await page.getByTestId('part-2-chance').fill('50')
    await page.getByTestId('part-2-chance').blur()
    await expect(page.getByTestId('part-final-expected')).toContainText('Przy szansie 50% na +60 pips trzymanie całości daje oczekiwany wynik +200.00 USD')
    await expect(page.getByTestId('part-final-expected')).toContainText('podział oczekiwany daje o 50.00 USD więcej')
    await expect(page.getByTestId('part-scenario-0-chance')).toHaveText('50%')
    await expect(page.getByTestId('part-scenario-1-chance')).toHaveText('50%')
    await expect(page.getByTestId('part-expected')).toHaveText('+250.00 USD')
    await expect(page.getByTestId('part-suggestion')).toContainText(
      'Bardziej opłacalne: zamknięcie całości teraz na +30 pips (+300.00 USD) – podział na 2 partiale (50% teraz, 50% +60 pips) daje oczekiwany wynik +250.00 USD, +1.25R, o 50.00 USD mniej.'
    )
    await page.getByTestId('part-2-chance').fill('100')
    await page.getByTestId('part-2-chance').blur()
    await expect(page.getByTestId('part-expected')).toHaveText('+450.00 USD')
    // Optimal split: 1 lot, SL 20, +30 now, +60 with 70% → the highest expected result = everything on +60;
    // „Bez straty” = 40% now (covers the rest at SL), 60% on +60; „Strata najwyżej 0.5R” = 20% / 80%.
    await page.getByTestId('part-2-chance').fill('70')
    await page.getByTestId('part-2-chance').blur()
    const opt = page.getByTestId('part-optimal')
    await expect(opt.getByTestId('opt-target-1')).toContainText('70%')
    await expect(opt.getByTestId('opt-target-1')).toContainText('+360.00 USD')
    await expect(opt.getByTestId('opt-target-1')).toContainText('62.5%')
    await expect(opt.getByTestId('opt-part-1')).toHaveText('100% (1.00 lota) na +60 pips (szansa 70%)')
    await expect(opt.getByTestId('opt-expected')).toHaveText('+360.00 USD')
    await expect(opt.getByTestId('opt-worst')).toHaveText(`${M}200.00 USD`)
    await opt.getByRole('radiogroup', { name: 'Kryterium optymalnego podziału' }).getByRole('radio', { name: 'Bez straty' }).click()
    await expect(opt.getByTestId('opt-part-1')).toHaveText('40% (0.40 lota) teraz +30 pips')
    await expect(opt.getByTestId('opt-part-2')).toHaveText('60% (0.60 lota) na +60 pips (szansa 70%)')
    await expect(opt.getByTestId('opt-expected')).toHaveText('+336.00 USD')
    await expect(opt.getByTestId('opt-worst')).toHaveText('0.00 USD')
    await opt.getByRole('radiogroup', { name: 'Kryterium optymalnego podziału' }).getByRole('radio', { name: 'Strata najwyżej' }).click()
    await expect(opt.getByTestId('opt-maxloss')).toHaveValue('0.5')
    await expect(opt.getByTestId('opt-part-1')).toHaveText('20% (0.20 lota) teraz +30 pips')
    await expect(opt.getByTestId('opt-expected')).toHaveText('+348.00 USD')
    // Apply: the calculator takes the split (20% now, the rest on +60 with 70%).
    await opt.getByTestId('opt-apply').click()
    await expect(page.getByTestId('part-1-pct')).toHaveValue('20')
    await expect(page.getByTestId('part-2-target')).toHaveValue('60.0')
    await expect(page.getByTestId('part-2-chance')).toHaveValue('70')
    await expect(page.getByTestId('part-expected')).toHaveText('+348.00 USD')
    await expect(opt.getByTestId('opt-compare')).toContainText('tyle samo co Twój podział')
    // Back to the starting split for the checks below.
    await page.getByTestId('part-1-pct').fill('50')
    await page.getByTestId('part-1-pct').blur()
    await page.getByTestId('part-2-chance').fill('100')
    await page.getByTestId('part-2-chance').blur()
    await expect(page.getByTestId('part-expected')).toHaveText('+450.00 USD')
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
    // A farther target cannot be likelier than a nearer one: 3rd target (farther) typed 80%, the 2nd 60%.
    await page.getByTestId('part-3-chance').fill('60')
    await page.getByTestId('part-3-chance').blur()
    await page.getByTestId('part-4-chance').fill('80')
    await page.getByTestId('part-4-chance').blur()
    await expect(page.getByTestId('part-row-4-chance')).toHaveText('60%*')
    await expect(page.getByTestId('part-suggestion')).toContainText('Szansa części 4 obniżona do szansy bliższego celu')
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
