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

test('dziennik: kolumna „Kwota” – dodanie włącza kwoty, wynik wpisany, szacunek z ryzyka %, brak z podpowiedzią, Σ kwota', async () => {
  const journal = createDefaultJournal()
  journal.settings.risk.accountCurrency = 'PLN'
  journal.settings.risk.accountBalance = 20000
  const trades = [
    trade('EURUSD', '2026-10-06T07:58:00.000Z', -0.79, { pnlAmountOverride: -7.06, amountCurrency: 'PLN', riskPercent: 0.5 }),
    trade('AUDUSD', '2026-10-05T07:39:00.000Z', 1.5, { riskPercent: 0.5 }),
    trade('EURGBP', '2026-10-05T11:54:00.000Z', -1, { riskPercent: null })
  ]
  const dataDir = await seed(trades, journal)
  const { app, page, errors } = await launch({ dataDir })
  try {
    await expect(page.getByTestId('journal-row')).toHaveCount(3)
    const row = (pair: string) => page.getByTestId('journal-row').filter({ hasText: pair })

    // Amounts are hidden by default; adding the column shows them.
    await page.getByTestId('columns-button').click()
    await page.getByRole('checkbox', { name: 'Pokaż Kwota' }).check()
    await page.keyboard.press('Escape')
    await expect(row('EURUSD').getByTestId('trade-amount')).toHaveText(/^.7\.06 PLN$/)
    await expect(row('AUDUSD').getByTestId('trade-amount')).toHaveText('≈ +150.00 PLN')
    await expect(row('AUDUSD').getByTestId('trade-amount')).toHaveAttribute('title', /Szacunek: 1\.50 R × ryzyko 0\.5% × saldo konta 20/)
    await expect(row('EURGBP').getByTestId('trade-amount')).toHaveText('—')
    await expect(row('EURGBP').getByTestId('trade-amount')).toHaveAttribute('title', /wpisz w edytorze transakcji loty, kwotę ryzyka albo wynik w kwocie/)
    await expect(page.getByTestId('journal-amount-sum')).toContainText('≈ +142.94 PLN')
    await expect(page.getByTestId('journal-amount-sum')).toContainText('(2/3)')
    await page.screenshot({ path: shots('72-dziennik-kwota') })

    // Hidden again (Ctrl+$): the header shows them with one click.
    await page.keyboard.press('Control+Shift+Digit4')
    await expect(page.getByTestId('trade-amount')).toHaveCount(0)
    await expect(page.getByTestId('journal-amount-sum')).toHaveCount(0)
    await page.getByTestId('amount-show').click()
    await expect(row('AUDUSD').getByTestId('trade-amount')).toHaveText('≈ +150.00 PLN')

    // The preview of the selected trade has the amount too.
    await row('EURUSD').click()
    await expect(page.getByText('Kwota', { exact: true }).last()).toBeVisible()

    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})
