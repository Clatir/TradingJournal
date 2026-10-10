import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { createTrade } from '../../src/shared/defaults'
import { marketStatsFor } from '../../src/shared/calc/marketStats'
import { MARKET_DIR, parseEodhdIntraday } from '../../src/shared/market'
import { startMarketServer, syntheticBars, syntheticPrice } from '../helpers/market'
import { launch } from './app'
import { readTrades, seed } from './seed'

const shots = (name: string) => join('test-results', 'screens', `${name}.png`)
const KEY = 'e2e-key-ABCD1234'

/** A closed EURUSD long on 22.09.2026 entered at the synthetic market price, 90 minutes long. */
function marketTrade(id: string, entryIso: string, over: Partial<Parameters<typeof createTrade>[0]> = {}) {
  const entrySec = Date.parse(entryIso) / 1000
  const entry = syntheticPrice('EURUSD.FOREX', Math.floor(entrySec / 60) * 60)
  const exitIso = new Date(Date.parse(entryIso) + 90 * 60_000).toISOString()
  const exit = syntheticPrice('EURUSD.FOREX', Math.floor(Date.parse(exitIso) / 60_000) * 60)
  return createTrade({
    id,
    pair: 'EURUSD',
    direction: 'long',
    status: 'closed',
    entryTime: entryIso,
    riskPercent: 1,
    prices: { entry, stopLoss: Number((entry - 0.0015).toFixed(5)), takeProfit1: Number((entry + 0.003).toFixed(5)), takeProfit2: null },
    exits: [{ id: '01K6H3Z0W8Q4M2N5P7R9S1T3V5', time: exitIso, price: exit, percent: 100, note: '' }],
    ...over
  })
}

test('dane rynkowe EODHD: klucz w ustawieniach, sprawdzenie połączenia, MAE / MFE z świec M1, wykres w edytorze, „Użyj danych rynkowych”', async () => {
  const server = await startMarketServer({ key: KEY })
  const a = marketTrade('01K6H40000000000000000000A', '2026-09-22T12:00:13.000Z')
  // MAE / MFE typed by hand: kept, the market's values shown beside them.
  const b = marketTrade('01K6H40000000000000000000B', '2026-09-22T15:30:40.000Z', { maePips: -2, mfePips: 1 })
  const dataDir = await seed([a, b])
  const { app, page, errors } = await launch({ dataDir, env: { ICTJ_MARKET_URL: server.url, ICTJ_MARKET_DELAY_MS: '400' } })
  try {
    await expect(page.getByTestId('journal-row')).toHaveCount(2)
    await page.keyboard.press('Control+,')
    await page.getByTestId('settings-tab-market').click()
    await expect(page.getByTestId('market-key-hint')).toHaveText('brak')
    await page.getByTestId('market-key-input').fill(KEY)
    await page.getByTestId('market-key-save').click()
    await expect(page.getByTestId('market-key-hint')).toHaveText('zapisany …1234')
    await page.getByTestId('market-test').click()
    await expect(page.getByTestId('market-test-result')).toContainText('Połączono. Plan: monthly')
    await expect(page.getByTestId('market-ticker-EURUSD')).toContainText('EURUSD.FOREX')
    // The key never reaches the renderer nor the per-machine config in plain text… (encrypted where the system can).
    await page.getByTestId('market-fill').click()
    await expect(page.getByTestId('market-filled-count')).toHaveText('z danymi rynkowymi: 2', { timeout: 20_000 })
    await page.getByTestId('market-key-panel').screenshot({ path: shots('90-dane-rynkowe-ustawienia') })

    // On disk: the summary from M1 bars, empty MAE / MFE filled, typed ones kept.
    const expected = (t: ReturnType<typeof marketTrade>) => {
      const from = Date.parse(t.entryTime) / 1000 - 60
      const bars = parseEodhdIntraday(syntheticBars('EURUSD.FOREX', from, from + 120 * 60))!
      return marketStatsFor(t, bars, { ticker: 'EURUSD.FOREX', pipSize: 0.0001, marginPips: 1, now: '' })
    }
    await expect.poll(async () => (await readTrades(dataDir)).filter((t) => t.market?.maePips != null).length, { timeout: 10_000 }).toBe(2)
    const saved = await readTrades(dataDir)
    const sa = saved.find((t) => t.id === a.id)!
    const sb = saved.find((t) => t.id === b.id)!
    const ea = expected(a)
    expect(sa.market).toMatchObject({ ticker: 'EURUSD.FOREX', maePips: ea.maePips, mfePips: ea.mfePips, maeAt: ea.maeAt, mfeAt: ea.mfeAt, reached1R: ea.reached1R })
    expect([sa.maePips, sa.mfePips]).toEqual([ea.maePips, ea.mfePips])
    expect([sb.maePips, sb.mfePips]).toEqual([-2, 1])
    expect(sb.market?.maePips).toBe(expected(b).maePips)
    // Bars kept in the data folder (hidden, gzip).
    const cached = await fs.readdir(join(dataDir, MARKET_DIR, 'EURUSD.FOREX', '2026'))
    expect(cached).toContain('2026-09-22.json.gz')

    // The editor: chart with levels and markers, the summary under it; the typed trade offers the market's values.
    await page.keyboard.press('Control+1')
    // The list shows New York time: 12:00 UTC = 08:00, 15:30 UTC = 11:30.
    await page.getByTestId('journal-row').filter({ hasText: '08:00' }).dblclick()
    await expect(page.getByTestId('trade-chart-canvas')).toBeVisible()
    await expect(page.getByTestId('trade-chart-summary')).toContainText(`MAE ${ea.maePips!.toFixed(1)}`)
    await expect(page.getByTestId('trade-chart-summary')).toContainText(`MFE ${ea.mfePips!.toFixed(1)}`)
    await expect(page.getByTestId('market-excursions-same')).toBeVisible()
    await page.getByTestId('trade-chart').screenshot({ path: shots('91-wykres-transakcji') })
    await page.keyboard.press('Control+1')
    await page.getByTestId('journal-row').filter({ hasText: '11:30' }).dblclick()
    await expect(page.getByTestId('market-use')).toBeVisible()
    await page.getByTestId('market-use').click()
    await expect(page.getByLabel('MAE w pipsach')).toHaveValue(expected(b).maePips!.toFixed(1))
    await expect(page.getByTestId('market-excursions-same')).toBeVisible()
    // Interval switch keeps the chart.
    await page.getByRole('radiogroup', { name: 'Interwał wykresu' }).getByRole('radio', { name: 'H1' }).click()
    await expect(page.getByTestId('trade-chart-canvas')).toBeVisible()

    // The key is stored for this computer only, not in the data folder.
    const journalJson = await fs.readFile(join(dataDir, 'journal.json'), 'utf8')
    expect(journalJson).not.toContain(KEY)
    expect(errors).toEqual([])
  } finally {
    await app.close()
    await server.close()
  }
})
