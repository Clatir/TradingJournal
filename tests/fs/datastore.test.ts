import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DataStore, ReadOnlyError } from '../../src/main/datastore/store'
import { writeFileAtomic } from '../../src/main/datastore/atomic'
import { SCHEMA_VERSION } from '@shared/schema'
import { tradeRelPath } from '@shared/paths'
import { exists, freshStore, readJson, sampleTrade, tempDir } from './helpers'

describe('folder danych: tworzenie, zapis, odczyt', () => {
  it('nowy folder ma journal.json i katalogi, a dziennik jest pusty', async () => {
    const store = await freshStore()
    for (const d of ['trades', 'days', 'weeks', 'library', 'screens', 'backups']) expect(await exists(join(store.root, d))).toBe(true)
    const snap = await store.snapshot()
    expect(snap.trades).toHaveLength(0)
    expect(snap.journal.settings.pairs.map((p) => p.symbol)).toEqual(['AUDUSD', 'EURAUD', 'EURGBP', 'EURUSD', 'USDCHF'])
    expect(snap.status.readOnly).toBe(false)
  })

  it('zapis transakcji: czytelny JSON z wcięciami pod ścieżką z datą NY, odczyt w nowej instancji', async () => {
    const store = await freshStore()
    const t = sampleTrade({ notes: 'zażółć gęślą jaźń' })
    const { entry } = await store.saveRecord('trades', t)
    expect(entry.relPath).toBe(`trades/2026/2026-03-16_EURUSD_${t.id}.json`)
    const text = await fs.readFile(join(store.root, entry.relPath), 'utf8')
    expect(text).toContain('\n  "id": ')
    expect(text.endsWith('\n')).toBe(true)
    const json = JSON.parse(text)
    expect(json.schemaVersion).toBe(SCHEMA_VERSION)
    expect(json.computed.riskPips).toBe(15)

    const reopened = new DataStore(store.root, { machineName: 'OTHER' })
    const snap = await reopened.open()
    expect(snap.trades).toHaveLength(1)
    expect(snap.trades[0]?.record.notes).toBe('zażółć gęślą jaźń')
  })

  it('zmiana daty lub pary przenosi plik pod nową nazwę i usuwa stary', async () => {
    const store = await freshStore()
    const t = sampleTrade()
    const first = await store.saveRecord('trades', t)
    const second = await store.saveRecord('trades', { ...first.entry.record, pair: 'GBPUSD', entryTime: '2026-03-17T08:00:00.000Z' })
    expect(second.entry.relPath).toBe(`trades/2026/2026-03-17_GBPUSD_${t.id}.json`)
    expect(await exists(join(store.root, first.entry.relPath))).toBe(false)
    expect((await store.snapshot()).trades).toHaveLength(1)
  })

  it('usunięcie wpisu usuwa plik i jego screeny', async () => {
    const store = await freshStore()
    const shot = await store.saveScreen({ date: '2026-03-16', label: 'przed', image: new Uint8Array([1, 2, 3]), thumb: new Uint8Array([4]), width: 10, height: 10 })
    const t = sampleTrade({ screens: [{ ...shot, phase: 'before', timeframe: 'H4', caption: '', annotations: [] }] })
    const { entry } = await store.saveRecord('trades', t)
    await store.deleteRecord('trades', t.id)
    expect(await exists(join(store.root, entry.relPath))).toBe(false)
    expect(await exists(join(store.root, shot.path))).toBe(false)
    expect(await exists(join(store.root, shot.thumbPath))).toBe(false)
  })
})

describe('zapis atomowy', () => {
  it('nie zostawia plików tymczasowych i zastępuje istniejący plik', async () => {
    const dir = tempDir()
    const target = join(dir, 'a', 'b.json')
    await writeFileAtomic(target, '{"v":1}')
    await writeFileAtomic(target, '{"v":2}')
    expect(await fs.readFile(target, 'utf8')).toBe('{"v":2}')
    expect((await fs.readdir(join(dir, 'a'))).filter((f) => f.includes('.tmp-'))).toEqual([])
  })

  it('pozostałość po przerwanym zapisie (.tmp) jest ignorowana, oryginał nienaruszony', async () => {
    const store = await freshStore()
    const t = sampleTrade()
    const { entry } = await store.saveRecord('trades', t)
    const dir = join(store.root, 'trades', '2026')
    // Simulated crash: temp file written halfway, never renamed.
    await fs.writeFile(join(dir, `.${entry.relPath.split('/').pop()}.tmp-dead`), '{"id": "01K', 'utf8')
    const snap = await new DataStore(store.root, { machineName: 'X' }).open()
    expect(snap.trades).toHaveLength(1)
    expect(snap.problems).toEqual([])
  })
})

