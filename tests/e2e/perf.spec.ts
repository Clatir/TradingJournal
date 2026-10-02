import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, test } from '@playwright/test'
import { DataStore } from '../../src/main/datastore/store'
import { createDefaultJournal, createTrade } from '../../src/shared/defaults'
import { serializeRecord } from '../../src/shared/records'
import { tradeRelPath } from '../../src/shared/paths'
import { launch } from './app'

test('5000 transakcji: start, dziennik i analityka bez zacięć', async () => {
  const root = join(await fs.mkdtemp(join(tmpdir(), 'ictj-perf-')), 'Dziennik')
  const journal = createDefaultJournal()
  await DataStore.initialize(root, journal)
  const models = journal.dictionaries.entryModels
  const base = Date.UTC(2023, 0, 2, 7, 0)
  const writes: Array<Promise<void>> = []
  for (let i = 0; i < 5000; i++) {
    const entry = 1.08 + (i % 50) * 0.0003
    const win = i % 5 < 2
    const t = createTrade({
      pair: ['EURUSD', 'AUDUSD', 'EURGBP', 'USDCHF', 'EURAUD'][i % 5]!,
      direction: i % 2 ? 'long' : 'short',
      entryTime: new Date(base + i * 4 * 3600_000).toISOString(),
      entryModelId: models[i % models.length]!.id,
      prices: { entry, stopLoss: entry - (i % 2 ? 1 : -1) * 0.0012, takeProfit1: entry + (i % 2 ? 1 : -1) * 0.0026, takeProfit2: null },
      exits: [{ id: '01K6H3Z0W8Q4M2N5P7R9S1T3V5', time: null, price: win ? entry + (i % 2 ? 1 : -1) * 0.0026 : entry - (i % 2 ? 1 : -1) * 0.0012, percent: 100, note: '' }],
      notes: `Transakcja ${i}: sweep, MSS, FVG.`
    })
    const rel = tradeRelPath(t)
    writes.push(fs.mkdir(join(root, rel, '..'), { recursive: true }).then(() => fs.writeFile(join(root, rel), serializeRecord('trades', t, { settings: journal.settings }))))
  }
  await Promise.all(writes)

  const t0 = Date.now()
  const { app, page, errors } = await launch({ dataDir: root })
  try {
    await expect(page.getByTestId('journal-row').first()).toBeVisible({ timeout: 30_000 })
    const startMs = Date.now() - t0
    // The virtualized table renders only visible rows.
    const rendered = await page.getByTestId('journal-row').count()
    const t1 = Date.now()
    await page.getByTestId('journal-search').fill('EURUSD')
    await expect(page.getByTestId('journal-row').first()).toBeVisible()
    const searchMs = Date.now() - t1
    const t2 = Date.now()
    await page.keyboard.press('Control+3')
    await expect(page.getByTestId('kpis')).toContainText('5000', { timeout: 20_000 })
    await expect(page.getByTestId('equity-chart').locator('canvas').first()).toBeVisible()
    const analyticsMs = Date.now() - t2
    console.log(`5000 transakcji: start→lista ${startMs} ms (wiersze w DOM: ${rendered}), wyszukiwanie ${searchMs} ms, analityka ${analyticsMs} ms`)
    expect(rendered).toBeLessThan(120)
    expect(analyticsMs).toBeLessThan(5000)
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})
