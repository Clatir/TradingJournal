import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { DateTime } from 'luxon'
import { createDayPlan, createDefaultJournal, createTrade } from '../../src/shared/defaults'
import { MARKET_STATS_VERSION, marketStatsFor, missedHorizon, missedOutcomeFor } from '../../src/shared/calc/marketStats'
import { volatilityWindowFrom, whatIfHorizon } from '../../src/shared/calc/whatIf'
import { dayLevels, levelSessions, levelsWindow } from '../../src/shared/calc/marketLevels'
import { weekExtremes } from '../../src/shared/calc/ohlc'
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

test('dane rynkowe 1.9–1.10: poziomy w planie dnia, płynność przed wejściem, missed z danych, tydzień z danych, co by było gdyby, ATR', async () => {
  const server = await startMarketServer({ key: KEY })
  const closed = marketTrade('01K6H40000000000000000000C', '2026-09-23T14:00:20.000Z') // 10:00 NY
  const entry = syntheticPrice('EURUSD.FOREX', Date.parse('2026-09-23T13:00:00Z') / 1000)
  const missed = createTrade({
    id: '01K6H40000000000000000000D',
    pair: 'EURUSD',
    direction: 'long',
    status: 'missed',
    entryTime: '2026-09-23T13:00:05.000Z',
    prices: { entry, stopLoss: Number((entry - 0.0012).toFixed(5)), takeProfit1: Number((entry + 0.0012).toFixed(5)), takeProfit2: Number((entry + 0.0025).toFixed(5)) }
  })
  const dataDir = await seed([closed, missed], undefined, [createDayPlan('2026-09-23', ['EURUSD'], [])])
  const { app, page, errors } = await launch({ dataDir, env: { ICTJ_MARKET_URL: server.url, ICTJ_MARKET_KEY: KEY, ICTJ_MARKET_DELAY_MS: '300' } })
  try {
    await expect(page.getByTestId('journal-row')).toHaveCount(2)

    // In the background (key from the environment): the summary of both trades.
    const settings = createDefaultJournal().settings
    const sessions = levelSessions(settings.market.asia, settings.killzones)
    const bars = (fromMs: number, toMs: number) => parseEodhdIntraday(syntheticBars('EURUSD.FOREX', fromMs / 1000, toMs / 1000 - 1))!
    const lw = levelsWindow('2026-09-23')
    const levelBars = bars(lw.fromMs, lw.toMs)
    // The closed trade's bars: from 15 trading days before (ATR) to 17:00 NY (the plans replayed until the day's end).
    const allBars = bars(volatilityWindowFrom(closed), whatIfHorizon(closed)!)
    const expectedClosed = marketStatsFor(closed, allBars, { ticker: 'EURUSD.FOREX', pipSize: 0.0001, marginPips: 1, now: new Date().toISOString(), levels: { levels: dayLevels('2026-09-23', allBars, sessions), bars: allBars } })
    const horizon = missedHorizon(missed)!
    const expectedMissed = missedOutcomeFor(missed, bars(Date.parse(missed.entryTime) - 60_000, horizon), horizon, 0.0001)
    await expect.poll(async () => (await readTrades(dataDir)).filter((t) => t.market?.v === MARKET_STATS_VERSION).length, { timeout: 20_000 }).toBe(2)
    const saved = await readTrades(dataDir)
    const sc = saved.find((t) => t.id === closed.id)!
    const sm = saved.find((t) => t.id === missed.id)!
    expect(sc.market!.liquidity.map((l) => [l.id, l.touch])).toEqual(expectedClosed.liquidity.map((l) => [l.id, l.touch]))
    expect(sm.market!.missed).toMatchObject({ outcome: expectedMissed.outcome, certain: expectedMissed.certain })
    expect(sm.missed.hypotheticalOutcome).toBe(expectedMissed.certain ? expectedMissed.outcome : null)
    expect(expectedClosed.vol?.atrPips).toBeGreaterThan(0)
    expect(sc.market!.vol).toEqual(expectedClosed.vol)
    expect(sc.market!.whatIf).toEqual(expectedClosed.whatIf)
    expect(sc.market!.whatIfAfter).toBeNull()

    // The editor shows the liquidity taken before the entry (and marks the matching dictionary items).
    await page.getByTestId('journal-row').filter({ hasText: '10:00' }).dblclick()
    if (expectedClosed.liquidity.some((l) => l.touch === 'yes')) {
      await expect(page.getByTestId('market-liquidity')).toContainText('przed wejściem zebrano')
      await page.getByTestId('market-liquidity-mark').click()
      await expect.poll(async () => (await readTrades(dataDir)).find((t) => t.id === closed.id)!.liquidityTakenIds.length).toBeGreaterThan(0)
    }
    await expect(page.getByTestId('trade-chart-levels')).toBeChecked()
    await expect(page.getByTestId('trade-chart-extras')).toContainText(`ATR 14: ${expectedClosed.vol!.atrPips!.toFixed(1)} p`)
    await expect(page.getByTestId('trade-what-if')).toContainText('Stały cel 2R')

    // Analytics: the plans on the same trade, the stop in ATR.
    await page.getByTestId('nav-analytics').click()
    const market = page.getByTestId('market-analytics')
    await expect(market.getByTestId('what-if-actual')).toContainText('1')
    const r2 = expectedClosed.whatIf!.results.r2!.r
    const abs = Math.abs(r2).toFixed(1)
    await expect(market.getByTestId('what-if-r2')).toContainText(`${Number(abs) === 0 ? '' : r2 < 0 ? '−' : '+'}${abs}R`)
    await expect(market.getByTestId('sl-atr')).toBeVisible()
    await market.screenshot({ path: shots('93-co-by-bylo-gdyby') })

    // Day plan of 23.09: levels from the bars, all added to the key levels.
    await page.keyboard.press('Control+d')
    await page.getByTestId('day-date').fill('2026-09-23')
    await page.getByTestId('day-date').press('Enter')
    const levels = page.getByTestId('market-levels')
    await expect(levels.getByTestId('market-level-pdh')).toBeVisible({ timeout: 15_000 })
    const expectedLevels = dayLevels('2026-09-23', levelBars, sessions)
    const pdh = expectedLevels.find((l) => l.id === 'pdh')!
    await expect(levels.getByTestId('market-level-pdh')).toContainText(pdh.price.toFixed(5))
    await levels.screenshot({ path: shots('92-poziomy-z-danych') })
    await levels.getByTestId('market-levels-add-all').click()
    const dayFile = join(dataDir, 'days', '2026', '2026-09-23.json')
    await expect
      .poll(async () => (JSON.parse(await fs.readFile(dayFile, 'utf8')) as { pairs: Array<{ keyLevels: Array<{ label: string; price: number }> }> }).pairs[0]!.keyLevels.map((k) => k.label))
      .toEqual(expectedLevels.map((l) => l.label))

    // Week 2026-W39: high / low of each day and their New York times from the bars.
    await page.getByTestId('nav-week').click()
    await page.getByTitle('Poprzedni tydzień').click()
    await page.getByTitle('Poprzedni tydzień').click()
    await expect(page.getByText('2026-W39')).toBeVisible()
    await page.getByTestId('week-from-market').click()
    const weekBars = bars(DateTime.fromISO('2026-09-21', { zone: 'America/New_York' }).toMillis(), DateTime.fromISO('2026-09-26', { zone: 'America/New_York' }).toMillis())
    const ext = weekExtremes(weekBars, '2026-W39')
    await expect(page.getByRole('heading', { name: /high \/ low dnia.*z danych rynkowych/ })).toBeVisible()
    await expect
      .poll(async () => {
        const dir = join(dataDir, 'weeks')
        const f = (await fs.readdir(dir).catch(() => [] as string[])).find((n) => n.startsWith('2026-W39'))
        return f ? (JSON.parse(await fs.readFile(join(dir, f), 'utf8')) as { pairs: Array<{ days: unknown[]; weekHighDay: string }> }).pairs[0] : null
      })
      .toMatchObject({ days: ext.days, weekHighDay: ext.weekHighDay, marketTicker: 'EURUSD.FOREX' })
    expect(errors).toEqual([])
  } finally {
    await app.close()
    await server.close()
  }
})