describe('uszkodzone pliki', () => {
  it('uszkodzony JSON jest pomijany i zgłaszany, reszta działa', async () => {
    const store = await freshStore()
    await store.saveRecord('trades', sampleTrade())
    const bad = sampleTrade()
    const badPath = join(store.root, tradeRelPath(bad))
    await fs.mkdir(join(store.root, 'trades', '2026'), { recursive: true })
    await fs.writeFile(badPath, '{ "id": "zepsuty", "pair": ', 'utf8')
    await fs.writeFile(join(store.root, 'days', 'notatki.json'), '{}', 'utf8')

    const snap = await new DataStore(store.root, { machineName: 'X' }).open()
    expect(snap.trades).toHaveLength(1)
    const kinds = Object.fromEntries(snap.problems.map((p) => [p.relPath.split('/').pop(), p.kind]))
    expect(kinds[badPath.split('/').pop()!]).toBe('corrupt')
    expect(kinds['notatki.json']).toBe('unknown-file')
    // The broken file is never overwritten.
    expect(await fs.readFile(badPath, 'utf8')).toBe('{ "id": "zepsuty", "pair": ')
  })

  it('poprawny JSON z błędną strukturą → problem "invalid"', async () => {
    const store = await freshStore()
    const t = sampleTrade()
    await fs.mkdir(join(store.root, 'trades', '2026'), { recursive: true })
    await fs.writeFile(join(store.root, tradeRelPath(t)), JSON.stringify({ ...t, direction: 'sideways' }), 'utf8')
    const snap = await new DataStore(store.root, { machineName: 'X' }).open()
    expect(snap.trades).toHaveLength(0)
    expect(snap.problems[0]?.kind).toBe('invalid')
    expect(snap.problems[0]?.message).toMatch(/direction/)
  })
})

