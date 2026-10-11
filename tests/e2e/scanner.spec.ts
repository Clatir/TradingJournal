import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, test } from '@playwright/test'
import { launch } from './app'
import { startFakeEodhd, type FakeBar, type FakeEodhd } from '../helpers/fakeEodhd'
import { isMarketOpen } from '../../src/shared/scanner/time'

/** Minute bars of the last trading days before now (the test does not depend on the market being open). */
function recentBars(days: number): FakeBar[] {
  const now = Math.floor(Date.now() / 60_000) * 60
  const out: FakeBar[] = []
  let p = 1.12
  for (let t = now - days * 86400; t < now - 3600; t += 60) {
    if (!isMarketOpen(t)) continue
    const o = p
    p = Math.max(1.05, Math.min(1.2, p + (Math.sin(t / 997) + Math.cos(t / 331)) * 0.00008))
    out.push({ timestamp: t, open: o, high: Math.max(o, p) + 0.00005, low: Math.min(o, p) - 0.00005, close: p })
  }
  return out
}

let fake: FakeEodhd
test.beforeAll(async () => {
  fake = await startFakeEodhd('e2e-token-0123456789')
  fake.bars.set('EURUSD.FOREX', recentBars(6))
})
test.afterAll(() => fake.close())

test('scanner: stream, history, symbols, chart, settings (fake EODHD, key from the environment)', async () => {
  const { app, page, userData, errors } = await launch({ env: { ICTJ_EODHD_URL: fake.restBase.replace(/\/api$/, ''), EODHD_API_TOKEN: fake.token } })
  try {
    await expect(page.getByTestId('nav-scanner')).toBeVisible()
    await page.keyboard.press('Control+0')
    await expect(page.getByTestId('scanner-page')).toBeVisible()
    await expect(page.getByTestId('scanner-stream')).toContainText('połączony', { timeout: 20_000 })
    // A new journal has a USD account: the start list without USDPLN = 15 symbols (16 with a PLN account).
    await expect(page.getByTestId('scanner-budget')).toContainText('15 / 50')
    await expect(page.getByTestId('scanner-symbols').locator('tbody tr')).toHaveCount(15)
    // One subscribe message with the whole list.
    await expect.poll(() => fake.subscriptions.length).toBe(1)
    expect(JSON.parse(fake.subscriptions[0]!).symbols.split(',')).toHaveLength(15)

    // History of EURUSD arrives through the backfill and is drawn.
    await page.getByTestId('scanner-row-EURUSD').click()
    await expect(page.getByTestId('scanner-chart-info')).toContainText('świec', { timeout: 30_000 })
    await page.getByRole('radio', { name: 'M15' }).click()
    await expect(page.getByTestId('scanner-chart-info')).toContainText('świec')
    const info = await page.getByTestId('scanner-chart-info').innerText()
    expect(Number(info.split(' ')[0])).toBeGreaterThan(100)

    // ICT layers (phase 2): the engine ran in the window and the chart reports object counts per layer.
    await expect(page.getByTestId('scanner-analysis')).toContainText(/analiza \d+ ms/, { timeout: 30_000 })
    await expect(page.getByTestId('scanner-layers-info')).toContainText(/FVG \d+ · OB \d+ · pule [1-9]\d*/)
    await expect(page.getByTestId('scanner-layers-info')).toContainText(/okna [1-9]\d*/)
    await page.screenshot({ path: 'test-results/scanner-page.png' })
    await page.getByTestId('scanner-layer-fvg').click()
    await expect(page.getByTestId('scanner-layer-fvg')).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByTestId('scanner-layers-info')).not.toContainText('FVG')
    expect(await page.evaluate(() => localStorage.getItem('ictj.scanner.layers'))).toContain('"fvg":false')
    await page.getByTestId('scanner-layer-fvg').click()
    await expect(page.getByTestId('scanner-layers-info')).toContainText(/FVG \d+/)

    // Settings → Skaner.
    await page.getByTestId('nav-settings').click()
    await page.getByTestId('settings-tab-scanner').click()
    await expect(page.getByTestId('scanner-key')).toContainText('ze zmiennej środowiskowej')
    await expect(page.getByTestId('scanner-instruments').locator('[data-testid^="scanner-inst-"]')).toHaveCount(7)
    await expect(page.getByTestId('scanner-plan').locator('span.num')).toHaveCount(15)
    await page.getByTestId('scanner-key-test').click()
    await expect(page.getByText('Klucz działa')).toBeVisible()

    // TradingView H1 export for WTI (EODHD has no WTI history).
    const csvDir = await fs.mkdtemp(join(tmpdir(), 'ictj-wti-'))
    const csv = join(csvDir, 'OANDA_WTICOUSD_60.csv')
    const start = Math.floor(Date.UTC(2026, 9, 5, 13) / 1000)
    await fs.writeFile(csv, ['time,open,high,low,close', ...Array.from({ length: 40 }, (_, i) => `${start + i * 3600},70.1,70.5,69.8,70.2`)].join('\n'))
    await app.evaluate(({ dialog }, path) => {
      ;(dialog as unknown as Record<string, unknown>).showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    }, csv)
    await page.getByTestId('scanner-import-WTIUSD').click()
    await expect(page.getByText(/WTIUSD: zaimportowano 40 świec H1/)).toBeVisible()
    await page.screenshot({ path: 'test-results/scanner-settings.png', fullPage: true })

    // Adding an instrument grows the subscription.
    await page.getByTestId('scanner-add-symbol').fill('GBPJPY')
    await page.getByTestId('scanner-add-symbol').press('Enter')
    await expect(page.getByTestId('scanner-instruments').locator('[data-testid^="scanner-inst-"]')).toHaveCount(8)
    await expect.poll(() => fake.subscriptions.length, { timeout: 20_000 }).toBe(2)
    expect(JSON.parse(fake.subscriptions[1]!).symbols.split(',')).toContain('GBPJPY')

    // The token never reaches the log.
    const logText = await fs.readFile(join(userData, 'logs', 'main.log'), 'utf8').catch(() => '')
    expect(logText).not.toContain(fake.token)
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})

test('scanner: entering the API key in the settings connects the stream', async () => {
  const { app, page, errors } = await launch({ env: { ICTJ_EODHD_URL: fake.restBase.replace(/\/api$/, ''), EODHD_API_TOKEN: '' } })
  try {
    await page.getByTestId('nav-scanner').click()
    await expect(page.getByTestId('scanner-no-key')).toBeVisible()
    await expect(page.getByTestId('scanner-stream')).toContainText('brak klucza')
    await page.getByTestId('scanner-no-key').getByRole('button').click()
    await page.getByTestId('scanner-key-input').fill(fake.token)
    await page.getByTestId('scanner-key-input').press('Enter')
    await expect(page.getByTestId('scanner-key')).toContainText(/zaszyfrowany|tylko do zamknięcia/)
    await page.getByTestId('nav-scanner').click()
    await expect(page.getByTestId('scanner-stream')).toContainText('połączony', { timeout: 20_000 })
    await expect(page.getByTestId('scanner-no-key')).toHaveCount(0)
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})
