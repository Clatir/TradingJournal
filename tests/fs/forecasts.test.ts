import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DataStore } from '../../src/main/datastore/store'
import { manualBackup, runBackups } from '../../src/main/datastore/backup'
import { applyImport, extractZip, inspectFolder } from '../../src/main/datastore/transfer'
import { zipFolder } from '../../src/main/datastore/zip'
import { createDefaultJournal, createForecast } from '@shared/defaults'
import { newId } from '@shared/ids'
import { forecastRelPath, isIgnoredPath } from '@shared/paths'
import type { Forecast } from '@shared/schema'
import { exists, freshStore, readJson, sampleTrade, tempDir } from './helpers'

const scenario = (over: Partial<Forecast> = {}): Forecast => ({
  ...createForecast({ accountCurrency: 'PLN', accountBalance: 10000 }, [], '2026-11-02T09:00:00.000Z'),
  goals: [{ id: newId(), name: 'Cel 1', month: 6, amount: 2000, enabled: true, flexible: false }],
  ...over
})

describe('scenariusze prognozy na dysku', () => {
  it('zapis: forecasts/<ULID>.json z wcięciami i końcowym \\n; odczyt w nowej instancji', async () => {
    const store = await freshStore()
    const f = scenario({ notes: 'wariant 1' })
    const { entry } = await store.saveRecord('forecasts', f)
    expect(entry.relPath).toBe(forecastRelPath(f.id))
    const text = await fs.readFile(join(store.root, entry.relPath), 'utf8')
    expect(text.endsWith('}\n')).toBe(true)
    expect(text).toContain('\n  "name": "Scenariusz 1",\n')
    expect(text).not.toContain('"computed"')
    const reopened = new DataStore(store.root, { machineName: 'INNY-PC' })
    const snap = await reopened.open()
    expect(snap.forecasts).toHaveLength(1)
    expect(snap.forecasts[0]).toMatchObject({ relPath: entry.relPath, readOnly: false })
    expect(snap.forecasts[0]!.record).toEqual(entry.record)
    expect(snap.forecasts[0]!.record.draws.rate).toHaveLength(240)
    expect(snap.problems).toEqual([])
  })

  it('usunięcie scenariusza usuwa plik z forecasts/', async () => {
    const store = await freshStore()
    const f = scenario()
    const { entry } = await store.saveRecord('forecasts', f)
    await store.deleteRecord('forecasts', f.id)
    expect(await exists(join(store.root, entry.relPath))).toBe(false)
    expect((await store.snapshot()).forecasts).toEqual([])
  })

  it('kopia konfliktu forecasts/<ULID>-LAPTOP.json jest pokazana i rozstrzygana', async () => {
    const store = await freshStore()
    const { entry } = await store.saveRecord('forecasts', scenario({ payoutPercent: 30 }))
    const copyRel = entry.relPath.replace('.json', '-LAPTOP.json')
    await fs.writeFile(join(store.root, copyRel), JSON.stringify({ ...entry.record, payoutPercent: 40 }, null, 2))
    const change = await store.refresh([copyRel])
    expect(change?.conflicts).toHaveLength(1)
    const c = change!.conflicts[0]!
    expect(c).toMatchObject({ type: 'copy', source: 'OneDrive', kind: 'forecasts' })
    expect((c.copy.record as Forecast).payoutPercent).toBe(40)
    await store.resolveConflict(c.id, 'copy')
    expect((await readJson(join(store.root, entry.relPath))).payoutPercent).toBe(40)
    expect(await exists(join(store.root, copyRel))).toBe(false)
  })

  it('folder ze scenariuszami (także zapisanymi ręcznie) otwiera się do zapisu', async () => {
    const root = join(tempDir(), 'journal')
    await DataStore.initialize(root, createDefaultJournal('2026-01-01T00:00:00.000Z'))
    const f = scenario()
    await fs.mkdir(join(root, 'forecasts'), { recursive: true })
    await fs.writeFile(join(root, forecastRelPath(f.id)), `${JSON.stringify(f, null, 2)}\n`)
    const store = new DataStore(root, { machineName: 'TEST-PC' })
    const snap = await store.open()
    expect(snap.status.readOnly).toBe(false)
    expect(snap.status.readOnlyReason).toBeNull()
    expect(snap.forecasts.map((e) => e.record.id)).toEqual([f.id])
    const { entry } = await store.saveRecord('forecasts', { ...f, name: 'Zmieniona nazwa' })
    expect((await readJson(join(root, entry.relPath))).name).toBe('Zmieniona nazwa')
    await store.saveRecord('trades', sampleTrade())
    expect((await store.snapshot()).trades).toHaveLength(1)
  })

  it('folder z wersji 1.2.x (bez katalogu forecasts/): pierwszy zapis scenariusza tworzy katalog', async () => {
    const store = await freshStore()
    await fs.rm(join(store.root, 'forecasts'), { recursive: true })
    const reopened = new DataStore(store.root, { machineName: 'TEST-PC' })
    const snap = await reopened.open()
    expect(snap.forecasts).toEqual([])
    expect(snap.status.readOnly).toBe(false)
    const f = scenario()
    await reopened.saveRecord('forecasts', f)
    expect(await exists(join(store.root, forecastRelPath(f.id)))).toBe(true)
  })

  it('kopia dzienna (same JSON-y), tygodniowa i ręczna zawierają scenariusze', async () => {
    const store = await freshStore()
    const f = scenario()
    await store.saveRecord('forecasts', f)
    const backups = join(store.root, 'backups')
    const res = await runBackups(store.root, backups, new Date('2026-11-02T09:00:00Z'))
    for (const zip of [res.daily, res.weekly, await manualBackup(store.root, backups, new Date('2026-11-02T10:00:00Z'))]) {
      expect(zip).toBeTruthy()
      const out = tempDir()
      await extractZip(zip!, out)
      expect(await exists(join(out, forecastRelPath(f.id)))).toBe(true)
    }
  })

  it('eksport ZIP → import: scenariusze są w raporcie i trafiają do dziennika', async () => {
    const source = await freshStore()
    const us30 = { id: 'US30', name: 'US30', pipSize: 1, contractSize: 1, quoteCurrency: 'USD', minLot: 0.1, description: '', archived: false }
    await source.saveJournal({ ...source.journal, settings: { ...source.journal.settings, instruments: [...source.journal.settings.instruments, us30] } })
    const f = scenario({ name: 'Scenariusz z importu', gain: 'pips', pips: { ...scenario().pips, instrumentId: 'US30' } })
    await source.saveRecord('forecasts', f)
    await source.saveRecord('trades', sampleTrade())
    const zip = join(tempDir(), 'eksport.zip')
    await zipFolder(source.root, zip, (rel) => !isIgnoredPath(rel))
    const target = await freshStore()
    const dir = tempDir()
    await extractZip(zip, dir)
    const inspected = await inspectFolder(target, dir, zip, 'zip')
    expect(inspected.report.valid).toMatchObject({ trades: 1, forecasts: 1 })
    expect(inspected.report.invalid).toEqual([])
    const res = await applyImport(target, inspected, 'newer')
    expect(res.imported).toBe(2)
    const snap = await target.snapshot()
    expect(snap.forecasts).toHaveLength(1)
    expect(snap.forecasts[0]!.record).toMatchObject({ id: f.id, name: 'Scenariusz z importu' })
    expect(snap.forecasts[0]!.record.draws).toEqual(f.draws)
    // the instrument the scenario uses comes along with the journal settings
    expect(snap.journal.settings.instruments.find((i) => i.id === 'US30')).toEqual(us30)
  })
})