describe('migracje i wersje schematu', () => {
  it('folder w starym formacie (v0) jest migrowany po pełnym backupie ZIP', async () => {
    const root = join(tempDir(), 'stary')
    await fs.mkdir(join(root, 'trades', '2026'), { recursive: true })
    await fs.writeFile(
      join(root, 'journal.json'),
      JSON.stringify({ settings: { pairs: [{ symbol: 'EURUSD', pipSize: 0.0001, quoteCurrency: 'USD' }] } }, null, 2)
    )
    const legacy = {
      id: '01K6H3Z0W8Q4M2N5P7R9S1T3V5',
      pair: 'EURUSD',
      direction: 'sell',
      entryTime: '2026-03-16T07:30:00.000Z',
      entry: 1.085,
      stopLoss: 1.0865,
      takeProfit: 1.082,
      exitPrice: 1.082,
      exitTime: '2026-03-16T10:00:00.000Z'
    }
    const rel = `trades/2026/2026-03-16_EURUSD_${legacy.id}.json`
    await fs.writeFile(join(root, rel), JSON.stringify(legacy, null, 2))

    const store = new DataStore(root, { machineName: 'X', now: () => '2026-04-01T10:00:00.000Z' })
    const snap = await store.open()
    expect(snap.status.migratedFrom).toBe(0)
    expect(snap.status.backupPath).toMatch(/pre-migration[\\/]20260401T100000Z_v0-v1\.zip$/)
    expect(await exists(snap.status.backupPath!)).toBe(true)
    const journal = await readJson(join(root, 'journal.json'))
    expect(journal.schemaVersion).toBe(SCHEMA_VERSION)
    const trade = await readJson(join(root, rel))
    expect(trade.schemaVersion).toBe(SCHEMA_VERSION)
    expect(trade.direction).toBe('short')
    expect((trade.prices as Record<string, number>).takeProfit1).toBe(1.082)
    expect(snap.trades[0]?.record.exits[0]?.price).toBe(1.082)
  })

  it('folder w nowszym formacie: tylko odczyt, zapis odrzucony, pliki nietknięte', async () => {
    const store = await freshStore()
    const t = sampleTrade()
    await store.saveRecord('trades', t)
    const jPath = join(store.root, 'journal.json')
    const j = await readJson(jPath)
    await fs.writeFile(jPath, JSON.stringify({ ...j, schemaVersion: SCHEMA_VERSION + 1 }, null, 2))
    const before = await fs.readFile(jPath, 'utf8')

    const newer = new DataStore(store.root, { machineName: 'OLD-APP' })
    const snap = await newer.open()
    expect(snap.status.readOnly).toBe(true)
    expect(snap.status.readOnlyReason).toMatch(/Zaktualizuj aplikację/)
    expect(snap.trades).toHaveLength(1)
    await expect(newer.saveRecord('trades', { ...t, notes: 'x' })).rejects.toBeInstanceOf(ReadOnlyError)
    await expect(newer.saveJournal(snap.journal)).rejects.toBeInstanceOf(ReadOnlyError)
    expect(await fs.readFile(jPath, 'utf8')).toBe(before)
  })

  it('pojedynczy rekord w nowszym formacie jest tylko do odczytu', async () => {
    const store = await freshStore()
    const t = sampleTrade()
    const { entry } = await store.saveRecord('trades', t)
    const p = join(store.root, entry.relPath)
    await fs.writeFile(p, JSON.stringify({ ...(await readJson(p)), schemaVersion: SCHEMA_VERSION + 1 }, null, 2))
    const s2 = new DataStore(store.root, { machineName: 'X' })
    const snap = await s2.open()
    expect(snap.trades[0]?.readOnly).toBe(true)
    await expect(s2.saveRecord('trades', { ...t, notes: 'nadpis' })).rejects.toBeInstanceOf(ReadOnlyError)
  })

  it('pojedynczy stary plik zsynchronizowany później jest migrowany, a oryginał zachowany w backups/', async () => {
    const store = await freshStore()
    const legacy = { id: '01K6H3Z0W8Q4M2N5P7R9S1T3V6', pair: 'EURUSD', direction: 'buy', entryTime: '2026-03-18T13:00:00.000Z', entry: 1.09, stopLoss: 1.089 }
    const rel = `trades/2026/2026-03-18_EURUSD_${legacy.id}.json`
    await fs.mkdir(join(store.root, 'trades', '2026'), { recursive: true })
    await fs.writeFile(join(store.root, rel), JSON.stringify(legacy))
    const change = await store.refresh([rel])
    expect(change?.upserts).toHaveLength(1)
    expect((await readJson(join(store.root, rel))).schemaVersion).toBe(SCHEMA_VERSION)
    const backups = await fs.readdir(join(store.root, 'backups', 'pre-migration'))
    expect(backups.length).toBe(1)
  })
})

describe('przeniesienie folderu danych', () => {
  it('cały folder skopiowany w inne miejsce działa, screeny rozwiązują się względnie', async () => {
    const store = await freshStore()
    const shot = await store.saveScreen({ date: '2026-03-16', label: 'przed H4', image: new Uint8Array([9, 9, 9]), thumb: new Uint8Array([1]), width: 1, height: 1 })
    await store.saveRecord('trades', sampleTrade({ screens: [{ ...shot, phase: 'before', timeframe: 'H4', caption: '', annotations: [] }] }))
    const moved = join(tempDir(), 'pendrive', 'Dziennik')
    await fs.cp(store.root, moved, { recursive: true })
    await fs.rm(store.root, { recursive: true, force: true })

    const s2 = new DataStore(moved, { machineName: 'LAPTOP' })
    const snap = await s2.open()
    const screen = snap.trades[0]!.record.screens[0]!
    expect(screen.path.startsWith('screens/2026/03/')).toBe(true)
    expect(await fs.readFile(s2.abs(screen.path))).toEqual(Buffer.from([9, 9, 9]))
    expect(JSON.stringify(snap)).not.toContain(store.root)
  })
})

