import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DataStore } from '../../src/main/datastore/store'
import { listBackups, runBackups, DAILY_KEEP, WEEKLY_KEEP } from '../../src/main/datastore/backup'
import { applyImport, extractZip, inspectFolder } from '../../src/main/datastore/transfer'
import { zipFolder } from '../../src/main/datastore/zip'
import { createDayPlan, createDefaultJournal } from '@shared/defaults'
import { isIgnoredPath } from '@shared/paths'
import { newId } from '@shared/ids'
import { exists, freshStore, sampleTrade, tempDir } from './helpers'

describe('kopie zapasowe', () => {
  it('codziennie ZIP z samymi JSON-ami, raz w tygodniu pełny; rotacja 14 / 4', async () => {
    const store = await freshStore()
    const shot = await store.saveScreen({ date: '2026-03-16', label: 'x', image: new Uint8Array(500), thumb: new Uint8Array(5), width: 1, height: 1 })
    await store.saveRecord('trades', sampleTrade({ screens: [{ ...shot, phase: 'before', timeframe: 'H4', caption: '', annotations: [] }] }))
    const backups = join(store.root, 'backups')
    const start = new Date('2026-01-01T09:00:00Z')
    for (let d = 0; d < 40; d++) await runBackups(store.root, backups, new Date(start.getTime() + d * 86400_000))
    const files = await listBackups(backups)
    expect(files.filter((f) => f.kind === 'daily')).toHaveLength(DAILY_KEEP)
    // mtimes are real "now", so only the first weekly is created in this fast loop; check rotation separately below
    expect(files.filter((f) => f.kind === 'weekly').length).toBeGreaterThanOrEqual(1)
    const daily = files.find((f) => f.kind === 'daily')!
    const out = tempDir()
    await extractZip(daily.path, out)
    expect(await exists(join(out, 'journal.json'))).toBe(true)
    expect(await exists(join(out, 'screens'))).toBe(false)
    const weekly = files.find((f) => f.kind === 'weekly')!
    const out2 = tempDir()
    await extractZip(weekly.path, out2)
    expect(await exists(join(out2, shot.path))).toBe(true)
    expect(await exists(join(out2, 'backups'))).toBe(false)
  })

  it('pełna kopia tygodniowa powstaje ponownie po 7 dniach, zostają 4', async () => {
    const store = await freshStore()
    const backups = join(store.root, 'backups')
    const weeklyDir = join(backups, 'weekly')
    for (let w = 0; w < 6; w++) {
      const now = new Date(Date.UTC(2026, 0, 5 + w * 7, 9))
      await runBackups(store.root, backups, now)
      // pretend the file was written at that time
      for (const f of await fs.readdir(weeklyDir)) await fs.utimes(join(weeklyDir, f), now, now).catch(() => undefined)
      const latest = (await fs.readdir(weeklyDir)).sort().at(-1)!
      await fs.utimes(join(weeklyDir, latest), now, now)
    }
    expect((await fs.readdir(weeklyDir)).length).toBe(WEEKLY_KEEP)
  })
})

