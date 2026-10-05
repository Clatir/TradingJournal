import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FolderStatus, RecordEntry, Snapshot } from '@shared/api'
import { createDefaultJournal, createTrade } from '@shared/defaults'
import type { Trade } from '@shared/schema'

// The renderer store talks to the main process through window.journal (preload); here it is a mock.
const api = {
  saveRecord: vi.fn(),
  saveJournal: vi.fn(),
  deleteRecord: vi.fn()
}
vi.stubGlobal('window', { journal: api })
const store = await import('../../src/renderer/store/journal')

const status = (readOnly = false): FolderStatus => ({
  dataDir: '/dane',
  available: true,
  readOnly,
  readOnlyReason: readOnly ? 'tylko odczyt' : null,
  folderSchemaVersion: 1,
  appSchemaVersion: 1,
  otherMachines: [],
  migratedFrom: null,
  backupPath: null,
  isSample: false
})

function load(trade: Trade, readOnly = false): void {
  const snapshot: Snapshot = {
    journal: createDefaultJournal('2026-01-01T00:00:00.000Z'),
    trades: [{ record: trade, relPath: `trades/2026/x_${trade.id}.json`, readOnly: false }],
    days: [],
    weeks: [],
    library: [],
    forecasts: [],
    problems: [],
    conflicts: [],
    status: status(readOnly),
    loadMs: 0
  }
  store.applySnapshot(snapshot)
}

const trade = () => createTrade({ pair: 'EURUSD', direction: 'long', entryTime: '2026-03-16T07:30:00.000Z' })
const saved = (t: Trade): RecordEntry<Trade> => ({ record: { ...t, updatedAt: '2026-03-16T08:00:00.000Z' }, relPath: `trades/2026/x_${t.id}.json`, readOnly: false })

beforeEach(() => {
  vi.useFakeTimers()
  api.saveRecord.mockReset()
  api.saveJournal.mockReset()
  api.deleteRecord.mockReset()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('autozapis w rendererze', () => {
  it('nieudany zapis jest ponawiany sam, a zmiana nie przepada', async () => {
    const t = trade()
    load(t)
    api.saveRecord.mockRejectedValueOnce(new Error('EBUSY: plik zablokowany')).mockImplementation(async (_c: string, r: Trade) => saved(r))
    store.updateRecord('trades', t.id, (r) => ({ ...r, notes: 'ważna notatka' }))
    await vi.advanceTimersByTimeAsync(450)
    expect(api.saveRecord).toHaveBeenCalledTimes(1)
    expect(store.useJournal.getState().save.error).toContain('EBUSY')
    expect(store.hasUnsaved()).toBe(true)

    await vi.advanceTimersByTimeAsync(2100)
    expect(api.saveRecord).toHaveBeenCalledTimes(2)
    expect(api.saveRecord.mock.calls[1]?.[1].notes).toBe('ważna notatka')
    expect(store.hasUnsaved()).toBe(false)
    expect(store.useJournal.getState().save.error).toBeNull()
  })

  it('„ponów” / zamknięcie okna (flushSaves) zapisuje też zmiany po nieudanym zapisie', async () => {
    const t = trade()
    load(t)
    api.saveRecord.mockRejectedValueOnce(new Error('dysk niedostępny')).mockImplementation(async (_c: string, r: Trade) => saved(r))
    store.updateRecord('trades', t.id, (r) => ({ ...r, notes: 'x' }))
    await vi.advanceTimersByTimeAsync(450)
    expect(store.hasUnsaved()).toBe(true)
    await expect(store.flushSaves()).resolves.toBe(true)
    expect(api.saveRecord).toHaveBeenCalledTimes(2)
    expect(store.hasUnsaved()).toBe(false)
  })

  it('flushSaves zwraca false, gdy zapis wciąż się nie udaje (okno pyta przed zamknięciem)', async () => {
    const t = trade()
    load(t)
    api.saveRecord.mockRejectedValue(new Error('brak dostępu'))
    store.updateRecord('trades', t.id, (r) => ({ ...r, notes: 'x' }))
    await expect(store.flushSaves()).resolves.toBe(false)
    expect(store.hasUnsaved()).toBe(true)
  })

  it('w folderze tylko do odczytu edycje nie są przyjmowane (nie da się ich zapisać)', async () => {
    const t = trade()
    load(t, true)
    store.updateRecord('trades', t.id, (r) => ({ ...r, notes: 'x' }))
    await vi.advanceTimersByTimeAsync(3000)
    expect(api.saveRecord).not.toHaveBeenCalled()
    expect(store.useJournal.getState().trades[t.id]?.record.notes).toBe('')
  })

  it('wpis usunięty w trakcie zapisu nie wraca na listę', async () => {
    const t = trade()
    load(t)
    let finish: (v: RecordEntry<Trade>) => void = () => undefined
    api.saveRecord.mockImplementation((_c: string, r: Trade) => new Promise((resolve) => (finish = () => resolve(saved(r)))))
    api.deleteRecord.mockResolvedValue(undefined)
    store.updateRecord('trades', t.id, (r) => ({ ...r, notes: 'x' }))
    await vi.advanceTimersByTimeAsync(450)
    const deleting = store.deleteRecord('trades', t.id)
    finish(saved(t))
    await deleting
    expect(store.useJournal.getState().trades[t.id]).toBeUndefined()
    expect(api.deleteRecord).toHaveBeenCalledWith('trades', t.id)
  })
})