describe('konflikty synchronizacji', () => {
  it('kopia OneDrive jest pokazana do rozstrzygnięcia; wybór kopii nadpisuje oryginał', async () => {
    const store = await freshStore()
    const t = sampleTrade({ notes: 'wersja A' })
    const { entry } = await store.saveRecord('trades', t)
    const copyRel = entry.relPath.replace('.json', '-DESKTOP-K3LM9.json')
    await fs.writeFile(join(store.root, copyRel), JSON.stringify({ ...entry.record, notes: 'wersja B' }, null, 2))

    const change = await store.refresh([copyRel])
    expect(change?.conflicts).toHaveLength(1)
    const c = change!.conflicts[0]!
    expect(c).toMatchObject({ type: 'copy', source: 'OneDrive', kind: 'trades' })
    expect((c.copy.record as { notes: string }).notes).toBe('wersja B')

    const after = await store.resolveConflict(c.id, 'copy')
    expect(after?.conflicts ?? []).toHaveLength(0)
    expect((await readJson(join(store.root, entry.relPath))).notes).toBe('wersja B')
    expect(await exists(join(store.root, copyRel))).toBe(false)
  })

  it('zachowanie oryginału usuwa kopię', async () => {
    const store = await freshStore()
    const { entry } = await store.saveRecord('trades', sampleTrade({ notes: 'A' }))
    const copyRel = entry.relPath.replace('.json', ' (1).json')
    await fs.writeFile(join(store.root, copyRel), '{ uszkodzona kopia')
    const change = await store.refresh()
    expect(change?.conflicts[0]?.copy.error).toMatch(/Uszkodzony JSON/)
    await store.resolveConflict(copyRel, 'canonical')
    expect(await exists(join(store.root, copyRel))).toBe(false)
    expect((await readJson(join(store.root, entry.relPath))).notes).toBe('A')
  })

  it('ten sam identyfikator w dwóch plikach → konflikt "duplicate", nowsza wersja na liście', async () => {
    const store = await freshStore()
    const t = sampleTrade({ notes: 'stara' })
    const { entry } = await store.saveRecord('trades', t)
    const other = { ...entry.record, entryTime: '2026-03-17T08:00:00.000Z', notes: 'nowa', updatedAt: '2030-01-01T00:00:00.000Z' }
    const otherRel = tradeRelPath(other)
    await fs.writeFile(join(store.root, otherRel), JSON.stringify(other, null, 2))
    const change = await store.refresh()
    const snap = await store.snapshot()
    expect(snap.trades).toHaveLength(1)
    expect(snap.trades[0]?.record.notes).toBe('nowa')
    expect(change?.conflicts[0]?.type).toBe('duplicate')
  })
})

describe('zmiany z zewnątrz (synchronizacja)', () => {
  it('zmiana pliku przez inny komputer trafia do widoku; własny zapis nie wraca jako zmiana', async () => {
    const store = await freshStore()
    const { entry } = await store.saveRecord('trades', sampleTrade({ notes: 'A' }))
    expect(await store.refresh([entry.relPath])).toBeNull()

    const p = join(store.root, entry.relPath)
    await fs.writeFile(p, JSON.stringify({ ...(await readJson(p)), notes: 'z laptopa' }, null, 2))
    const change = await store.refresh([entry.relPath])
    expect(change?.upserts[0]?.entry.record).toMatchObject({ notes: 'z laptopa' })

    await fs.rm(p)
    const removed = await store.refresh([entry.relPath])
    expect(removed?.removals).toEqual([{ collection: 'trades', id: entry.record.id }])
  })

  it('jeśli plik zmienił się w tle tuż przed zapisem, wersja z zewnątrz zostaje zachowana jako konflikt', async () => {
    const store = await freshStore()
    const { entry } = await store.saveRecord('trades', sampleTrade({ notes: 'A' }))
    const p = join(store.root, entry.relPath)
    await fs.writeFile(p, JSON.stringify({ ...(await readJson(p)), notes: 'zewnętrzna' }, null, 2))
    const saved = await store.saveRecord('trades', { ...entry.record, notes: 'moja' })
    expect(saved.change?.conflicts[0]?.source).toBe('zmiana z zewnątrz podczas edycji')
    expect((saved.change?.conflicts[0]?.copy.record as { notes: string }).notes).toBe('zewnętrzna')
    expect((await readJson(p)).notes).toBe('moja')
  })

  it('niedostępny folder (odłączony pendrive) → tylko odczyt, dane zostają w pamięci', async () => {
    const store = await freshStore()
    await store.saveRecord('trades', sampleTrade())
    const away = `${store.root}-odlaczony`
    await fs.rename(store.root, away)
    const change = await store.refresh()
    expect(change?.status.available).toBe(false)
    expect(change?.removals).toEqual([])
    await expect(store.saveRecord('trades', sampleTrade())).rejects.toBeInstanceOf(ReadOnlyError)
    await fs.rename(away, store.root)
    const back = await store.refresh()
    expect(back?.status.available).toBe(true)
    expect((await store.snapshot()).trades).toHaveLength(1)
  })
})

