import { createWriteStream, promises as fs, rmSync } from 'node:fs'
import { join } from 'node:path'
import yazl from 'yazl'
import { describe, expect, it } from 'vitest'
import { ReadOnlyError } from '../../src/main/datastore/store'
import { zipFolder } from '../../src/main/datastore/zip'
import { extractZip } from '../../src/main/datastore/transfer'
import { writeFileAtomic } from '../../src/main/datastore/atomic'
import { createDayPlan } from '@shared/defaults'
import { dayRelPath } from '@shared/paths'
import { exists, freshStore, readJson, tempDir } from './helpers'

describe('uszkodzony plik pod ścieżką zapisu nie jest nadpisywany', () => {
  it('uszkodzony plan dnia zostaje odsunięty jako kopia konfliktu, nowy plan zapisany', async () => {
    const store = await freshStore()
    const rel = dayRelPath('2026-03-16')
    await fs.mkdir(join(store.root, 'days', '2026'), { recursive: true })
    await fs.writeFile(join(store.root, rel), '{"schemaVersion": 1, "date": "2026-03-16", "pairs": [', 'utf8')
    const before = await store.refresh()
    expect(before?.problems.some((p) => p.relPath === rel)).toBe(true)

    const { change } = await store.saveRecord('days', createDayPlan('2026-03-16', ['EURUSD'], []))
    expect((await readJson(join(store.root, rel))).date).toBe('2026-03-16')
    const copy = change?.conflicts.find((c) => c.id.startsWith('days/2026/2026-03-16-uszkodzona-'))
    expect(copy?.source).toBe('uszkodzony plik odsunięty przy zapisie')
    expect(await fs.readFile(join(store.root, copy!.id), 'utf8')).toContain('"pairs": [')
  })

  it('plik w nowszym formacie (niepasujący do schematu) blokuje zapis zamiast zniknąć', async () => {
    const store = await freshStore()
    const rel = dayRelPath('2026-03-17')
    const text = '{"schemaVersion": 99, "date": "2026-03-17", "pairs": "nowy-format"}\n'
    await fs.mkdir(join(store.root, 'days', '2026'), { recursive: true })
    await fs.writeFile(join(store.root, rel), text, 'utf8')
    await store.refresh()
    await expect(store.saveRecord('days', createDayPlan('2026-03-17', ['EURUSD'], []))).rejects.toBeInstanceOf(ReadOnlyError)
    expect(await fs.readFile(join(store.root, rel), 'utf8')).toBe(text)
  })
})

describe('journal.json uszkodzony w trakcie pracy', () => {
  it('odświeżenie nie rzuca wyjątku: ustawienia zostają, plik jest na liście problemów, zapis go odsuwa', async () => {
    const store = await freshStore()
    const journalBefore = store.journal
    const broken = '{"schemaVersion": 1, "settings": {'
    await fs.writeFile(join(store.root, 'journal.json'), broken, 'utf8')
    const change = await store.refresh()
    expect(change?.problems.some((p) => p.relPath === 'journal.json')).toBe(true)
    expect(store.journal).toBe(journalBefore)
    expect(change?.status.readOnly).toBe(false)

    await store.saveJournal({ ...journalBefore, settings: { ...journalBefore.settings, display: { ...journalBefore.settings.display, showMoney: true } } })
    expect(((await readJson(join(store.root, 'journal.json'))).settings as { display: { showMoney: boolean } }).display.showMoney).toBe(true)
    const names = await fs.readdir(store.root)
    const copy = names.find((n) => n.startsWith('journal-uszkodzona-'))
    expect(copy).toBeTruthy()
    expect(await fs.readFile(join(store.root, copy!), 'utf8')).toBe(broken)
  })

  it('journal.json w nowszym formacie przełącza folder w tryb tylko do odczytu', async () => {
    const store = await freshStore()
    await fs.writeFile(join(store.root, 'journal.json'), '{"schemaVersion": 99, "settings": "inaczej"}\n', 'utf8')
    const change = await store.refresh()
    expect(change?.status.readOnly).toBe(true)
    await expect(store.saveJournal(store.journal)).rejects.toBeInstanceOf(ReadOnlyError)
  })
})

describe('ZIP odporny na zmiany w trakcie pakowania', () => {
  it('plik znikający w trakcie pakowania nie wywraca procesu – druga próba się udaje', async () => {
    const root = tempDir()
    await fs.mkdir(join(root, 'trades'), { recursive: true })
    await fs.writeFile(join(root, 'trades', 'a.json'), '{}', 'utf8')
    await fs.writeFile(join(root, 'trades', 'b.json'), '{}', 'utf8')
    let removed = false
    const out = join(tempDir(), 'kopia.zip')
    // The include callback runs after listing and before zipping: deleting here reproduces the race.
    const res = await zipFolder(root, out, (rel) => {
      if (rel === 'trades/b.json' && !removed) {
        removed = true
        rmSync(join(root, ...rel.split('/')))
      }
      return true
    })
    expect(res.files).toBe(1)
    expect(await exists(out)).toBe(true)
    expect((await fs.readdir(join(out, '..'))).filter((n) => n.includes('.tmp-'))).toEqual([])
  })
})

describe('import uszkodzonego ZIP', () => {
  it('zepsute dane w archiwum kończą się czytelnym błędem, nie awarią', async () => {
    const dir = tempDir()
    const zipPath = join(dir, 'zly.zip')
    const payload = 'x'.repeat(20000)
    await new Promise<void>((resolve, reject) => {
      const zip = new yazl.ZipFile()
      zip.addBuffer(Buffer.from(payload), 'trades/2026/plik.json', { compress: true })
      zip.end()
      const out = createWriteStream(zipPath)
      zip.outputStream.pipe(out)
      out.on('close', () => resolve())
      out.on('error', reject)
    })
    // Overwrite part of the compressed stream (after the 30-byte local header + file name).
    const bytes = await fs.readFile(zipPath)
    const start = 30 + 'trades/2026/plik.json'.length + 2
    for (let i = start; i < start + 12; i++) bytes[i] = 0xff
    await fs.writeFile(zipPath, bytes)
    await expect(extractZip(zipPath, join(dir, 'wynik'))).rejects.toThrow(/Uszkodzony plik ZIP/)
  })
})

describe('zapis atomowy sprząta po błędzie', () => {
  it('nieudany zapis nie zostawia pliku tymczasowego', async () => {
    const dir = tempDir()
    // A directory in place of the target makes the final rename fail.
    await fs.mkdir(join(dir, 'cel.json'))
    await fs.writeFile(join(dir, 'cel.json', 'x'), 'x')
    await expect(writeFileAtomic(join(dir, 'cel.json'), '{}')).rejects.toBeTruthy()
    expect((await fs.readdir(dir)).filter((n) => n.includes('.tmp-'))).toEqual([])
  })
})
