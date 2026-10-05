import { promises as fs, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, test, type ElectronApplication } from '@playwright/test'
import { DataStore } from '../../src/main/datastore/store'
import { createDefaultJournal, createTrade } from '../../src/shared/defaults'
import { serializeRecord } from '../../src/shared/records'
import { tradeRelPath } from '../../src/shared/paths'
import type { JournalFile, Trade } from '../../src/shared/schema'
import { launch } from './app'

/** A closed EURUSD long with SL 10 pips and the given result in R (risk 1%). */
function closedTrade(date: string, r: number, over: Partial<Trade> = {}): Trade {
  return createTrade({
    pair: 'EURUSD',
    direction: 'long',
    entryTime: `${date}T12:00:00.000Z`,
    riskPercent: 1,
    prices: { entry: 1.08, stopLoss: 1.079, takeProfit1: 1.083, takeProfit2: null },
    exits: [{ id: '01K6H3Z0W8Q4M2N5P7R9S1T3V5', time: `${date}T15:00:00.000Z`, price: Number((1.08 + r * 0.001).toFixed(5)), percent: 100, note: '' }],
    ...over
  })
}

async function seed(trades: Trade[], journal: JournalFile = createDefaultJournal()): Promise<string> {
  const root = join(await fs.mkdtemp(join(tmpdir(), 'ictj-tools-')), 'Dziennik')
  await DataStore.initialize(root, journal)
  for (const t of trades) {
    const rel = tradeRelPath(t)
    await fs.mkdir(join(root, rel, '..'), { recursive: true })
    await fs.writeFile(join(root, rel), serializeRecord('trades', t, { settings: journal.settings }))
  }
  return root
}

test('prognoza: „Weź z moich wyników” – zwrot i miesiące stratne z dziennika', async () => {
  // January +2%, February −1%, March +3% (R × 1%).
  const dataDir = await seed([closedTrade('2026-01-15', 2), closedTrade('2026-02-16', -1), closedTrade('2026-03-16', 3)])
  const { app, page, errors } = await launch({ dataDir })
  try {
    await expect(page.getByTestId('journal-row')).toHaveCount(3)
    await page.keyboard.press('Control+7')
    await page.getByTestId('fc-create-first').click()
    await page.getByTestId('fc-history').click()
    await expect(page.getByTestId('fc-history-preview')).toContainText(
      'Z 3 miesięcy (2026-01 – 2026-03): średnio 1.33% / mies.; miesiące zyskowne 2.00% – 3.00%; stratne 33.30% miesięcy, strata 1.00% – 1.00%.'
    )
    await page.getByTestId('fc-history-apply').click()
    await expect(page.getByRole('radiogroup', { name: 'Rodzaj zwrotu' }).getByRole('radio', { name: 'Losowy z zakresu', exact: true })).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByTestId('fc-pct-lo')).toHaveValue('2')
    await expect(page.getByTestId('fc-pct-hi')).toHaveValue('3')
    await expect(page.getByTestId('fc-loss-prob')).toHaveValue('33.3')
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})