describe('screeny', () => {
  it('zapis WebP + miniatury, statystyki i wykrywanie osieroconych', async () => {
    const store = await freshStore()
    const a = await store.saveScreen({ date: '2026-03-16', label: 'przed H4', image: new Uint8Array(100), thumb: new Uint8Array(10), width: 1920, height: 1080 })
    const b = await store.saveScreen({ date: '2026-03-16', label: 'po', image: new Uint8Array(50), thumb: new Uint8Array(5), width: 1920, height: 1080 })
    expect(a.path).toMatch(/^screens\/2026\/03\/[0-9A-Z]{26}_przed-H4\.webp$/)
    await store.saveRecord('trades', sampleTrade({ screens: [{ ...a, phase: 'before', timeframe: 'H4', caption: '', annotations: [] }] }))
    const stats = await store.screensStats()
    expect(stats.totalBytes).toBe(165)
    expect(stats.fileCount).toBe(4)
    expect(stats.orphans).toEqual([expect.objectContaining({ path: b.path, thumbPath: b.thumbPath, bytes: 55 })])
    expect(await store.deleteScreens([b.path, a.path])).toBe(2)
    expect(await exists(store.abs(a.path))).toBe(true)
    expect((await store.screensStats()).orphans).toEqual([])
  })
})

describe('wydajność', () => {
  it('wczytanie 5000 transakcji', async () => {
    const store = await freshStore()
    const dir = join(store.root, 'trades', '2025')
    await fs.mkdir(dir, { recursive: true })
    const base = Date.UTC(2025, 0, 2, 7, 0)
    const writes: Promise<void>[] = []
    for (let i = 0; i < 5000; i++) {
      const t = sampleTrade({
        entryTime: new Date(base + i * 3 * 3600_000).toISOString(),
        notes: `Transakcja ${i}: sweep PDL, MSS na M5, wejście w FVG. `.repeat(3),
        exits: [{ id: '01K6H3Z0W8Q4M2N5P7R9S1T3V5', time: null, price: 1.0865 + (i % 7) * 0.0003, percent: 100, note: '' }]
      })
      writes.push(fs.writeFile(join(store.root, tradeRelPath(t)), `${JSON.stringify(t, null, 2)}\n`).catch(async () => {
        await fs.mkdir(join(store.root, tradeRelPath(t), '..'), { recursive: true })
        await fs.writeFile(join(store.root, tradeRelPath(t)), `${JSON.stringify(t, null, 2)}\n`)
      }))
    }
    await Promise.all(writes)
    const s2 = new DataStore(store.root, { machineName: 'X' })
    const t0 = performance.now()
    const snap = await s2.open()
    const ms = performance.now() - t0
    console.log(`5000 transakcji wczytane w ${Math.round(ms)} ms`)
    expect(snap.trades).toHaveLength(5000)
    expect(snap.problems).toEqual([])
    expect(ms).toBeLessThan(5000)
    const t1 = performance.now()
    expect(await s2.refresh()).toBeNull()
    console.log(`pełny reskan bez zmian: ${Math.round(performance.now() - t1)} ms`)
  })
})
