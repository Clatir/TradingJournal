import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, test, type Page } from '@playwright/test'
import { tradeRelPath } from '../../src/shared/paths'
import type { Trade } from '../../src/shared/schema'
import { createDayPlan, createDefaultJournal, createTrade } from '../../src/shared/defaults'
import { setPairField, startSession, stopSession } from '../../src/shared/calc/sessions'
import { shiftTradingDay, tradingDateNy, weekdayNy } from '../../src/shared/calc/time'
import { newId } from '../../src/shared/ids'
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

test('szablony planu dnia: zapis planu jako szablonu, wstawienie do innego dnia, szablon domyślny dla nowych planów', async () => {
  const dataDir = await seed([])
  const { app, page, errors } = await launch({ dataDir })
  try {
    const goTo = async (date: string) => {
      await page.getByTestId('day-date').fill(date)
      await page.getByTestId('day-date').press('Enter')
      await expect(page.getByTestId('day-date')).toHaveValue(date)
    }
    await expect(page.getByTestId('journal-table')).toBeVisible()
    await page.keyboard.press('Control+d')
    await goTo('2026-10-05')
    await page.getByTestId('scenario-primary').fill('sweep Asia low → long z FVG')
    await page.getByTestId('template-menu').click()
    await page.getByTestId('template-name').fill('London')
    await page.getByTestId('template-save').click()
    await expect(page.getByTestId('template-row')).toHaveCount(1)
    await page.keyboard.press('Escape')

    // Another day: insert the template – the empty scenario gets filled.
    await goTo('2026-10-07')
    await expect(page.getByTestId('scenario-primary')).toHaveValue('')
    await page.getByTestId('template-menu').click()
    await page.getByTestId('template-apply').click()
    await expect(page.getByTestId('scenario-primary')).toHaveValue('sweep Asia low → long z FVG')

    // Default template: every new plan starts from it.
    await page.getByTestId('template-menu').click()
    await page.getByTestId('template-default').click()
    await expect(page.getByTestId('template-default')).toHaveText('★')
    await page.getByTestId('template-menu').click()
    await expect(page.getByTestId('template-panel')).toHaveCount(0)
    await goTo('2026-10-09')
    await expect(page.getByTestId('scenario-primary')).toHaveValue('sweep Asia low → long z FVG')
    await page.keyboard.press('Control+k')
    await page.keyboard.type('wstaw szablon')
    await expect(page.getByText('Plan dnia (dziś): wstaw szablon „London”')).toBeVisible()
    await page.keyboard.press('Escape')
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})

test('samopoczucie: pytanie rano (dni handlowe) albo plan dnia, analityka wyniku wg snu, energii i stresu', async () => {
  const nowIso = new Date().toISOString()
  const today = tradingDateNy(nowIso)
  const trade = createTrade({
    pair: 'EURUSD',
    direction: 'long',
    entryTime: new Date(Date.now() - 60_000).toISOString(),
    prices: { entry: 1.08, stopLoss: 1.079, takeProfit1: null, takeProfit2: null },
    exits: [{ id: '01K6H3Z0W8Q4M2N5P7R9S1T3V5', time: nowIso, price: 1.082, percent: 100, note: '' }]
  })
  const dataDir = await seed([trade])
  const { app, page, errors } = await launch({ dataDir })
  try {
    await expect(page.getByTestId('journal-table')).toBeVisible()
    const prompt = page.getByTestId('wellbeing-prompt')
    if (weekdayNy(`${today}T12:00:00.000Z`) <= 5) {
      await expect(prompt).toBeVisible()
      await prompt.getByTestId('wb-sleep').fill('6.5')
      await prompt.getByTestId('wb-sleep').blur()
      await prompt.getByRole('radiogroup', { name: 'Energia' }).getByRole('radio', { name: '4' }).click()
      await prompt.getByRole('radiogroup', { name: 'Stres' }).getByRole('radio', { name: '2' }).click()
      await expect(prompt).toHaveCount(0)
    } else {
      // Weekend: no morning question; the day plan has the same fields.
      await expect(prompt).toHaveCount(0)
      await page.keyboard.press('Control+d')
      await page.getByTestId('wb-sleep').fill('6.5')
      await page.getByTestId('wb-sleep').blur()
      await page.getByRole('radiogroup', { name: 'Energia' }).getByRole('radio', { name: '4' }).click()
      await page.getByRole('radiogroup', { name: 'Stres' }).getByRole('radio', { name: '2' }).click()
    }
    await expect
      .poll(async () => (await readDays(dataDir, today.slice(0, 4))).find((d) => d.date === today)?.wellbeing)
      .toMatchObject({ sleepHours: 6.5, energy: 4, stress: 2 })
    await page.keyboard.press('Control+3')
    const sleep = page.getByTestId('wb-sleep-table')
    await expect(sleep).toContainText('6–7 h')
    await expect(sleep.getByText('6–7 h').locator('..')).toContainText('100%')
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})

test('mapa godzin: dzień tygodnia × godzina wejścia NY, miary Σ R, win rate i błędy', async () => {
  const journal = createDefaultJournal()
  const mistake = journal.dictionaries.mistakeTags[0]!.id
  // 12:00 UTC = 08:00 NY (EDT). Two Mondays in one cell, a Wednesday 09:00 NY with a mistake tag.
  const trades = [
    closedTrade('2026-09-14', 2),
    closedTrade('2026-09-21', -1),
    closedTrade('2026-09-16', 3, { entryTime: '2026-09-16T13:00:00.000Z', psychology: { ...closedTrade('2026-09-16', 3).psychology, mistakeTagIds: [mistake] } })
  ]
  const dataDir = await seed(trades, journal)
  const { app, page, errors } = await launch({ dataDir })
  try {
    await expect(page.getByTestId('journal-table')).toBeVisible()
    await page.keyboard.press('Control+3')
    const map = page.getByTestId('hour-heatmap')
    await expect(map.getByTestId('heat-cell')).toHaveCount(2)
    await expect(map.locator('title', { hasText: 'pon 08:00–09:00 NY · 2 tr.' })).toHaveCount(1)
    await expect(map.locator('title', { hasText: 'śr 09:00–10:00 NY · 1 tr.' })).toContainText('z błędem 1')
    await expect(map.getByTestId('heat-cell').first()).toContainText('1.0') // Σ R of Monday 08:00
    const metric = page.getByRole('radiogroup', { name: 'Miara mapy godzin' })
    await metric.getByRole('radio', { name: 'Win rate' }).click()
    await expect(map.getByTestId('heat-cell').first()).toContainText('50')
    await metric.getByRole('radio', { name: 'Błędy' }).click()
    await expect(map.getByTestId('heat-cell').nth(1)).toContainText('1')
    await expect(map.getByTestId('heat-cell').first()).toContainText('0')
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})

/** A 1×1 lossless WebP – enough for the image to load. */
const WEBP_1X1 = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64')

function screenAt(dataDir: string, phase: 'before' | 'after', files: string[]) {
  const id = newId()
  const path = `screens/2026/01/${id}_${phase}.webp`
  files.push(join(dataDir, path), join(dataDir, path.replace('.webp', '.thumb.webp')))
  return { id, path, thumbPath: path.replace('.webp', '.thumb.webp'), phase, timeframe: 'M15', caption: '', width: 160, height: 90, bytes: 44, createdAt: '2026-01-01T00:00:00.000Z', annotations: [] }
}

test('trening: screen „przed” bez wyniku, odpowiedź, odkrycie, podsumowanie i trafność w czasie', async () => {
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10)
  const files: string[] = []
  const root = await fs.mkdtemp(join(tmpdir(), 'ictj-drill-'))
  const dir = join(root, 'Dziennik')
  const shots = () => [screenAt(dir, 'before', files), screenAt(dir, 'after', files)]
  const trades = [
    closedTrade(daysAgo(20), 2, { screens: shots() }), // long winner
    closedTrade(daysAgo(21), -1, { screens: shots() }), // long loser
    closedTrade(daysAgo(22), 2, {
      direction: 'short',
      screens: shots(),
      prices: { entry: 1.08, stopLoss: 1.081, takeProfit1: 1.077, takeProfit2: null },
      exits: [{ id: '01K6H3Z0W8Q4M2N5P7R9S1T3V5', time: `${daysAgo(22)}T15:00:00.000Z`, price: 1.078, percent: 100, note: '' }]
    }),
    closedTrade(daysAgo(2), 2, { screens: shots() }), // fresh: hidden by "older than 7 days"
    closedTrade(daysAgo(3), 1, { screens: [screenAt(dir, 'after', files)] }) // no "before" screen: not a card
  ]
  const dataDir = await seed(trades, createDefaultJournal(), [], dir)
  for (const f of files) {
    await fs.mkdir(join(f, '..'), { recursive: true })
    await fs.writeFile(f, WEBP_1X1)
  }
  const { app, page, errors } = await launch({ dataDir })
  try {
    await expect(page.getByTestId('journal-table')).toBeVisible()
    await page.keyboard.press('Control+8')
    await expect(page.getByTestId('drill-page')).toBeVisible()
    // All trades by default; the age filter shows how many cards each option has.
    await expect(page.getByTestId('drill-available')).toContainText('4')
    await expect(page.getByRole('radiogroup', { name: 'Wiek transakcji' }).getByRole('radio', { name: 'starsze niż 7 dni (3)' })).toBeVisible()
    await expect(page.getByTestId('drill-no-before')).toContainText('1 transakcja ma wynik, ale bez screena w fazie „przed”')
    // Only fresh trades of a pair under an age filter: the page says why there is nothing.
    await page.getByRole('radiogroup', { name: 'Wiek transakcji' }).getByRole('radio', { name: 'starsze niż 30 dni' }).click()
    await expect(page.getByTestId('drill-available')).toContainText('0')
    await expect(page.getByTestId('drill-age-hint')).toContainText('4 kart jest nowszych niż 30 dni')
    await page.getByTestId('drill-age-hint').getByRole('button', { name: 'Pokaż wszystkie' }).click()
    await expect(page.getByTestId('drill-available')).toContainText('4')
    await page.getByRole('radiogroup', { name: 'Wiek transakcji' }).getByRole('radio', { name: 'starsze niż 7 dni' }).click()
    await expect(page.getByTestId('drill-available')).toContainText('3')
    await page.getByTestId('drill-start').click()

    const card = page.getByTestId('drill-card')
    for (let i = 1; i <= 3; i++) {
      await expect(page.getByTestId('drill-progress')).toHaveText(`Karta ${i} / 3`)
      // Before the answer: only the "before" screen, no result.
      await expect(card.getByRole('button', { name: /^po/ })).toHaveCount(0)
      await expect(page.getByTestId('drill-result')).toHaveCount(0)
      await expect(card.locator('img')).toBeVisible()
      if (i === 1) {
        await page.getByTestId('drill-sl').fill('10')
        await page.getByTestId('drill-sl').blur()
        await page.getByTestId('drill-answer-long').click()
      } else {
        await page.keyboard.press('l')
      }
      await expect(page.getByTestId('drill-reveal')).toBeVisible()
      await expect(page.getByTestId('drill-result')).toHaveText(/R$/)
      await expect(card.getByRole('button', { name: /^po/ })).toHaveCount(1)
      if (i === 1) await expect(page.getByTestId('drill-score')).toContainText('SL ±0')
      await page.keyboard.press('Enter')
    }
    // Long on everything: the long winner is right; the long loser and the short winner are wrong decisions.
    await expect(page.getByTestId('drill-summary')).toBeVisible()
    await expect(page.getByTestId('drill-summary-decision')).toHaveText('33%')
    await expect(page.getByTestId('drill-summary-row')).toHaveCount(3)

    await expect
      .poll(async () => {
        const names = await fs.readdir(join(dataDir, 'drills')).catch(() => [] as string[])
        const json = names.filter((n) => n.endsWith('.json'))
        if (json.length !== 1) return null
        const s = JSON.parse(await fs.readFile(join(dataDir, 'drills', json[0]!), 'utf8'))
        return { finished: !!s.finishedAt, answers: s.cards.map((c: { answer: string }) => c.answer), truths: s.cards.filter((c: { truth: unknown }) => c.truth).length }
      })
      .toEqual({ finished: true, answers: ['long', 'long', 'long'], truths: 3 })

    await page.getByRole('button', { name: 'Zamknij' }).click()
    const kpis = page.getByTestId('drill-kpis')
    await expect(kpis).toContainText('3 transakcji')
    await expect(kpis).toContainText('1 / 3') // decision
    await expect(kpis).toContainText('2 / 3') // direction
    await expect(page.getByTestId('drill-months').locator('.num').first()).toHaveText(/^\d{4}-\d{2}$/)
    await expect(page.getByTestId('drill-sessions').getByRole('button')).toHaveCount(1)

    // An abandoned session without answers is not written.
    await page.getByTestId('drill-start').click()
    await expect(page.getByTestId('drill-progress')).toHaveText('Karta 1 / 3')
    await page.keyboard.press('Control+1')
    await page.keyboard.press('Control+8')
    await expect(page.getByTestId('drill-available')).toBeVisible()
    await page.waitForTimeout(600)
    expect((await fs.readdir(join(dataDir, 'drills'))).filter((n) => n.endsWith('.json'))).toHaveLength(1)
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})

test('własne pola, kolumny i zapisane filtry dziennika; rozbicie w analityce', async () => {
  const trades = [
    closedTrade('2026-09-03', 2), // newest: EURUSD win
    closedTrade('2026-09-02', -1, { pair: 'GBPUSD' }),
    closedTrade('2026-09-01', 1)
  ]
  const dataDir = await seed(trades)
  const { app, page, errors } = await launch({ dataDir })
  try {
    await expect(page.getByTestId('journal-row')).toHaveCount(3)
    // Settings → dictionaries: a list field with two options and a number field.
    await page.getByTestId('nav-settings').click()
    await page.getByTestId('settings-tab-dictionaries').click()
    const cf = page.getByTestId('cf-settings')
    await page.getByTestId('cf-add-name').fill('Ocena setupu')
    await page.getByTestId('cf-add').click()
    await cf.getByTestId('cf-option-new').fill('A+')
    await cf.getByTestId('cf-option-new').press('Enter')
    await cf.getByTestId('cf-option-new').fill('B')
    await cf.getByTestId('cf-option-new').press('Enter')
    await page.getByTestId('cf-add-name').fill('Konfluencje')
    await page.getByRole('radiogroup', { name: 'Typ nowego pola' }).getByRole('radio', { name: 'Liczba' }).click()
    await page.getByTestId('cf-add').click()
    await expect(cf.getByTestId('cf-row')).toHaveCount(2)

    // The newest trade: A+ and 3 confluences.
    await page.keyboard.press('Control+1')
    await page.getByTestId('journal-row').first().dblclick()
    const fields = page.getByTestId('custom-fields')
    await fields.getByRole('radio', { name: 'A+' }).click()
    await fields.getByTestId('cf-Konfluencje').fill('3')
    await fields.getByTestId('cf-Konfluencje').blur()
    await expect
      .poll(async () => {
        const t = (await readTrades(dataDir)).find((x) => x.id === trades[0]!.id)
        return t ? Object.values(t.custom ?? {}).length : 0
      })
      .toBe(2)

    // Columns: show the custom field, hide the weekday.
    await page.keyboard.press('Control+1')
    await page.getByTestId('columns-button').click()
    await page.getByTestId('columns-panel').getByRole('checkbox', { name: 'Pokaż Ocena setupu' }).check()
    await page.getByTestId('columns-panel').getByRole('checkbox', { name: 'Pokaż Dz.' }).uncheck()
    await page.keyboard.press('Escape')
    const header = page.getByTestId('journal-header')
    await expect(header).toContainText('Ocena setupu')
    await expect(header).not.toContainText('Dz.')
    await expect(page.getByTestId('journal-row').first()).toContainText('A+')

    // Filter by the custom field and save it.
    await page.getByTestId('filters-button').click()
    await page.getByTestId('filters-panel').getByRole('combobox', { name: 'Ocena setupu' }).selectOption({ label: 'A+' })
    await expect(page.getByTestId('journal-row')).toHaveCount(1)
    await expect(page.getByTestId('filters-button')).toHaveText('Filtry (1)')
    await page.keyboard.press('Escape')
    await page.getByTestId('saved-filters').click()
    await page.getByTestId('saved-filter-name').fill('Setupy A+')
    await page.getByTestId('saved-filter-save').click()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('saved-filters')).toHaveText('★ Setupy A+')
    await page.getByTestId('filters-button').click()
    await page.getByTestId('filters-clear').click()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('journal-row')).toHaveCount(3)
    await expect(page.getByTestId('saved-filters')).toHaveText('Zapisane ▾')
    await page.getByTestId('saved-filters').click()
    await page.getByTestId('saved-filter-apply').click()
    await expect(page.getByTestId('journal-row')).toHaveCount(1)

    await expect
      .poll(async () => {
        const j = JSON.parse(await fs.readFile(join(dataDir, 'journal.json'), 'utf8'))
        return { filters: j.settings.savedFilters?.map((f: { name: string }) => f.name), columns: (j.settings.journalView?.columns ?? []).includes('weekday') }
      })
      .toEqual({ filters: ['Setupy A+'], columns: false })

    // Analytics: result by the custom field.
    await page.keyboard.press('Control+3')
    const custom = page.getByTestId('custom-breakdowns')
    await expect(custom).toContainText('Własne pole: Ocena setupu')
    await expect(custom).toContainText('A+')
    await expect(custom).toContainText('— brak —')
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})
