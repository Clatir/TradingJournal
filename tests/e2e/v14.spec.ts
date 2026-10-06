import { expect, test } from '@playwright/test'
import { launch } from './app'
import { closedTrade, readTrades, seed } from './seed'

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
