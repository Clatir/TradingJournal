import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DataStore } from '../../src/main/datastore/store'
import { HISTORY_DIR, MAX_PER_RECORD } from '../../src/main/datastore/history'
import { exists, freshStore, sampleTrade } from './helpers'

/** A clock that moves forward by `stepMs` on every reading. */
function clock(startIso: string, stepMs: number): () => string {
  let t = Date.parse(startIso)
  return () => {
    const iso = new Date(t).toISOString()
    t += stepMs
    return iso
  }
}

async function storeWithClock(root: string, machineName: string, now: () => string): Promise<DataStore> {
  const s = new DataStore(root, { machineName, now })
  await s.open()
  return s
}

describe('historia zmian wpisów (.history/)', () => {
  it('zapis zachowuje poprzednią wersję z komputerem; edycje co chwilę – jedna kopia na 10 minut', async () => {
    const base = await freshStore()
    // Every call to now() moves the clock by one minute.
    const store = await storeWithClock(base.root, 'PC-A', clock('2026-10-05T08:00:00.000Z', 60_000))
    const t = sampleTrade({ notes: 'v1' })
    const { entry: e1 } = await store.saveRecord('trades', t)
    expect(e1.record.updatedBy).toBe('PC-A')
    expect(await store.historyList('trades', t.id)).toEqual([]) // nothing replaced yet
    await store.saveRecord('trades', { ...e1.record, notes: 'v2' })
    await store.saveRecord('trades', { ...e1.record, notes: 'v3' })
    const list = await store.historyList('trades', t.id)
    expect(list).toHaveLength(1) // v3 replaced v2 within 10 minutes of the first snapshot
    expect(list[0]).toMatchObject({ reason: 'edit', savedBy: 'PC-A', updatedBy: 'PC-A' })
    expect((await store.historyRead('trades', t.id, list[0]!.file)) as { notes: string }).toMatchObject({ notes: 'v1' })
    // The history is a dot folder: not scanned, not a record, not a problem.
    expect(await exists(join(store.root, HISTORY_DIR, 'trades', t.id))).toBe(true)
    const snap = await new DataStore(store.root, { machineName: 'X' }).open()
    expect(snap.trades).toHaveLength(1)
    expect(snap.problems).toEqual([])
  })

  it('wersja zapisana na innym komputerze trafia do historii zawsze', async () => {
    const base = await freshStore()
    const a = await storeWithClock(base.root, 'PC-A', clock('2026-10-05T08:00:00.000Z', 1000))
    const t = sampleTrade({ notes: 'z A' })
    await a.saveRecord('trades', t)
    await a.saveRecord('trades', { ...t, notes: 'z A 2' }) // snapshot of "z A"
    const b = await storeWithClock(base.root, 'PC-B', clock('2026-10-05T08:00:30.000Z', 1000))
    const current = (await b.snapshot()).trades[0]!.record
    await b.saveRecord('trades', { ...current, notes: 'z B' })
    await b.saveRecord('trades', { ...current, notes: 'z B 2' }) // throttled (own version, seconds later)
    const list = await b.historyList('trades', t.id)
    expect(list.map((e) => [e.updatedBy, e.savedBy])).toEqual([
      ['PC-A', 'PC-B'],
      ['PC-A', 'PC-A']
    ])
  })

  it('usunięty wpis można przywrócić; przywrócenie odkłada bieżącą wersję', async () => {
    const store = await freshStore()
    const t = sampleTrade({ notes: 'oryginał' })
    await store.saveRecord('trades', t)
    await store.deleteRecord('trades', t.id)
    expect((await store.snapshot()).trades).toHaveLength(0)
    const deleted = await store.historyDeleted('trades')
    expect(deleted.map((d) => d.id)).toEqual([t.id])
    expect(deleted[0]).toMatchObject({ reason: 'delete' })
    const { change } = await store.historyRestore('trades', t.id, deleted[0]!.file)
    expect(change?.upserts.map((u) => (u.entry.record as { notes: string }).notes)).toEqual(['oryginał'])
    expect(change?.origin).toBe('local')
    expect((await store.snapshot()).trades.map((e) => e.record.id)).toEqual([t.id])
    expect(await store.historyDeleted('trades')).toEqual([])

    // Restoring an older version of an existing record keeps the current one first.
    const { entry } = await store.saveRecord('trades', { ...t, notes: 'nowsza' })
    const before = await store.historyList('trades', t.id)
    const oldest = before.at(-1)!
    await store.historyRestore('trades', t.id, oldest.file)
    const after = await store.historyList('trades', t.id)
    expect(after[0]).toMatchObject({ reason: 'restore' })
    expect(((await store.historyRead('trades', t.id, after[0]!.file)) as { notes: string }).notes).toBe(entry.record.notes)
    expect((await store.snapshot()).trades[0]!.record.notes).toBe('oryginał')
  })

  it('ustawienia (journal.json) też mają historię i dają się przywrócić', async () => {
    const base = await freshStore()
    const store = await storeWithClock(base.root, 'PC-A', clock('2026-10-05T08:00:00.000Z', 11 * 60_000))
    const j = (await store.snapshot()).journal
    await store.saveJournal({ ...j, settings: { ...j.settings, risk: { ...j.settings.risk, accountCurrency: 'PLN' } } })
    const list = await store.historyList('journal', j.id)
    expect(list).toHaveLength(1)
    const { journal } = await store.historyRestore('journal', j.id, list[0]!.file)
    expect(journal?.settings.risk.accountCurrency).toBe('USD')
    expect(journal?.updatedBy).toBe('PC-A')
  })

  it('najwyżej MAX_PER_RECORD wersji na wpis; „historyKeep” zapisuje odrzuconą wersję', async () => {
    const base = await freshStore()
    const store = await storeWithClock(base.root, 'PC-A', clock('2026-10-05T08:00:00.000Z', 11 * 60_000))
    const t = sampleTrade()
    await store.saveRecord('trades', t)
    for (let i = 0; i < MAX_PER_RECORD + 5; i++) await store.saveRecord('trades', { ...t, notes: `v${i}` })
    const files = await fs.readdir(join(store.root, HISTORY_DIR, 'trades', t.id))
    expect(files).toHaveLength(MAX_PER_RECORD)
    await store.historyKeep('trades', { ...t, notes: 'niezapisana' }, 'discarded')
    const list = await store.historyList('trades', t.id)
    expect(list[0]).toMatchObject({ reason: 'discarded' })
    expect(list).toHaveLength(MAX_PER_RECORD)
    // A bad file name never leaves the record's folder.
    expect(await store.historyRead('trades', t.id, '../../journal.json')).toBeNull()
  })
})
