import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { DateTime } from 'luxon'
import { expect, test, type ElectronApplication } from '@playwright/test'
import { launch } from './app'

const shots = (name: string) => join('test-results', 'screens', `${name}.png`)

async function stubDialogs(app: ElectronApplication, save: string | null, open: string | null): Promise<void> {
  await app.evaluate(
    ({ dialog }, paths) => {
      const d = dialog as unknown as Record<string, unknown>
      d.showSaveDialog = async () => ({ canceled: !paths.save, filePath: paths.save ?? undefined })
      d.showOpenDialog = async () => ({ canceled: !paths.open, filePaths: paths.open ? [paths.open] : [] })
    },
    { save, open }
  )
}

test('biblioteka z adnotacjami, przegląd tygodnia z CSV, eksport/import, kopie, markdown', async () => {
  const { app, page, dataDir, errors } = await launch()
  const out = await fs.mkdtemp(join(tmpdir(), 'ictj-out-'))
  try {
    await expect(page.getByTestId('journal-table')).toBeVisible()

    // A trade with a screenshot.
    await page.keyboard.press('Control+n')
    await page.getByTestId('price-entry').fill('1.0850')
    await page.getByTestId('price-sl').fill('1.0835')
    await page.getByTestId('price-tp1').fill('1.0880')
    await page.getByTestId('quick-TP1').click()
    const png = (await fs.readFile(resolve('tests/fixtures/tv-dark-1920.png'))).toString('base64')
    await app.evaluate(async ({ clipboard, ClipboardItem }, b64) => {
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([Buffer.from(b64, 'base64')], { type: 'image/png' }) })])
    }, png)
    await page.getByTestId('screen-zone-before').click()
    await page.keyboard.press('Control+v')
    await expect(page.getByTestId('screen-card')).toHaveCount(1, { timeout: 20_000 })

    // Markdown to clipboard.
    await page.getByTestId('copy-md').click()
    await expect.poll(async () => app.evaluate(async ({ clipboard }) => clipboard.readText())).toContain('## EURUSD')

    // Library example from the trade, then annotate its screenshot.
    await page.getByTestId('to-library').click()
    await expect(page.getByTestId('library-detail')).toBeVisible()
    await page.getByTestId('library-detail').getByTestId('annotate').click()
    await expect(page.getByTestId('annotator')).toBeVisible()
    // The drawing area is measured only once it is laid out (it is hidden until the image is fitted).
    await expect(page.getByTestId('annotator-canvas')).toBeVisible()
    const box = (await page.getByTestId('annotator-canvas').boundingBox())!
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.6)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.4, { steps: 5 })
    await page.mouse.up()
    await page.getByTestId('tool-text').click()
    await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.35)
    await page.getByTestId('annotation-text').fill('MSS')
    await page.getByTestId('annotation-text').press('Enter')
    await page.screenshot({ path: shots('31-adnotacje') })
    await page.getByTestId('annotator-done').click()
    await page.getByTestId('library-title').fill('London sweep → MSS → FVG')
    const libDir = join(dataDir, 'library')
    /**
     * Annotations of the saved library item. Only canonical files: NTFS lists names sorted, so the temporary file of an
     * atomic save (".<id>.json.tmp-…") can come first and be read half-written; -1 = keep polling.
     */
    const savedAnnotations = async (): Promise<number> => {
      const files = (await fs.readdir(libDir).catch(() => [] as string[])).filter((n) => n.endsWith('.json') && !n.startsWith('.'))
      if (!files[0]) return 0
      try {
        return JSON.parse(await fs.readFile(join(libDir, files[0]), 'utf8')).screens[0]?.annotations.length ?? 0
      } catch {
        return -1
      }
    }
    await expect.poll(savedAnnotations, { timeout: 8000 }).toBe(2)
    await page.screenshot({ path: shots('32-biblioteka') })

    // A very fast drag (down, move, up in one task, before React renders the move) still draws the shape.
    await page.getByTestId('library-detail').getByTestId('annotate').click()
    await page.getByTestId('tool-rect').click()
    await expect(page.getByTestId('annotator-canvas')).toBeVisible()
    const canvas = (await page.getByTestId('annotator-canvas').boundingBox())!
    await page.getByTestId('annotator-canvas').evaluate((el, b) => {
      // Runs in the page; the test tsconfig has no DOM lib.
      const Mouse = (globalThis as unknown as { MouseEvent: new (type: string, init: Record<string, unknown>) => Event }).MouseEvent
      const at = (type: string, fx: number, fy: number) =>
        el.dispatchEvent(new Mouse(type, { bubbles: true, button: 0, clientX: b.x + b.width * fx, clientY: b.y + b.height * fy }))
      at('mousedown', 0.2, 0.2)
      at('mousemove', 0.4, 0.5)
      at('mouseup', 0.4, 0.5)
    }, canvas)
    await page.getByTestId('annotator-done').click()
    await expect.poll(savedAnnotations, { timeout: 8000 }).toBe(3)

    // Weekly review: import OHLC CSV generated for the current ISO week (NY dates).
    const nowNy = DateTime.now().setZone('America/New_York')
    const monday = nowNy.startOf('week')
    const rows = ['time,open,high,low,close']
    for (let d = 0; d < 5; d++) {
      for (let h = 0; h < 24; h++) {
        const t = monday.plus({ days: d, hours: h })
        const high = 1.09 + (h === 3 ? 0.003 : 0) + (d === 1 && h === 3 ? 0.01 : 0)
        const low = 1.08 - (h === 9 ? 0.003 : 0) - (d === 3 && h === 9 ? 0.01 : 0)
        rows.push(`${Math.floor(t.toSeconds())},1.085,${high},${low},1.085`)
      }
    }
    const csvPath = join(out, 'EURUSD_M60.csv')
    await fs.writeFile(csvPath, rows.join('\n'))
    await stubDialogs(app, null, csvPath)
    await page.keyboard.press('Control+5')
    await expect(page.getByTestId('week')).toBeVisible()
    await page.getByTestId('import-ohlc').click()
    await expect(page.getByTestId('high-time-mon')).toHaveValue('03:00')
    await expect(page.getByTestId('low-time-mon')).toHaveValue('09:00')
    await expect(page.getByTestId('week-high-tue')).toBeChecked()
    await expect(page.getByTestId('week-low-thu')).toBeChecked()
    await page.getByTestId('week-goal').fill('Tylko wejścia po MSS w killzone')
    await page.screenshot({ path: shots('33-tydzien') })

    // Export CSV + ZIP.
    await page.getByTestId('nav-settings').click()
    await page.getByTestId('settings-tab-transfer').click()
    const csvOut = join(out, 'transakcje.csv')
    await stubDialogs(app, csvOut, null)
    await page.getByTestId('export-csv').click()
    await expect.poll(async () => (await fs.readFile(csvOut, 'utf8').catch(() => '')).charCodeAt(0)).toBe(0xfeff)
    expect((await fs.readFile(csvOut, 'utf8')).split('\r\n')[1]).toContain(';1,08500;1,08350;1,08800;')
    const zipOut = join(out, 'dziennik.zip')
    await stubDialogs(app, zipOut, null)
    await page.getByTestId('export-zip').click()
    await expect.poll(async () => (await fs.stat(zipOut).catch(() => null))?.size ?? 0, { timeout: 15_000 }).toBeGreaterThan(1000)

    // Import the ZIP back: everything collides with identical versions.
    await stubDialogs(app, null, zipOut)
    await page.getByTestId('import-zip').click()
    await expect(page.getByTestId('import-report')).toContainText('transakcje 1')
    await page.screenshot({ path: shots('34-import') })
    await page.getByTestId('import-merge').click()
    await expect(page.getByTestId('import-report')).toHaveCount(0)

    // Backups: the startup daily backup exists, a manual one can be added.
    await page.getByTestId('backup-now').click()
    await expect.poll(async () => page.getByTestId('backup-row').count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(2)
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})
