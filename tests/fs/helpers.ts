import { mkdtempSync, promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DataStore } from '../../src/main/datastore/store'
import { createDefaultJournal, createTrade } from '@shared/defaults'
import type { Trade } from '@shared/schema'

export function tempDir(prefix = 'ictj-'): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

export async function freshStore(root = join(tempDir(), 'journal')): Promise<DataStore> {
  await DataStore.initialize(root, createDefaultJournal('2026-01-01T00:00:00.000Z'))
  const store = new DataStore(root, { machineName: 'TEST-PC' })
  await store.open()
  return store
}

export function sampleTrade(over: Partial<Trade> = {}): Trade {
  return createTrade({
    pair: 'EURUSD',
    direction: 'long',
    entryTime: '2026-03-16T07:30:00.000Z',
    prices: { entry: 1.085, stopLoss: 1.0835, takeProfit1: 1.088, takeProfit2: null },
    ...over
  })
}

export async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(path, 'utf8')) as Record<string, unknown>
}

export async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}
