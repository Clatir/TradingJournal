import { promises as fs } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { createDefaultJournal } from '../../src/shared/defaults'
import { launch } from './app'
import { seed } from './seed'

// Runs in the page (the Node test config has no DOM types).
declare const OffscreenCanvas: any

const shots = (name: string) => join('test-results', 'screens', `${name}.png`)

async function jsonFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...(await jsonFiles(p)))
    else if (e.name.endsWith('.json')) out.push(p)
  }
  return out
}

/**
 * A stand-in for XTB's "Szczegóły pozycji" (dark theme, gray labels, values under them, times in two rows), drawn
 * synthetically – not a screenshot of a real account. A fixed file, so every system OCRs the same pixels.
 */
const XTB_PANEL = join(__dirname, '../fixtures/xtb-position.png')

test('screen „Szczegóły pozycji” z XTB uzupełnia transakcję w edytorze (OCR offline, bez zapisu screena); czas wyjścia NY i WAW', async () => {
  const journal = createDefaultJournal()
  journal.settings.risk.accountCurrency = 'PLN'
  const dataDir = await seed([], journal)
  const { app, page, errors } = await launch({ dataDir })
  try {
    await expect(page.getByTestId('journal-table')).toBeVisible()
    await page.keyboard.press('Control+n')
    await expect(page.getByTestId('trade-editor')).toBeVisible()
    await page.getByTestId('price-sl').fill('1.0835')

    await page.getByTestId('xtb-open').click()
    await page.getByTestId('xtb-file').setInputFiles(XTB_PANEL)
    await expect(page.getByTestId('xtb-values')).toBeVisible({ timeout: 60_000 })

    await expect(page.getByTestId('xtb-direction')).toHaveValue('short')
    await expect(page.getByTestId('xtb-entry-time')).toHaveValue('06.10.2026 09:58')
    await expect(page.getByTestId('xtb-entry')).toHaveValue('1.12414')
    await expect(page.getByTestId('xtb-sl')).toHaveValue('1.12643')
    await expect(page.getByTestId('xtb-tp')).toHaveValue('1.10843')
    await expect(page.getByTestId('xtb-lots')).toHaveValue('0.01')
    await expect(page.getByTestId('xtb-exit-price')).toHaveValue('1.12595')
    await expect(page.getByTestId('xtb-exit-time')).toHaveValue('06.10.2026 13:22')
    await expect(page.getByTestId('xtb-result')).toHaveValue('-7.06')
    await expect(page.getByTestId('xtb-row-result')).toContainText('Wynik netto (PLN)')
    await expect(page.getByTestId('xtb-extra')).toContainText('EURUSD')
    await expect(page.getByTestId('xtb-missing')).toHaveCount(0)
    // Values agree with each other (a price scaled after a lost decimal point would only add a note).
    await expect(page.getByTestId('xtb-warning').filter({ hasText: /Kierunek|brutto|zamknięcia/ })).toHaveCount(0)
    // The value typed in the editor is replaced; the pair was already EURUSD (nothing to change).
    await expect(page.getByTestId('xtb-use-stopLoss')).toBeChecked()
    await expect(page.getByTestId('xtb-use-pair')).not.toBeChecked()
    // A correction in the dialog: TP not taken.
    await page.getByTestId('xtb-use-takeProfit').uncheck()
    await page.screenshot({ path: shots('70-xtb-screen') })
    await page.getByTestId('xtb-apply').click()
    await expect(page.getByTestId('xtb-dialog')).toHaveCount(0)

    // Editor: prices, exit in NY and Warsaw time, the result in the account currency.
    await expect(page.getByTestId('price-entry')).toHaveValue('1.12414')
    await expect(page.getByTestId('price-sl')).toHaveValue('1.12643')
    await expect(page.getByTestId('price-tp1')).toHaveValue('')
    await expect(page.getByTestId('exit-price-0')).toHaveValue('1.12595')
    await expect(page.getByTestId('exit-time-0-NY')).toHaveValue('07:22')
    await expect(page.getByTestId('exit-time-0-WAW')).toHaveValue('13:22')
    await expect(page.getByTestId('trade-broker')).toContainText('ze screenu')
    await expect(page.getByTestId('trade-broker')).toContainText('7.06 PLN')

    const files = () => jsonFiles(join(dataDir, 'trades'))
    const saved = async () => JSON.parse(await fs.readFile((await files())[0]!, 'utf8')) as Record<string, any>
    await expect.poll(async () => (await files()).length, { timeout: 8000 }).toBe(1)
    await expect.poll(async () => (await saved()).exits?.[0]?.price, { timeout: 8000 }).toBe(1.12595)
    const t = await saved()
    expect(t).toMatchObject({
      pair: 'EURUSD',
      direction: 'short',
      entryTime: '2026-10-06T07:58:00.000Z',
      status: 'closed',
      prices: { entry: 1.12414, stopLoss: 1.12643, takeProfit1: null },
      lots: 0.01,
      pnlAmountOverride: -7.06,
      amountCurrency: 'PLN',
      screens: [],
      broker: { tickets: [], symbol: 'EURUSD', net: -7.06, currency: 'PLN', source: 'screen' }
    })
    expect(t.exits).toHaveLength(1)
    expect(t.exits[0]).toMatchObject({ time: '2026-10-06T11:22:00.000Z', percent: 100 })
    // The screenshot is only read: nothing in screens/.
    expect(await fs.readdir(join(dataDir, 'screens')).catch(() => [])).toEqual([])

    // Exit time typed in Warsaw time (XTB's clock); NY follows.
    await page.getByTestId('exit-time-0-WAW').fill('15:05')
    await page.getByTestId('exit-time-0-WAW').press('Enter')
    await expect(page.getByTestId('exit-time-0-NY')).toHaveValue('09:05')
    await expect.poll(async () => (await saved()).exits?.[0]?.time, { timeout: 8000 }).toBe('2026-10-06T13:05:00.000Z')
    await page.getByTestId('exit-time-0-NY').fill('10:30')
    await page.getByTestId('exit-time-0-NY').press('Enter')
    await expect(page.getByTestId('exit-time-0-WAW')).toHaveValue('16:30')

    // Something that is not a position panel.
    await page.getByTestId('xtb-open').click()
    const other = join(mkdtempSync(join(tmpdir(), 'ictj-xtb-')), 'inny.png')
    await fs.writeFile(
      other,
      Buffer.from(
        await page.evaluate(async () => {
          const c = new OffscreenCanvas(400, 200)
          const g = c.getContext('2d')!
          g.fillStyle = '#ffffff'
          g.fillRect(0, 0, 400, 200)
          g.fillStyle = '#000000'
          g.font = '20px Inter, sans-serif'
          g.fillText('Lista zakupów: mleko, chleb', 20, 100)
          const bytes = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer())
          let s = ''
          for (const x of bytes) s += String.fromCharCode(x)
          return btoa(s)
        }),
        'base64'
      )
    )
    await page.getByTestId('xtb-file').setInputFiles(other)
    await expect(page.getByTestId('xtb-error')).toContainText('Nie rozpoznano panelu', { timeout: 60_000 })
    await expect(page.getByTestId('xtb-apply')).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('xtb-dialog')).toHaveCount(0)

    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})