test('prognoza: „Weź z moich wyników” przy za małej liczbie miesięcy', async () => {
  const dataDir = await seed([closedTrade('2026-03-10', 1)])
  const { app, page, errors } = await launch({ dataDir })
  try {
    await expect(page.getByTestId('journal-row')).toHaveCount(1)
    await page.keyboard.press('Control+7')
    await page.getByTestId('fc-create-first').click()
    await page.getByTestId('fc-history').click()
    await expect(page.getByTestId('fc-history-preview')).toHaveText('Za mało danych: potrzeba co najmniej 3 miesięcy z zamkniętymi transakcjami (jest 1).')
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})

async function stubSaveDialog(app: ElectronApplication, save: string): Promise<void> {
  await app.evaluate(({ dialog }, path) => {
    const d = dialog as unknown as Record<string, unknown>
    d.showSaveDialog = async (_w: unknown, opts: { defaultPath?: string }) => ({ canceled: false, filePath: path.replace('{name}', opts?.defaultPath ?? 'plik') })
  }, save)
}

test('raport miesięczny: wynik w R i PLN, wybór miesiąca, markdown do schowka, pliki .md i PDF', async () => {
  const journal = createDefaultJournal()
  const tag = journal.dictionaries.mistakeTags[0]!
  const psychology = { ...closedTrade('2026-03-12', -1).psychology, mistakeTagIds: [tag.id] }
  const dataDir = await seed(
    [
      closedTrade('2026-02-16', 1, { riskAmount: 50, amountCurrency: 'PLN' }),
      closedTrade('2026-03-10', 2, { riskAmount: 100, amountCurrency: 'PLN' }),
      closedTrade('2026-03-12', -1, { riskAmount: 100, amountCurrency: 'PLN', psychology })
    ],
    journal
  )
  const { app, page, errors } = await launch({ dataDir })
  const out = await fs.mkdtemp(join(tmpdir(), 'ictj-report-out-'))
  try {
    await expect(page.getByTestId('journal-row')).toHaveCount(3)
    await page.keyboard.press('Control+3')
    const bar = page.getByTestId('monthly-report')
    await expect(bar.getByTestId('report-month')).toHaveValue('2026-03')
    await expect(bar.getByTestId('report-lead')).toHaveText('Wynik: +1.00R · +100.00 PLN')
    await bar.getByTestId('report-month').selectOption('2026-02')
    await expect(bar.getByTestId('report-lead')).toHaveText('Wynik: +1.00R · +50.00 PLN')
    await bar.getByTestId('report-month').selectOption('2026-03')

    await bar.getByTestId('report-copy').click()
    await expect.poll(async () => app.evaluate(({ clipboard }) => clipboard.readText())).toContain('# Raport miesięczny – marzec 2026')
    const copied = await app.evaluate(({ clipboard }) => clipboard.readText())
    expect(copied).toContain(`| ${tag.name} | 1 | −1.00R | −3.00R |`)
    expect(copied).toContain('| EURUSD | 2 | 50.0% | +1.00R | +100.00 PLN |')

    await stubSaveDialog(app, join(out, '{name}'))
    await bar.getByTestId('report-md').click()
    await expect.poll(async () => (await fs.readdir(out)).includes('raport_2026-03.md'), { timeout: 8000 }).toBe(true)
    expect(await fs.readFile(join(out, 'raport_2026-03.md'), 'utf8')).toBe(copied)

    await bar.getByTestId('report-pdf').click()
    await expect.poll(async () => (await fs.readdir(out)).includes('raport_2026-03.pdf'), { timeout: 15000 }).toBe(true)
    const pdf = await fs.readFile(join(out, 'raport_2026-03.pdf'))
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(pdf.length).toBeGreaterThan(5000)
    // The hidden PDF window is gone; only the main window is left.
    await expect.poll(async () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})

async function readTrades(root: string): Promise<Trade[]> {
  const out: Trade[] = []
  const year = join(root, 'trades', '2026')
  for (const name of await fs.readdir(year).catch(() => [])) if (name.endsWith('.json') && !name.startsWith('.')) out.push(JSON.parse(await fs.readFile(join(year, name), 'utf8')))
  return out
}

test('import historii od brokera (raport MT4, UTF-16): dopasowanie, uzupełnienie wpisu, nowy wpis, ponowny import bez dubli', async () => {
  const journal = createDefaultJournal()
  journal.settings.pairs = [...journal.settings.pairs, { ...journal.settings.pairs.find((p) => p.symbol === 'EURUSD')!, symbol: 'GBPUSD', tvSymbol: 'FX:GBPUSD' }]
  const open = createTrade({
    pair: 'EURUSD',
    direction: 'long',
    status: 'open',
    entryTime: '2026-10-01T11:31:00.000Z', // the broker: 14:30 server time = 07:30 NY = 11:30 UTC
    prices: { entry: 1.085, stopLoss: 1.0835, takeProfit1: null, takeProfit2: null }
  })
  const other = createTrade({ pair: 'AUDUSD', direction: 'long', entryTime: '2026-10-02T09:00:00.000Z' })
  const dataDir = await seed([open, other], journal)
  // MetaTrader 5 saves reports in UTF-16 LE with a BOM; the statement is the MT4 one from the unit tests.
  const html = readFileSync(resolve('tests/fixtures/broker-mt4-statement.htm'), 'utf8')
  const file = join(await fs.mkdtemp(join(tmpdir(), 'ictj-broker-')), 'Statement.htm')
  await fs.writeFile(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(html, 'utf16le')]))

  const { app, page, errors } = await launch({ dataDir })
  try {
    await expect(page.getByTestId('journal-row')).toHaveCount(2)
    await app.evaluate(({ dialog }, path) => {
      ;(dialog as unknown as Record<string, unknown>).showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    }, file)
    await page.getByTestId('nav-settings').click()
    await page.getByTestId('settings-tab-transfer').click()
    const panel = page.getByTestId('broker-import')
    await panel.getByTestId('broker-pick').click()
    await expect(panel.getByTestId('broker-summary')).toContainText('Statement.htm')
    await expect(panel.getByTestId('broker-summary')).toContainText('MetaTrader 4')
    await expect(panel.getByTestId('broker-summary')).toContainText('2 pozycje (1 partial scalony)')
    await expect(panel.getByTestId('broker-summary')).toContainText('pominięte wiersze: 2')
    await expect(panel.getByTestId('broker-currency')).toHaveValue('USD')
    const rows = panel.getByTestId('broker-row')
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0)).toHaveAttribute('data-status', 'matched')
    await expect(rows.nth(0)).toContainText('2026-10-01 07:31 · Δ +1 min')
    await expect(rows.nth(0)).toContainText('+146.50 USD')
    await expect(rows.nth(1)).toHaveAttribute('data-status', 'new')
    await expect(rows.nth(1)).toContainText('(2 części)')
    await expect(panel.getByTestId('broker-journal-only')).toContainText('1')

    // Matched positions are selected by default; new entries on request.
    await expect(panel.getByTestId('broker-apply')).toHaveText('Zastosuj: uzupełnij 1, utwórz 0')
    await panel.getByTestId('broker-select-new').click()
    await expect(panel.getByTestId('broker-apply')).toHaveText('Zastosuj: uzupełnij 1, utwórz 1')
    await panel.getByTestId('broker-apply').click()
    await expect(rows.nth(0)).toHaveAttribute('data-status', 'imported')
    await expect(rows.nth(1)).toHaveAttribute('data-status', 'imported')
    await expect(panel.getByTestId('broker-apply')).toBeDisabled()

    // On disk: the open entry is closed and filled, the GBPUSD position became a new entry.
    await expect.poll(async () => (await readTrades(dataDir)).filter((t) => t.broker).length, { timeout: 8000 }).toBe(2)
    const saved = await readTrades(dataDir)
    const filled = saved.find((t) => t.id === open.id)!
    expect(filled).toMatchObject({ status: 'closed', lots: 0.5, pnlAmountOverride: 146.5, amountCurrency: 'USD' })
    expect(filled.prices).toMatchObject({ entry: 1.085, stopLoss: 1.0835, takeProfit1: 1.088 })
    expect(filled.exits.map((x) => [x.time, x.price, x.percent])).toEqual([['2026-10-01T14:45:10.000Z', 1.088, 100]])
    expect(filled.broker).toMatchObject({ tickets: ['50001'], net: 146.5, commission: -3.5, currency: 'USD' })
    const created = saved.find((t) => t.pair === 'GBPUSD')!
    expect(created).toMatchObject({ direction: 'short', status: 'closed', entryTime: '2026-10-02T12:00:00.000Z', lots: 1, pnlAmountOverride: 256.1 })
    expect(created.exits.map((x) => x.percent)).toEqual([50, 50])
    expect(saved.find((t) => t.id === other.id)!.broker ?? null).toBeNull()

    // The entry shows the broker's numbers.
    await rows.nth(0).getByTestId('broker-linked').click()
    await expect(page.getByTestId('trade-broker')).toContainText('#50001')
    await expect(page.getByTestId('trade-broker')).toContainText('netto +146.50 USD (prowizja −3.50 USD)')

    // A second import of the same file finds both positions already imported.
    await page.getByTestId('nav-settings').click()
    await page.getByTestId('settings-tab-transfer').click()
    await page.getByTestId('broker-pick').click()
    await expect(page.getByTestId('broker-row')).toHaveCount(2)
    await expect(page.locator('[data-testid="broker-row"][data-status="imported"]')).toHaveCount(2)
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})
