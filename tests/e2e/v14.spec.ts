import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { tradeRelPath } from '../../src/shared/paths'
import type { Trade } from '../../src/shared/schema'
import { launch } from './app'
import { closedTrade, readTrades, seed } from './seed'

/** Another computer (PC-B) changes the trade file; this app is asked to rescan (as its watcher would). */
async function remoteEdit(page: Page, dataDir: string, t: Trade, patch: Partial<Trade>, stamp: string): Promise<void> {
  const file = join(dataDir, tradeRelPath(t))
  const current = JSON.parse(await fs.readFile(file, 'utf8')) as Trade
  await fs.writeFile(file, `${JSON.stringify({ ...current, ...patch, updatedAt: stamp, updatedBy: 'PC-B' }, null, 2)}\n`)
  await page.evaluate(() => (globalThis as unknown as { journal: { rescan(): Promise<void> } }).journal.rescan())
}

test('historia zmian: poprzednia wersja z różnicami, przywrócenie; usunięty wpis wraca z historii', async () => {
  const t = closedTrade('2026-10-01', 2, { notes: 'pierwsza wersja' })
  const dataDir = await seed([t])
  const { app, page, errors } = await launch({ dataDir, machine: 'PC-TEST' })
  try {
    await page.getByTestId('journal-row').first().dblclick()
    await page.getByTestId('trade-notes').fill('druga wersja')
    await expect.poll(async () => (await readTrades(dataDir))[0]?.notes, { timeout: 8000 }).toBe('druga wersja')
    expect((await readTrades(dataDir))[0]?.updatedBy).toBe('PC-TEST')

    await page.getByTestId('history-open').click()
    const dialog = page.getByTestId('history-dialog')
    await expect(dialog.getByTestId('history-version')).toHaveCount(1)
    await expect(dialog.getByTestId('history-changes')).toContainText('Notatki')
    await expect(dialog.getByTestId('history-changes')).toContainText('pierwsza wersja')
    await expect(dialog.getByTestId('history-changes')).toContainText('druga wersja')
    await dialog.getByTestId('history-restore').click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByTestId('trade-notes')).toHaveValue('pierwsza wersja')
    await expect.poll(async () => (await readTrades(dataDir))[0]?.notes).toBe('pierwsza wersja')
    // The replaced version is in the history too.
    await page.getByTestId('history-open').click()
    await expect(page.getByTestId('history-version')).toHaveCount(2)
    await page.keyboard.press('Escape')

    // Delete, then bring it back from Synchronizacja → Usunięte wpisy.
    await page.getByTitle('Usuń transakcję').click()
    await page.getByTestId('confirm-delete').click()
    await expect.poll(async () => (await readTrades(dataDir)).length).toBe(0)
    await page.getByTestId('nav-sync').click()
    await page.getByTestId('deleted-load').click()
    await expect(page.getByTestId('deleted-row')).toHaveCount(1)
    await expect(page.getByTestId('deleted-row')).toContainText('Transakcja 2026-10-01 EURUSD long')
    await page.getByTestId('deleted-restore').click()
    await expect(page.getByTestId('deleted-row')).toHaveCount(0)
    await expect.poll(async () => (await readTrades(dataDir)).map((x) => x.notes)).toEqual(['pierwsza wersja'])
    await page.getByTestId('nav-journal').click()
    await expect(page.getByTestId('journal-row')).toHaveCount(1)
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})

