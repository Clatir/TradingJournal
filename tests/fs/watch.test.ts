import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FolderWatcher } from '../../src/main/datastore/watch'
import { writeFileAtomic } from '../../src/main/datastore/atomic'
import { readOtherMachines, writePresence } from '../../src/main/datastore/presence'
import { tempDir } from './helpers'

describe('watcher folderu danych', () => {
  it('zgłasza zmienione pliki po debounce, pomija pliki tymczasowe i ukryte', async () => {
    const root = tempDir()
    await fs.mkdir(join(root, 'trades', '2026'), { recursive: true })
    const batches: Array<string[] | null> = []
    const w = new FolderWatcher(root, (p) => batches.push(p), { debounceMs: 80, pollMs: 60_000 })
    w.start()
    await w.ready()
    await new Promise((r) => setTimeout(r, 100))
    await fs.writeFile(join(root, 'trades', '2026', '.a.json.tmp-1'), 'x')
    await fs.writeFile(join(root, 'trades', '2026', 'a.json'), '{}')
    await new Promise((r) => setTimeout(r, 400))
    w.stop()
    const all = batches.flatMap((b) => b ?? ['<full>'])
    expect(all).toContain('trades/2026/a.json')
    expect(all.some((p) => p.includes('.tmp-'))).toBe(false)
  })
})

describe('watcher po zapisach atomowych', () => {
  it('zmiana pliku z zewnątrz jest wykryta także po wcześniejszych zapisach przez rename (nowy inode)', async () => {
    const root = tempDir()
    const batches: Array<string[] | null> = []
    const w = new FolderWatcher(root, (p) => batches.push(p), { debounceMs: 60, pollMs: 60_000 })
    w.start()
    await w.ready()
    const target = join(root, 'trades', '2026', 'a.json')
    for (let i = 0; i < 3; i++) {
      await writeFileAtomic(target, `{"v":${i}}`)
      await new Promise((r) => setTimeout(r, 120))
    }
    await new Promise((r) => setTimeout(r, 250))
    batches.length = 0
    await fs.writeFile(target, '{"external":true}')
    await new Promise((r) => setTimeout(r, 600))
    w.stop()
    expect(batches.flatMap((b) => b ?? ['trades/2026/a.json'])).toContain('trades/2026/a.json')
  })
})

describe('obecność innych komputerów', () => {
  it('heartbeat innego komputera z ostatnich minut jest widoczny, własny nie', async () => {
    const root = tempDir()
    await writePresence(root, 'LAPTOP', '0.1.0')
    await writePresence(root, 'DESKTOP', '0.1.0')
    const others = await readOtherMachines(root, 'DESKTOP')
    expect(others.map((o) => o.machine)).toEqual(['LAPTOP'])
    expect(await readOtherMachines(root, 'DESKTOP', Date.now() + 10 * 60_000)).toEqual([])
  })
})