describe('eksport ZIP i import', () => {
  async function populated() {
    const store = await freshStore()
    const shot = await store.saveScreen({ date: '2026-03-16', label: 'przed', image: new Uint8Array([7, 7, 7]), thumb: new Uint8Array([1]), width: 1, height: 1 })
    const t = sampleTrade({ notes: 'oryginał', screens: [{ ...shot, phase: 'before', timeframe: 'H4', caption: '', annotations: [] }] })
    await store.saveRecord('trades', t)
    const day = createDayPlan('2026-03-16', ['EURUSD'], ['DXY'])
    await store.saveRecord('days', day)
    return { store, t, day, shot }
  }

  it('ZIP → import do pustego dziennika odtwarza wszystkie rekordy i screeny', async () => {
    const { store, t, shot } = await populated()
    const zip = join(tempDir(), 'eksport.zip')
    await zipFolder(store.root, zip, (rel) => !isIgnoredPath(rel))
    const target = await freshStore()
    const dir = tempDir()
    await extractZip(zip, dir)
    const inspected = await inspectFolder(target, dir, zip, 'zip')
    expect(inspected.report.valid).toMatchObject({ trades: 1, days: 1 })
    expect(inspected.report.invalid).toEqual([])
    expect(inspected.report.collisions).toEqual([])
    const res = await applyImport(target, inspected, 'newer')
    expect(res).toEqual({ imported: 2, skipped: 0, screensCopied: 2 })
    const snap = await target.snapshot()
    expect(snap.trades[0]?.record).toMatchObject({ id: t.id, notes: 'oryginał', updatedAt: (await store.snapshot()).trades[0]?.record.updatedAt })
    expect(await fs.readFile(target.abs(shot.path))).toEqual(Buffer.from([7, 7, 7]))
  })

  it('kolizje: nowsza wersja wygrywa, „pomiń” zostawia bieżącą, „nadpisz” bierze importowaną', async () => {
    const { store, t } = await populated()
    const exportDir = tempDir()
    await fs.cp(store.root, exportDir, { recursive: true })
    // Current data gets a newer edit.
    const cur = (await store.snapshot()).trades[0]!.record
    await store.saveRecord('trades', { ...cur, notes: 'nowsza lokalnie' })
    let insp = await inspectFolder(store, exportDir, exportDir, 'folder')
    expect(insp.report.collisions.find((c) => c.id === t.id)?.newer).toBe('current')
    await applyImport(store, insp, 'newer')
    expect((await store.snapshot()).trades[0]?.record.notes).toBe('nowsza lokalnie')
    await applyImport(store, insp, 'skip')
    expect((await store.snapshot()).trades[0]?.record.notes).toBe('nowsza lokalnie')
    insp = await inspectFolder(store, exportDir, exportDir, 'folder')
    await applyImport(store, insp, 'overwrite')
    expect((await store.snapshot()).trades[0]?.record.notes).toBe('oryginał')
  })

  it('niepoprawne pliki są raportowane, a słowniki z importu dołączane', async () => {
    const { store } = await populated()
    const src = tempDir()
    await DataStore.initialize(src, createDefaultJournal())
    const other = new DataStore(src, { machineName: 'X' })
    await other.open()
    const j = other.journal
    const extra = { id: newId(), name: 'Model z innego komputera', archived: false }
    await other.saveJournal({ ...j, dictionaries: { ...j.dictionaries, entryModels: [...j.dictionaries.entryModels, extra] } })
    await other.saveRecord('trades', sampleTrade({ entryModelId: extra.id }))
    await fs.writeFile(join(src, 'trades', '2026', '2026-03-20_EURUSD_01K6H3Z0W8Q4M2N5P7R9S1T3V5.json'), '{ zepsuty')
    const insp = await inspectFolder(store, src, src, 'folder')
    expect(insp.report.invalid).toHaveLength(1)
    await applyImport(store, insp, 'newer')
    expect(store.journal.dictionaries.entryModels.some((m) => m.id === extra.id)).toBe(true)
  })

  it('ZIP z niebezpiecznymi ścieżkami (zip-slip) nie wychodzi poza katalog docelowy', async () => {
    const yazl = (await import('yazl')).default
    const { createWriteStream } = await import('node:fs')
    const zip = new yazl.ZipFile()
    // yazl refuses "../" names, so write "xx/" and patch the bytes afterwards (same length, CRC unaffected).
    zip.addBuffer(Buffer.from('x'), 'xx/poza.txt', { compress: false })
    zip.addBuffer(Buffer.from('ok'), 'trades/ok.txt', { compress: false })
    zip.end()
    const raw = join(tempDir(), 'raw.zip')
    await new Promise<void>((resolve) => zip.outputStream.pipe(createWriteStream(raw)).on('close', () => resolve()))
    const bytes = await fs.readFile(raw)
    const patched = Buffer.from(bytes.toString('latin1').split('xx/poza.txt').join('../poza.txt'), 'latin1')
    const zipPath = join(tempDir(), 'zly.zip')
    await fs.writeFile(zipPath, patched)
    const dest = join(tempDir(), 'cel')
    await expect(extractZip(zipPath, dest)).rejects.toThrow(/niedozwolone ścieżki/)
    expect(await exists(join(dest, '..', 'poza.txt'))).toBe(false)
  })
})

describe('współdzielone screeny', () => {
  it('usunięcie transakcji nie kasuje screena używanego w bibliotece', async () => {
    const store = await freshStore()
    const shot = await store.saveScreen({ date: '2026-03-16', label: 'x', image: new Uint8Array([1]), thumb: new Uint8Array([2]), width: 1, height: 1 })
    const ref = { ...shot, phase: null, timeframe: 'M15', caption: '', annotations: [] }
    const t = sampleTrade({ screens: [ref] })
    await store.saveRecord('trades', t)
    const now = new Date().toISOString()
    await store.saveRecord('library', { schemaVersion: 1, id: newId(), createdAt: now, updatedAt: now, title: 'Przykład', type: 'live', pair: 'EURUSD', direction: 'long', date: null, entryModelId: null, killzoneId: null, pdArrayIds: [], notes: '', linkedTradeId: t.id, screens: [ref] })
    await store.deleteRecord('trades', t.id)
    expect(await exists(store.abs(shot.path))).toBe(true)
  })
})
