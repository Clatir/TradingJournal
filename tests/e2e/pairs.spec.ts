import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { createDefaultJournal, createTrade } from '../../src/shared/defaults'
import { launch } from './app'
import { seed } from './seed'

test('ropa (OILWTI): pips 0.01, 1 lot = 1000 baryłek, własny limit SL pary; nowa para ropy z ustawieniami', async () => {
  const journal = createDefaultJournal()
  // A pair added before 1.4.5 with a forex-like scale (as in the report: SL 940 p, result 7080 p).
  journal.settings.pairs.push({ symbol: 'OILWTI', pipSize: 0.0005, priceDecimals: 5, quoteCurrency: 'USD', tvSymbol: 'FX:OILWTI', archived: false })
  const trade = createTrade({
    pair: 'OILWTI',
    direction: 'short',
    entryTime: '2026-10-06T10:15:00.000Z',
    prices: { entry: 90.37, stopLoss: 90.84, takeProfit1: 86.83, takeProfit2: null },
    exits: [{ id: '01K6H3Z0W8Q4M2N5P7R9S1T3V5', time: '2026-10-06T14:00:00.000Z', price: 86.83, percent: 100, note: '' }]
  })
  const dataDir = await seed([trade], journal)
  const { app, page, errors } = await launch({ dataDir })
  try {
    const row = page.getByTestId('journal-row').first()
    await expect(row).toContainText('940.0')
    await expect(row).toContainText('+7080.0')

    await page.getByTestId('nav-settings').click()
    await page.getByTestId('settings-tab-pairs').click()
    await expect(page.getByTestId('pair-OILWTI-oil')).toContainText('To ropa')
    await page.getByTestId('pair-OILWTI-oil-fix').click()
    await expect(page.getByTestId('pair-OILWTI-oil')).toHaveCount(0)
    await expect(page.getByTestId('pair-OILWTI-lot')).toHaveValue('1000')

    // Pips recomputed from the prices: SL 47, result +354, R unchanged; the general 20 p limit is broken.
    await page.keyboard.press('Control+1')
    await expect(row).toContainText('47.0')
    await expect(row).toContainText('+354.0')
    await expect(row).toContainText('+7.53R')
    await row.dblclick()
    await expect(page.getByText('SL 47.0 p > 20 p')).toBeVisible()

    // Own SL limit of the pair.
    await page.getByTestId('nav-settings').click()
    await page.getByTestId('settings-tab-pairs').click()
    await page.getByTestId('pair-OILWTI-maxsl').fill('60')
    await page.getByTestId('pair-OILWTI-maxsl').blur()
    await page.keyboard.press('Control+1')
    await page.getByTestId('journal-row').first().dblclick()
    await expect(page.getByText('SL 47.0 p ≤ 60 p (limit OILWTI)')).toBeVisible()

    // Position calculator: 1 lot = 1000 barrels × 0.01 = 10 USD per pip → 10 000 USD, 1%, SL 47 p = 0.21 lota.
    await page.keyboard.press('Control+6')
    await page.getByRole('combobox', { name: 'Para' }).selectOption('OILWTI')
    await page.getByTestId('calc-currency').fill('USD')
    await page.getByTestId('calc-currency').blur()
    await page.getByTestId('calc-balance').fill('10000')
    await page.getByTestId('calc-risk').fill('1')
    await page.getByTestId('calc-sl').fill('47')
    await page.getByTestId('calc-sl').blur()
    await expect(page.getByTestId('calc-lots')).toHaveText('0.21')
    await expect(page.getByText('Lot OILWTI = 1000 jednostek (ustawienie pary).')).toBeVisible()

    // A new oil pair gets the oil scale.
    await page.getByTestId('nav-settings').click()
    await page.getByTestId('settings-tab-pairs').click()
    await page.getByTestId('pair-new-symbol').fill('UKOIL')
    await page.getByTestId('pair-add').click()
    await expect(page.getByTestId('pair-UKOIL-lot')).toHaveValue('1000')
    await expect(page.getByTestId('pair-UKOIL').getByRole('textbox', { name: 'Wielkość pipsa UKOIL' })).toHaveValue('0.01')
    await expect
      .poll(async () => JSON.parse(await fs.readFile(join(dataDir, 'journal.json'), 'utf8')).settings.pairs.filter((p: { symbol: string }) => /OIL/.test(p.symbol)))
      .toMatchObject([
        { symbol: 'OILWTI', pipSize: 0.01, priceDecimals: 2, contractSize: 1000, maxStopPips: 60 },
        { symbol: 'UKOIL', pipSize: 0.01, priceDecimals: 2, contractSize: 1000, quoteCurrency: 'USD', tvSymbol: 'TVC:UKOIL' }
      ])
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})
