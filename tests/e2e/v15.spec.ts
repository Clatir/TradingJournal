import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DateTime } from 'luxon'
import { expect, test } from '@playwright/test'
import { createDefaultJournal } from '../../src/shared/defaults'
import { launch } from './app'
import { closedTrade, seed, stubSaveDialog } from './seed'

const shots = (name: string) => join('test-results', 'screens', `${name}.png`)
const todayNy = () => DateTime.now().setZone('America/New_York').toISODate()!

test('cele i limity: tydzień w pasku górnym, pytanie przy nowej transakcji po przekroczeniu limitu dziennego', async () => {
  const today = todayNy()
  // −2R today = the default daily loss limit (2R).
  const dataDir = await seed([closedTrade(today, -1), closedTrade(today, -1)])
  const { app, page, errors } = await launch({ dataDir })
  try {
    await expect(page.getByTestId('journal-row')).toHaveCount(2)
    await page.keyboard.press('Control+6')
    await page.getByTestId('goal-week-target').fill('3')
    await page.getByTestId('goal-week-target').press('Tab')
    await page.getByTestId('goal-daily-percent').fill('1.5')
    await page.getByTestId('goal-daily-percent').press('Tab')
    await expect(page.getByTestId('goal-week')).toContainText('/3R')
    await expect(page.getByTestId('goal-week')).toContainText('2.0R')
    await expect(page.getByTestId('goal-day-percent')).toHaveText('−2.0%/−1.5%')
    await expect(page.getByTestId('goals-status')).toBeVisible()
    await expect
      .poll(async () => JSON.parse(await fs.readFile(join(dataDir, 'journal.json'), 'utf8')).settings.goals, { timeout: 8000 })
      .toMatchObject({ weeklyTargetR: 3, dailyLossPercent: 1.5, ask: true })

    // Over the limit: a question first; "Kończę na dziś" adds nothing.
    await page.keyboard.press('Control+n')
    await expect(page.getByTestId('limit-prompt')).toBeVisible()
    await expect(page.getByTestId('limit-prompt')).toContainText('Dzienny limit straty')
    await page.screenshot({ path: shots('74-limit-pytanie') })
    await page.getByTestId('limit-stop').click()
    await expect(page.getByTestId('limit-prompt')).toHaveCount(0)
    await expect(page.getByTestId('trade-editor')).toHaveCount(0)

    await page.keyboard.press('Control+n')
    await page.getByTestId('limit-continue').click()
    await expect(page.getByTestId('trade-editor')).toBeVisible()

    // Asking can be switched off.
    await page.keyboard.press('Control+6')
    await page.getByTestId('goal-ask').uncheck()
    await page.keyboard.press('Control+n')
    await expect(page.getByTestId('trade-editor')).toBeVisible()
    await expect(page.getByTestId('limit-prompt')).toHaveCount(0)
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})

test('raporty: rok z wybranymi sekcjami (porównanie, PIT-38), podgląd, markdown', async () => {
  const journal = createDefaultJournal()
  journal.settings.risk.accountCurrency = 'PLN'
  const dataDir = await seed(
    [
      closedTrade('2025-11-12', 1, { riskAmount: 100, amountCurrency: 'PLN' }),
      closedTrade('2026-02-16', 1, { riskAmount: 50, amountCurrency: 'PLN' }),
      closedTrade('2026-03-10', 2, { riskAmount: 100, amountCurrency: 'PLN' }),
      closedTrade('2026-03-12', -1, { riskAmount: 100, amountCurrency: 'PLN' })
    ],
    journal
  )
  const { app, page, errors } = await launch({ dataDir })
  const out = await fs.mkdtemp(join(tmpdir(), 'ictj-report-year-'))
  try {
    await expect(page.getByTestId('journal-row')).toHaveCount(4)
    await page.keyboard.press('Control+9')
    const r = page.getByTestId('reports')
    await r.getByRole('radio', { name: 'Rok' }).click()
    await r.getByTestId('report-year').selectOption('2026')
    await expect(r.getByTestId('report-lead')).toHaveText('Wynik: +2.00R · +150.00 PLN')
    await expect(r.getByTestId('report-section-tax')).not.toBeChecked()
    await r.getByTestId('report-all').click()
    await expect(r.getByTestId('report-section-tax')).toBeChecked()
    const preview = r.getByTestId('report-preview')
    await expect(preview).toContainText('Porównanie z poprzednim okresem (2025)')
    await expect(preview).toContainText('PIT-38 – zestawienie orientacyjne (2026, wg daty zamknięcia)')
    await expect(preview).toContainText('Lista transakcji')
    // Only the chosen ones, in the report order.
    await r.getByTestId('report-section-trades').uncheck()
    await expect(preview).not.toContainText('Lista transakcji')
    await r.getByTestId('report-section-tax').scrollIntoViewIfNeeded()
    await page.screenshot({ path: shots('75-raporty') })

    await r.getByTestId('report-copy').click()
    await expect.poll(async () => app.evaluate(({ clipboard }) => clipboard.readText())).toContain('# Raport – 2026')
    const md = await app.evaluate(({ clipboard }) => clipboard.readText())
    expect(md).toContain('| Przychód (suma zysków) | 250.00 PLN |')
    expect(md).toContain('| Koszty (suma strat) | 100.00 PLN |')
    expect(md).not.toContain('## Lista transakcji')

    await stubSaveDialog(app, join(out, '{name}'))
    await r.getByTestId('report-md').click()
    await expect.poll(async () => (await fs.readdir(out)).includes('raport_2026.md'), { timeout: 8000 }).toBe(true)

    // Quarter.
    await r.getByRole('radio', { name: 'Kwartał' }).click()
    await r.getByTestId('report-quarter').selectOption('2026-1')
    await expect(r.getByTestId('report-lead')).toHaveText('Wynik: +2.00R · +150.00 PLN')
    await expect(r.getByTestId('report-preview').getByRole('heading', { level: 1 })).toHaveText('Raport – I kw. 2026')
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})

test('analityka: PLN w rozbiciach i kalendarzu, porównanie okresów', async () => {
  const journal = createDefaultJournal()
  journal.settings.risk.accountCurrency = 'PLN'
  journal.settings.display.showMoney = true
  const today = todayNy()
  const lastYear = String(Number(today.slice(0, 4)) - 1)
  const dataDir = await seed(
    [
      closedTrade(today, 2, { riskAmount: 100, amountCurrency: 'PLN' }),
      closedTrade(today, -1, { riskAmount: 100, amountCurrency: 'PLN', pair: 'AUDUSD' }),
      closedTrade(`${lastYear}-06-10`, -1, { riskAmount: 100, amountCurrency: 'PLN' })
    ],
    journal
  )
  const { app, page, errors } = await launch({ dataDir })
  try {
    await expect(page.getByTestId('journal-row')).toHaveCount(3)
    await page.keyboard.press('Control+3')
    await expect(page.getByTestId('analytics')).toBeVisible()
    await expect(page.getByTestId('group-pln').first()).toBeVisible()
    await expect(page.getByTestId('group-row').filter({ hasText: 'AUDUSD' }).getByTestId('group-pln')).toContainText('100.00')

    const cmp = page.getByTestId('compare')
    await cmp.scrollIntoViewIfNeeded()
    await cmp.getByRole('radio', { name: 'Rok' }).click()
    await expect(cmp.getByTestId('compare-a')).toHaveText(today.slice(0, 4))
    await expect(cmp.getByTestId('compare-b')).toHaveText(lastYear)
    await expect(cmp.getByTestId('compare-row').filter({ hasText: 'Transakcje' })).toContainText('2')
    await expect(cmp.getByTestId('compare-row').filter({ hasText: 'Wynik w PLN' })).toContainText('100.00')
    await page.screenshot({ path: shots('76-porownanie') })

    await page.getByRole('radio', { name: 'PLN', exact: true }).click()
    await expect(page.getByText('Kalendarz wyników (Σ PLN dziennie)')).toBeVisible()
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})

test('ponowne otwarcie zamkniętej pozycji: kontynuacja bierze killzone z pierwszego wejścia do końca dnia NY', async () => {
  // First entry 08:00 NY (New York killzone), closed 11:00 NY; a re-entry 15:00 NY (21:00 Warsaw) not linked yet.
  const first = closedTrade('2026-10-06', 1)
  const loose = closedTrade('2026-10-06', -1, {
    entryTime: '2026-10-06T19:00:00.000Z',
    exits: [{ id: '01K6H3Z0W8Q4M2N5P7R9S1T3V6', time: '2026-10-06T20:00:00.000Z', price: 1.079, percent: 100, note: '' }]
  })
  const dataDir = await seed([first, loose])
  const { app, page, errors } = await launch({ dataDir })
  try {
    await expect(page.getByTestId('journal-row')).toHaveCount(2)
    await page.getByTestId('journal-row').filter({ hasText: '15:00' }).dblclick()
    await expect(page.getByTestId('rule-killzone')).toHaveAttribute('data-status', 'fail')
    // Suggested: the same pair and direction closed earlier the same NY day.
    await expect(page.getByTestId('continuation-suggest')).toContainText('EURUSD long zamknięta dziś o 11:00 NY')
    await page.getByTestId('continuation-accept').click()
    await expect(page.getByTestId('continuation-status')).toContainText('Kontynuacja transakcji z 08:00 NY')
    await expect(page.getByTestId('rule-killzone')).toHaveAttribute('data-status', 'pass')
    await expect(page.getByTestId('rule-killzone')).toContainText('kontynuacja wejścia z New York (08:00 NY)')
    const file = join(dataDir, 'trades', '2026', `2026-10-06_EURUSD_${loose.id}.json`)
    await expect.poll(async () => JSON.parse(await fs.readFile(file, 'utf8')).continuationOf, { timeout: 8000 }).toBe(first.id)
    await expect.poll(async () => JSON.parse(await fs.readFile(file, 'utf8')).computed.brokenRules, { timeout: 8000 }).toEqual([])
    await page.screenshot({ path: shots('77-kontynuacja') })

    // The first trade lists its re-entry; "Otwórz ponownie" creates another one, linked.
    await page.getByTestId('continuation-open').click()
    await expect(page.getByTestId('continuation-child')).toHaveCount(1)
    await page.getByTestId('reopen-trade').click()
    await expect(page.getByTestId('continuation-info')).toBeVisible()
    await expect(page.getByTestId('price-sl')).toHaveValue('1.07900')
    await page.getByTestId('entry-time-NY-date').fill('2026-10-06')
    await page.getByTestId('entry-time-NY-date').press('Enter')
    await page.getByTestId('entry-time-NY-time').fill('2330')
    await page.getByTestId('entry-time-NY-time').press('Enter')
    await expect(page.getByTestId('rule-killzone')).toHaveAttribute('data-status', 'pass')
    // The next NY day is a new entry.
    await page.getByTestId('entry-time-NY-date').fill('2026-10-07')
    await page.getByTestId('entry-time-NY-date').press('Enter')
    await page.getByTestId('entry-time-NY-time').fill('1200')
    await page.getByTestId('entry-time-NY-time').press('Enter')
    await expect(page.getByTestId('continuation-status')).toContainText('Nie liczy się jako kontynuacja: otwarta ponownie po dniu handlowym NY zamknięcia (2026-10-06)')
    await expect(page.getByTestId('rule-killzone')).toHaveAttribute('data-status', 'fail')
    await page.getByTestId('continuation-clear').click()
    await expect(page.getByTestId('continuation-info')).toHaveCount(0)

    await page.keyboard.press('Control+1')
    await expect(page.getByTestId('row-continuation')).toHaveCount(1)
    await page.keyboard.press('Control+3')
    await expect(page.getByTestId('reopen-breakdown')).toContainText('Ponowne otwarcie')
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})
