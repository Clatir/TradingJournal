import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { launch } from './app'

const shots = (name: string) => join('test-results', 'screens', `${name}.png`)

async function findFiles(dir: string, re: RegExp): Promise<string[]> {
  const out: string[] = []
  async function walk(d: string): Promise<void> {
    let entries
    try {
      entries = await fs.readdir(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = join(d, e.name)
      if (e.isDirectory()) await walk(p)
      else if (re.test(e.name)) out.push(p)
    }
  }
  await walk(dir)
  return out
}

test('pierwsze uruchomienie, transakcja ze screenem ze schowka, synchronizacja z zewnątrz', async () => {
  const { app, page, dataDir, errors } = await launch()
  try {
    await expect(page.getByTestId('journal-table')).toBeVisible()
    await expect(page.getByText('Dziennik jest pusty.')).toBeVisible()
    expect(JSON.parse(await fs.readFile(join(dataDir, 'journal.json'), 'utf8')).schemaVersion).toBe(1)
    await page.screenshot({ path: shots('01-pusty-dziennik') })

    // New trade via keyboard shortcut.
    await page.keyboard.press('Control+n')
    await expect(page.getByTestId('trade-editor')).toBeVisible()
    await page.getByTestId('entry-time-NY-date').fill('2026-03-16')
    await page.getByTestId('entry-time-NY-date').press('Enter')
    await page.getByTestId('entry-time-NY-time').fill('0330')
    await page.getByTestId('entry-time-NY-time').press('Enter')
    await expect(page.getByTestId('entry-time-WAW-time')).toHaveValue('08:30')
    await expect(page.getByTestId('killzone-detected')).toHaveText('London + SB London')

    await page.getByTestId('price-entry').fill('1,0850')
    await page.getByTestId('price-sl').fill('1.0835')
    await page.getByTestId('price-tp1').fill('1.0880')
    await expect(page.getByTestId('metric-sl')).toHaveText('15.0 p')
    await expect(page.getByTestId('metric-rr1')).toHaveText('2.00')
    await page.getByTestId('quick-TP1').click()
    await expect(page.getByTestId('result-r')).toHaveText('+2.00R')
    await page.getByTestId('trade-notes').fill('Sweep PDL w Londynie, MSS na M5, wejście w FVG.')

    // Paste a screenshot from the system clipboard.
    const png = (await fs.readFile(resolve('tests/fixtures/tv-dark-1920.png'))).toString('base64')
    // Electron 44 clipboard API: async write() of ClipboardItem objects.
    await app.evaluate(async ({ clipboard, ClipboardItem }, b64) => {
      const blob = new Blob([Buffer.from(b64, 'base64')], { type: 'image/png' })
      await clipboard.write([new ClipboardItem({ 'image/png': blob })])
    }, png)
    await page.getByTestId('screen-zone-before').click()
    await page.keyboard.press('Control+v')
    await expect(page.getByTestId('screen-card')).toHaveCount(1, { timeout: 20_000 })
    await page.keyboard.press('3') // timeframe H4
    await expect(page.locator('[data-testid="screen-card"] button[aria-pressed="true"]')).toHaveText('H4')
    await page.screenshot({ path: shots('02-edytor-transakcji') })

    const webps = await findFiles(join(dataDir, 'screens'), /\.webp$/)
    expect(webps.filter((f) => f.endsWith('.thumb.webp'))).toHaveLength(1)
    expect(webps).toHaveLength(2)
    await expect.poll(async () => (await findFiles(join(dataDir, 'trades'), /^2026-03-16_EURUSD_.*\.json$/)).length).toBe(1)
    const tradeFiles = await findFiles(join(dataDir, 'trades'), /^2026-03-16_EURUSD_.*\.json$/)
    const readTrade = async () => JSON.parse(await fs.readFile(tradeFiles[0]!, 'utf8'))
    await expect.poll(async () => (await readTrade()).screens[0]?.timeframe, { timeout: 5000 }).toBe('H4')
    const tradeJson = await readTrade()
    expect(tradeJson.screens[0].path).toMatch(/^screens\/2026\/03\/.+_przed\.webp$/)
    expect(tradeJson.computed.resultR).toBe(2)

    // The thumbnail is really served by the journal-file:// protocol (not a broken image).
    await expect.poll(async () => page.locator('[data-testid="screen-card"] img').first().evaluate((img) => (img as unknown as { naturalWidth: number }).naturalWidth)).toBe(480)

    // Lightbox shows the full image.
    await page.locator('[data-testid="screen-card"] img').first().click()
    await expect(page.getByTestId('lightbox')).toBeVisible()
    await expect.poll(async () => page.getByTestId('lightbox').locator('img').first().evaluate((img) => (img as unknown as { naturalWidth: number }).naturalWidth)).toBe(1920)
    await page.screenshot({ path: shots('03-lightbox') })
    await page.keyboard.press('Escape')

    // Back to the list.
    await page.getByTestId('nav-journal').click()
    await expect(page.getByTestId('journal-row')).toHaveCount(1)
    await page.screenshot({ path: shots('04-dziennik') })

    // A change made by another computer (sync) appears without restarting.
    tradeJson.notes = 'Zmienione na laptopie'
    await fs.writeFile(tradeFiles[0]!, JSON.stringify(tradeJson, null, 2))
    await expect(page.getByText('Zmienione na laptopie')).toBeVisible({ timeout: 10_000 })

    // A sync conflict copy is listed for resolution.
    await fs.writeFile(tradeFiles[0]!.replace(/\.json$/, '-LAPTOP-7.json'), JSON.stringify({ ...tradeJson, notes: 'wersja z konfliktu' }, null, 2))
    await expect(page.getByTestId('banner-sync')).toBeVisible({ timeout: 10_000 })
    await page.getByTestId('nav-sync').click()
    await expect(page.getByText('OneDrive', { exact: true })).toBeVisible()
    await page.screenshot({ path: shots('05-konflikt') })
    await page.getByTestId('keep-copy').click()
    await expect(page.getByText('Brak konfliktów.')).toBeVisible()

    // A broken file is reported, the app keeps working.
    await fs.writeFile(join(dataDir, 'trades', '2026', `2026-03-17_EURUSD_01K6H3Z0W8Q4M2N5P7R9S1T3V5.json`), '{ "zepsuty": ')
    await expect(page.getByTestId('problem-row')).toHaveCount(1, { timeout: 10_000 })

    // Settings: screens folder size.
    await page.getByTestId('nav-settings').click()
    await page.getByTestId('settings-tab-screens').click()
    await expect(page.getByTestId('screens-total')).not.toHaveText('0 B')
    await page.screenshot({ path: shots('06-ustawienia-screeny') })

    // Command palette.
    await page.keyboard.press('Control+k')
    await expect(page.getByTestId('palette-input')).toBeVisible()
    await page.keyboard.type('EURUSD')
    await page.screenshot({ path: shots('07-paleta') })
    await page.keyboard.press('Escape')
    // Only the deliberately broken file may produce errors (none expected in the renderer).
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})

test('dane przeniesione do innego folderu otwierają się ze screenami', async () => {
  const first = await launch()
  await expect(first.page.getByTestId('journal-table')).toBeVisible()
  await first.page.keyboard.press('Control+n')
  await first.page.getByTestId('price-entry').fill('1.1')
  await expect(first.page.getByTestId('save-state')).toHaveText(/zapisano/, { timeout: 10_000 })
  await first.app.close()
  const moved = `${first.dataDir}-przeniesiony`
  await fs.rename(first.dataDir, moved)
  const second = await launch({ dataDir: moved, userData: first.userData })
  try {
    await expect(second.page.getByTestId('journal-row')).toHaveCount(1)
  } finally {
    await second.app.close()
  }
})

test('zapamiętany folder niedostępny (pendrive) → „Spróbuj ponownie” po podłączeniu', async () => {
  const first = await launch()
  await expect(first.page.getByTestId('journal-table')).toBeVisible()
  await first.app.close()
  const away = `${first.dataDir}-odlaczony`
  await fs.rename(first.dataDir, away)
  const second = await launch({ userData: first.userData, usePreset: false })
  try {
    await expect(second.page.getByTestId('setup-message')).toContainText('niedostępny')
    await fs.rename(away, first.dataDir)
    await second.page.getByTestId('retry-folder').click()
    await expect(second.page.getByTestId('journal-table')).toBeVisible()
  } finally {
    await second.app.close()
  }
})
