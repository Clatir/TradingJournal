import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { createDefaultJournal, createTrade } from '../../src/shared/defaults'
import type { Trade } from '../../src/shared/schema'
import { launch } from './app'
import { seed } from './seed'

const shots = (name: string) => join('test-results', 'screens', `${name}.png`)

/** A closed short with SL 10 pips and the given result in R. */
function trade(pair: string, entryTime: string, r: number, over: Partial<Trade> = {}): Trade {
  return createTrade({
    pair,
    direction: 'short',
    entryTime,
    prices: { entry: 1.1, stopLoss: 1.101, takeProfit1: null, takeProfit2: null },
    exits: [{ id: '01K6H3Z0W8Q4M2N5P7R9S1T3V5', time: entryTime, price: Number((1.1 - r * 0.001).toFixed(5)), percent: 100, note: '' }],
    ...over
  })
}

test('analityka: krzywa zarobków w PLN – kwoty w PLN i USD, szacunek z ryzyka %, pominięte bez danych', async () => {
  const journal = createDefaultJournal()
  journal.settings.risk.accountCurrency = 'PLN'
  journal.settings.risk.accountBalance = 20000
  journal.settings.fx.manual = { 'USD>PLN': 4 }
  const trades = [
    trade('EURUSD', '2026-09-01T08:00:00.000Z', 2, { pnlAmountOverride: 400, amountCurrency: 'PLN', riskPercent: 0.5 }),
    trade('AUDUSD', '2026-09-02T08:00:00.000Z', -1, { pnlAmountOverride: -50, amountCurrency: 'USD' }), // −200 PLN
    trade('EURGBP', '2026-09-03T08:00:00.000Z', 1.5, { riskPercent: 0.5 }), // ≈ +150 PLN
    trade('USDCHF', '2026-09-04T08:00:00.000Z', -1, { riskPercent: null })
  ]
  const dataDir = await seed(trades, journal)
  const { app, page, errors } = await launch({ dataDir })
  try {
    await expect(page.getByTestId('journal-row')).toHaveCount(4)
    await page.keyboard.press('Control+3')
    await expect(page.getByTestId('analytics')).toBeVisible()

    // Amounts hidden by default: one click shows them.
    await expect(page.getByTestId('pln-hidden')).toBeVisible()
    await page.getByTestId('pln-show').click()
    await expect(page.getByTestId('pln-chart')).toBeVisible()
    await expect(page.getByTestId('pln-total')).toHaveText('+350.00 PLN')
    await expect(page.getByTestId('pln-dd')).toHaveText('−200.00 PLN')
    await expect(page.getByTestId('pln-count')).toHaveText('3 z 4')
    await expect(page.getByTestId('pln-notes')).toContainText('≈ 1 z szacunku')
    await expect(page.getByTestId('pln-notes')).toContainText('1 przeliczono dzisiejszym kursem')
    await expect(page.getByTestId('pln-notes')).toContainText('Pominięto 1: 1 bez kwoty i bez danych do szacunku')
    await page.getByTestId('pln-curve').scrollIntoViewIfNeeded()
    await page.screenshot({ path: shots('73-krzywa-pln') })

    // Without estimates only exact amounts count.
    await page.getByTestId('pln-estimates').uncheck()
    await expect(page.getByTestId('pln-total')).toHaveText('+200.00 PLN')
    await expect(page.getByTestId('pln-count')).toHaveText('2 z 4')

    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})
