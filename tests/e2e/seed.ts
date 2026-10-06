import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ElectronApplication } from '@playwright/test'
import { DataStore } from '../../src/main/datastore/store'
import { createDefaultJournal, createTrade } from '../../src/shared/defaults'
import { serializeRecord } from '../../src/shared/records'
import { dayRelPath, tradeRelPath } from '../../src/shared/paths'
import type { DayPlan, JournalFile, Trade } from '../../src/shared/schema'

/** A closed EURUSD long with SL 10 pips and the given result in R (risk 1%), entered at 12:00 UTC. */
export function closedTrade(date: string, r: number, over: Partial<Trade> = {}): Trade {
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

/** A data folder (temporary) with the given journal, trades and day plans written as files. */
export async function seed(trades: Trade[], journal: JournalFile = createDefaultJournal(), days: DayPlan[] = [], dir?: string): Promise<string> {
  const root = dir ?? join(await fs.mkdtemp(join(tmpdir(), 'ictj-seed-')), 'Dziennik')
  await DataStore.initialize(root, journal)
  for (const t of trades) {
    const rel = tradeRelPath(t)
    await fs.mkdir(join(root, rel, '..'), { recursive: true })
    await fs.writeFile(join(root, rel), serializeRecord('trades', t, { settings: journal.settings }))
  }
  for (const d of days) {
    const rel = dayRelPath(d.date)
    await fs.mkdir(join(root, rel, '..'), { recursive: true })
    await fs.writeFile(join(root, rel), serializeRecord('days', d))
  }
  return root
}

/** Trade files of a year, parsed (dot files and temp files skipped). */
export async function readTrades(root: string, year = '2026'): Promise<Trade[]> {
  const out: Trade[] = []
  const dir = join(root, 'trades', year)
  for (const name of await fs.readdir(dir).catch(() => [])) if (name.endsWith('.json') && !name.startsWith('.')) out.push(JSON.parse(await fs.readFile(join(dir, name), 'utf8')))
  return out
}

/** The save dialog answers with `save` ({name} = the proposed file name). */
export async function stubSaveDialog(app: ElectronApplication, save: string): Promise<void> {
  await app.evaluate(({ dialog }, path) => {
    const d = dialog as unknown as Record<string, unknown>
    d.showSaveDialog = async (_w: unknown, opts: { defaultPath?: string }) => ({ canceled: false, filePath: path.replace('{name}', opts?.defaultPath ?? 'plik') })
  }, save)
}

/** Day plan files, parsed. */
export async function readDays(root: string, year = String(new Date().getUTCFullYear())): Promise<DayPlan[]> {
  const out: DayPlan[] = []
  const dir = join(root, 'days', year)
  for (const name of await fs.readdir(dir).catch(() => [])) if (name.endsWith('.json') && !name.startsWith('.')) out.push(JSON.parse(await fs.readFile(join(dir, name), 'utf8')))
  return out
}
