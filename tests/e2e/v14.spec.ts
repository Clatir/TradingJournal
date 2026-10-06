import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { tradeRelPath } from '../../src/shared/paths'
import type { Trade } from '../../src/shared/schema'
import { createDayPlan, createDefaultJournal, createTrade } from '../../src/shared/defaults'
import { setPairField, startSession, stopSession } from '../../src/shared/calc/sessions'
import { shiftTradingDay, tradingDateNy } from '../../src/shared/calc/time'
import { launch } from './app'
import { closedTrade, readDays, readTrades, seed } from './seed'

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

test('sesje analizy: stoper, para w trakcie, decyzje z powodami, pytanie o odrzuconą parę, analityka, oznaczenie transakcji', async () => {
  const nowIso = new Date().toISOString()
  const today = tradingDateNy(nowIso)
  const yesterday = shiftTradingDay(today, -1)
  const journal = createDefaultJournal()
  const konsolidacja = journal.dictionaries.rejectReasons.find((r) => r.name === 'Konsolidacja')!
  // Yesterday: an ended session with a rejected pair not asked about yet.
  let past = stopSession(startSession('Przed NY', ['EURUSD', 'USDCHF'], `${yesterday}T12:00:00.000Z`, 'PC-B'), `${yesterday}T12:40:00.000Z`)
  past = setPairField(setPairField(past, 'USDCHF', 'decision', 'reject'), 'USDCHF', 'reasonIds', [konsolidacja.id])
  past = setPairField(past, 'EURUSD', 'decision', 'watch')
  const pastDay = { ...createDayPlan(yesterday, ['EURUSD', 'USDCHF'], []), sessions: [past] }
  const trade = createTrade({
    pair: 'EURUSD',
    direction: 'long',
    entryTime: new Date(Date.now() - 60_000).toISOString(),
    prices: { entry: 1.08, stopLoss: 1.079, takeProfit1: null, takeProfit2: null },
    exits: [{ id: '01K6H3Z0W8Q4M2N5P7R9S1T3V5', time: nowIso, price: 1.082, percent: 100, note: '' }]
  })
  const dataDir = await seed([trade], journal, [pastDay])
  const { app, page, errors } = await launch({ dataDir })
  try {
    // The rejected pair of yesterday is asked about.
    await expect(page.getByTestId('reviews-chip')).toHaveText('Pytania: 1')
    await page.getByTestId('reviews-chip').click()
    await expect(page.getByTestId('review-row')).toContainText('USDCHF')
    await expect(page.getByTestId('review-row')).toContainText('Konsolidacja')
    await page.getByTestId('review-nosetup').click()
    await expect(page.getByTestId('review-row')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('reviews-chip')).toHaveCount(0)

    // Today: stopwatch over the portfolio, EURUSD marked while analysing it.
    await page.getByTestId('timer-button').click()
    await page.getByTestId('timer-name').fill('Przed Londynem')
    await page.getByTestId('timer-start').click()
    await expect(page.getByTestId('timer-elapsed')).toBeVisible()
    await page.getByTestId('timer-button').click()
    await page.getByTestId('timer-pair-EURUSD').click()
    await expect(page.getByTestId('timer-button')).toContainText('EURUSD')
    await page.getByTestId('timer-stop').click()
    const dialog = page.getByTestId('decisions-dialog')
    await expect(dialog.getByTestId('decision-row')).toHaveCount(5)
    const row = (pair: string) => dialog.getByTestId('decision-row').filter({ hasText: pair })
    await row('EURUSD').getByRole('radio', { name: 'Handluję' }).click()
    await row('AUDUSD').getByRole('radio', { name: 'Odrzucam' }).click()
    await row('AUDUSD').getByRole('button', { name: 'Konsolidacja' }).click()
    await row('EURGBP').getByRole('radio', { name: 'Odrzucam' }).click()
    await row('EURAUD').getByRole('radio', { name: 'Obserwuję' }).click()
    await dialog.getByTestId('session-minutes').fill('45')
    await dialog.getByTestId('session-minutes').blur()
    await dialog.getByTestId('decisions-done').click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByTestId('timer-button')).toContainText('Analiza')

    await expect
      .poll(async () => {
        const day = (await readDays(dataDir, today.slice(0, 4))).find((d) => d.date === today)
        const s = day?.sessions[0]
        return s ? [s.name, s.minutesOverride, s.endedAt != null, s.decidedAt != null, s.segments.some((g) => g.pair === 'EURUSD'), s.pairs.map((p) => [p.pair, p.decision, p.reasonIds.length])] : null
      })
      .toEqual([
        'Przed Londynem',
        45,
        true,
        true,
        true,
        [
          ['AUDUSD', 'reject', 1],
          ['EURAUD', 'watch', 0],
          ['EURGBP', 'reject', 0],
          ['EURUSD', 'trade', 0],
          ['USDCHF', null, 0]
        ]
      ])
    expect((await readDays(dataDir, yesterday.slice(0, 4))).find((d) => d.date === yesterday)?.sessions[0]?.pairs.find((p) => p.pair === 'USDCHF')?.review).toBe('noSetup')

    // Day plan: the session with its decisions.
    await page.keyboard.press('Control+d')
    await expect(page.getByTestId('session-row')).toHaveCount(1)
    await expect(page.getByTestId('session-row')).toContainText('Przed Londynem')
    await expect(page.getByTestId('session-row')).toContainText('handluję 1 · obserwuję 1 · odrzucam 2')

    // The trade of today on EURUSD came from the session.
    await page.keyboard.press('Control+1')
    await page.getByTestId('journal-row').first().dblclick()
    await expect(page.getByTestId('trade-from-session')).toContainText('z analizy: Przed Londynem · handluję')

    // Analytics: time and selection.
    await page.keyboard.press('Control+3')
    const kpis = page.getByTestId('selection-kpis')
    await expect(kpis).toContainText('2 · 1 h 25 min')
    await expect(kpis).toContainText('7 → 3 → 1 → 1')
    await expect(page.getByTestId('selection-reasons')).toContainText('Konsolidacja')
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})