test('dwa komputery: zmiany scalane pole po polu, konflikt do wyboru, tryb „zawsze pytaj”, nic nie ginie', async () => {
  const t = closedTrade('2026-10-01', 2, { notes: 'start', lots: 0.5 })
  const dataDir = await seed([t])
  const { app, page, errors } = await launch({ dataDir, machine: 'PC-A' })
  try {
    // Edits stay unsaved for 10 s, so a change from "PC-B" arrives while they are pending.
    await page.evaluate(() => {
      ;(globalThis as { __ICTJ_SAVE_DELAY__?: number }).__ICTJ_SAVE_DELAY__ = 10_000
    })
    await page.getByTestId('journal-row').first().dblclick()

    // 1) Different fields: merged without asking.
    await page.getByTestId('trade-notes').fill('moja notatka')
    await remoteEdit(page, dataDir, t, { lots: 0.7 }, '2026-10-05T10:00:00.000Z')
    await expect(page.getByText('Scalono zmiany z komputera PC-B')).toBeVisible()
    await expect(page.getByTestId('trade-lots')).toHaveValue('0.70')
    await expect(page.getByTestId('trade-notes')).toHaveValue('moja notatka')
    await page.keyboard.press('Control+s')
    await expect.poll(async () => (await readTrades(dataDir)).map((x) => [x.notes, x.lots, x.updatedBy])).toEqual([['moja notatka', 0.7, 'PC-A']])

    // 2) The same field on both sides: the dialog asks; take PC-B's notes, keep my other edit.
    await page.getByTestId('trade-notes').fill('moja druga')
    await page.getByTestId('trade-lots').fill('0.8')
    await page.getByTestId('trade-lots').blur()
    await remoteEdit(page, dataDir, t, { notes: 'notatka z B' }, '2026-10-05T10:05:00.000Z')
    const dialog = page.getByTestId('remote-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTestId('remote-item')).toHaveCount(1)
    await expect(dialog.getByTestId('remote-conflict')).toHaveCount(1)
    await expect(dialog.getByTestId('remote-conflict')).toContainText('Notatki')
    // Nothing is written while the decision waits.
    await page.keyboard.press('Control+s')
    expect((await readTrades(dataDir))[0]?.notes).toBe('notatka z B')
    await dialog.getByTestId('remote-pick-theirs').click()
    await dialog.getByTestId('remote-apply').click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByTestId('trade-notes')).toHaveValue('notatka z B')
    await expect(page.getByTestId('trade-lots')).toHaveValue('0.80')
    await page.keyboard.press('Control+s')
    await expect.poll(async () => (await readTrades(dataDir)).map((x) => [x.notes, x.lots])).toEqual([['notatka z B', 0.8]])

    // 3) "Always ask": a change with no local edits waits; keep mine – PC-B's version stays in the history.
    await page.getByTestId('nav-settings').click()
    await page.getByRole('radiogroup', { name: 'Zmiany z drugiego komputera' }).getByRole('radio', { name: 'Zawsze pytaj przed przyjęciem zmian' }).click()
    await page.keyboard.press('Control+s')
    await page.getByTestId('nav-journal').click()
    await remoteEdit(page, dataDir, t, { notes: 'jeszcze z B' }, '2026-10-05T10:10:00.000Z')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTestId('remote-item')).toContainText('bez Twoich zmian')
    await dialog.getByRole('radio', { name: 'Zachowaj moją wersję' }).click()
    await dialog.getByTestId('remote-apply').click()
    await expect.poll(async () => (await readTrades(dataDir)).map((x) => x.notes)).toEqual(['notatka z B'])
    await page.getByTestId('journal-row').first().dblclick()
    await page.getByTestId('history-open').click()
    await expect(page.getByTestId('history-version').first()).toContainText('PC-B')
    await page.keyboard.press('Escape')

    // "Później" hides the dialog; the top bar keeps the count until the decision.
    await remoteEdit(page, dataDir, t, { notes: 'i znowu z B' }, '2026-10-05T10:15:00.000Z')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Później' }).click()
    await expect(page.getByTestId('remote-chip')).toHaveText('Zmiany z drugiego komputera: 1')
    await page.getByTestId('remote-chip').click()
    await dialog.getByTestId('remote-apply').click()
    await expect(page.getByTestId('trade-notes')).toHaveValue('i znowu z B')
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})