test('trening z odtwarzaniem 1.11: karta z wykresu bez screena, przyszłość ukryta, SL kliknięciem, odtworzenie dnia po odpowiedzi', async () => {
  const server = await startMarketServer({ key: KEY })
  const t = marketTrade('01K6H40000000000000000000E', '2026-09-23T14:00:20.000Z') // 10:00 NY, no screens
  const dataDir = await seed([t])
  const { app, page, errors } = await launch({ dataDir, env: { ICTJ_MARKET_URL: server.url, ICTJ_MARKET_KEY: KEY, ICTJ_MARKET_DELAY_MS: '300' } })
  try {
    await expect(page.getByTestId('journal-row')).toHaveCount(1)
    await expect.poll(async () => (await readTrades(dataDir))[0]!.market?.v, { timeout: 20_000 }).toBe(MARKET_STATS_VERSION)

    await page.keyboard.press('Control+8')
    await expect(page.getByTestId('drill-page')).toBeVisible()
    const sources = page.getByRole('radiogroup', { name: 'Źródło kart' })
    await expect(sources.getByRole('radio', { name: 'screeny (0)' })).toBeVisible()
    await sources.getByRole('radio', { name: 'wykres (1)' }).click()
    await expect(page.getByTestId('drill-available')).toContainText('1')
    await page.getByTestId('drill-start').click()

    // The chart up to the entry: the last M5 candle starts before 10:00 NY, nothing of the trade on it.
    const canvas = page.getByTestId('drill-chart-canvas')
    await expect(canvas).toHaveAttribute('data-last', '2026-09-23T13:55:00.000Z', { timeout: 15_000 })
    await expect(page.getByTestId('drill-view-chart')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('drill-entry')).toContainText('10:00')
    await expect(page.getByTestId('drill-result')).toHaveCount(0)
    // A click on the chart sets the SL guess.
    const box = (await canvas.boundingBox())!
    await canvas.click({ position: { x: box.width * 0.5, y: box.height * 0.8 } })
    await expect(page.getByTestId('drill-sl')).not.toHaveValue('')
    await page.getByTestId('drill-chart').screenshot({ path: shots('94-trening-wykres-przed') })

    await page.getByTestId('drill-answer-long').click()
    await expect(page.getByTestId('drill-reveal')).toBeVisible()
    await page.getByTestId('drill-replay-end').click()
    await expect(page.getByTestId('drill-replay-time')).toHaveText('do 17:00 NY')
    await expect(canvas).toHaveAttribute('data-last', '2026-09-23T20:55:00.000Z')
    await page.getByTestId('drill-card').screenshot({ path: shots('95-trening-wykres-odtworzony') })

    await page.getByTestId('drill-next').click()
    await expect(page.getByTestId('drill-summary')).toBeVisible()
    await expect(page.getByTestId('drill-summary-row')).toContainText('Wykres (dane rynkowe)')
    await expect
      .poll(async () => {
        const names = await fs.readdir(join(dataDir, 'drills')).catch(() => [] as string[])
        const f = names.find((n) => n.endsWith('.json'))
        return f ? (JSON.parse(await fs.readFile(join(dataDir, 'drills', f), 'utf8')) as { cards: Array<{ source: string; answer: string; slPips: number | null }> }).cards[0] : null
      })
      .toMatchObject({ source: 'chart', answer: 'long', slPips: expect.any(Number) })
    expect(errors).toEqual([])
  } finally {
    await app.close()
    await server.close()
  }
})
