import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, test } from '@playwright/test'
import { DataStore } from '../../src/main/datastore/store'
import { createDefaultJournal, createTrade } from '../../src/shared/defaults'
import { serializeRecord } from '../../src/shared/records'
import { tradeRelPath } from '../../src/shared/paths'
import type { JournalFile, Trade } from '../../src/shared/schema'
import { launch } from './app'

/** A closed EURUSD long with SL 10 pips and the given result in R (risk 1%). */
function closedTrade(date: string, r: number, over: Partial<Trade> = {}): Trade {
  return createTrade({
    pair: 'EURUSD',
    direction: 'long',
    entryTime: `${date}T12:00:00.000Z`,
    riskPercent: 1,
    prices: { entry: 1.08, stopLoss: 1.079, takeProfit1: 1.083, takeProfit2: null },
    exits: [{ id: '01K6H3Z0W8Q4M2N5P7R9S1T3V5', time: `${date}T15:00:00.000Z`, price: Number((1.08 + r * 0.001).toFixed(5)), percent: 100, note: '' }],
    ...over
  })
}

async function seed(trades: Trade[], journal: JournalFile = createDefaultJournal()): Promise<string> {
  const root = join(await fs.mkdtemp(join(tmpdir(), 'ictj-tools-')), 'Dziennik')
  await DataStore.initialize(root, journal)
  for (const t of trades) {
    const rel = tradeRelPath(t)
    await fs.mkdir(join(root, rel, '..'), { recursive: true })
    await fs.writeFile(join(root, rel), serializeRecord('trades', t, { settings: journal.settings }))
  }
  return root
}

test('prognoza: „Weź z moich wyników” – zwrot i miesiące stratne z dziennika', async () => {
  // January +2%, February −1%, March +3% (R × 1%).
  const dataDir = await seed([closedTrade('2026-01-15', 2), closedTrade('2026-02-16', -1), closedTrade('2026-03-16', 3)])
  const { app, page, errors } = await launch({ dataDir })
  try {
    await expect(page.getByTestId('journal-row')).toHaveCount(3)
    await page.keyboard.press('Control+7')
    await page.getByTestId('fc-create-first').click()
    await page.getByTestId('fc-history').click()
    await expect(page.getByTestId('fc-history-preview')).toContainText(
      'Z 3 miesięcy (2026-01 – 2026-03): średnio 1.33% / mies.; miesiące zyskowne 2.00% – 3.00%; stratne 33.30% miesięcy, strata 1.00% – 1.00%.'
    )
    await page.getByTestId('fc-history-apply').click()
    await expect(page.getByRole('radiogroup', { name: 'Rodzaj zwrotu' }).getByRole('radio', { name: 'Losowy z zakresu', exact: true })).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByTestId('fc-pct-lo')).toHaveValue('2')
    await expect(page.getByTestId('fc-pct-hi')).toHaveValue('3')
    await expect(page.getByTestId('fc-loss-prob')).toHaveValue('33.3')
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})

test('prognoza: „Weź z moich wyników” przy za małej liczbie miesięcy', async () => {
  const dataDir = await seed([closedTrade('2026-03-10', 1)])
  const { app, page, errors } = await launch({ dataDir })
  try {
    await expect(page.getByTestId('journal-row')).toHaveCount(1)
    await page.keyboard.press('Control+7')
    await page.getByTestId('fc-create-first').click()
    await page.getByTestId('fc-history').click()
    await expect(page.getByTestId('fc-history-preview')).toHaveText('Za mało danych: potrzeba co najmniej 3 miesięcy z zamkniętymi transakcjami (jest 1).')
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})
