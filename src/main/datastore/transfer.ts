import { createWriteStream, promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import yauzl from 'yauzl'
import type { ImportPolicy, ImportReport } from '@shared/api'
import { COLLECTIONS, JOURNAL_FILE, classifyCanonical, isIgnoredPath, isScreenFile, sanitizeRelPath, type Collection } from '@shared/paths'
import { parseRecordText, type AnyRecord } from '@shared/records'
import type { JournalFile } from '@shared/schema'
import { walkFiles } from './fsutil'
import type { DataStore } from './store'

/** Extract a ZIP safely (no absolute paths, no "..", no symlinks). Returns the number of files written. */
export function extractZip(zipPath: string, destDir: string): Promise<number> {
  return new Promise<number>((resolve, rejectRaw) => {
    let zipFile: yauzl.ZipFile | null = null
    let done = false
    const reject = (e: unknown) => {
      if (done) return
      done = true
      try {
        // yauzl auto-closes on its own errors; closing twice throws.
        if (zipFile?.isOpen) zipFile.close()
      } catch {
        /* already closed */
      }
      const msg = String((e as Error)?.message)
      rejectRaw(
        /invalid relative path|absolute path/i.test(msg)
          ? new Error('ZIP zawiera niedozwolone ścieżki (np. ../) – odrzucony.')
          : new Error(`Uszkodzony plik ZIP: ${msg}`)
      )
    }
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('Nie można otworzyć ZIP'))
      zipFile = zip
      let count = 0
      zip.on('error', reject)
      zip.on('end', () => resolve(count))
      zip.on('entry', (entry: yauzl.Entry) => {
        const rel = sanitizeRelPath(entry.fileName)
        if (!rel || entry.fileName.endsWith('/')) {
          zip.readEntry()
          return
        }
        const target = join(destDir, ...rel.split('/'))
        zip.openReadStream(entry, (e, stream) => {
          if (e || !stream) return reject(e ?? new Error('Błąd odczytu ZIP'))
          // Damaged data (bad deflate stream, size mismatch) is reported on the entry stream; pipeline
          // propagates it and closes both ends. The early listener covers the time before piping.
          stream.on('error', reject)
          fs.mkdir(dirname(target), { recursive: true })
            .then(() => pipeline(stream, createWriteStream(target)))
            .then(() => {
              if (done) return
              count++
              zip.readEntry()
            })
            .catch(reject)
        })
      })
      zip.readEntry()
    })
  })
}

export interface Inspected {
  report: ImportReport
  dir: string
  records: Array<{ kind: Collection; relPath: string; record: AnyRecord }>
  journal: JournalFile | null
  screens: string[]
}

/** Validate every file of a journal folder (or extracted ZIP) without touching the current data. */
export async function inspectFolder(store: DataStore, dir: string, source: string, kind: 'zip' | 'folder'): Promise<Inspected> {
  const files = await walkFiles(dir, dir, (rel) => isIgnoredPath(rel))
  const records: Inspected['records'] = []
  const invalid: ImportReport['invalid'] = []
  let journal: JournalFile | null = null
  let tooNew = false
  const screens: string[] = []
  for (const rel of files) {
    if (isScreenFile(rel)) {
      screens.push(rel)
      continue
    }
    const fileKind = classifyCanonical(rel)
    if (!fileKind) continue
    const text = await fs.readFile(join(dir, ...rel.split('/')), 'utf8')
    const parsed = parseRecordText(fileKind, text)
    if (!parsed.ok) {
      if (parsed.tooNewVersion != null) tooNew = true
      invalid.push({ relPath: rel, error: parsed.error })
      continue
    }
    if (fileKind === 'journal') journal = parsed.value as JournalFile
    else records.push({ kind: fileKind, relPath: rel, record: parsed.value as AnyRecord })
  }
  const valid = Object.fromEntries(COLLECTIONS.map((c) => [c, records.filter((r) => r.kind === c).length])) as Record<Collection, number>
  const current = await store.snapshot()
  const currentById = new Map<string, { updatedAt: string; relPath: string }>()
  for (const c of COLLECTIONS) for (const e of current[c]) currentById.set(`${c}:${e.record.id}`, { updatedAt: e.record.updatedAt, relPath: e.relPath })
  const currentPaths = new Map<string, string>()
  for (const c of COLLECTIONS) for (const e of current[c]) currentPaths.set(e.relPath, e.record.updatedAt)
  const collisions: ImportReport['collisions'] = []
  for (const r of records) {
    const hit = currentById.get(`${r.kind}:${r.record.id}`)
    const pathHit = !hit && currentPaths.get(r.relPath)
    const currentUpdatedAt = hit?.updatedAt ?? (pathHit || null)
    if (!currentUpdatedAt) continue
    collisions.push({
      kind: r.kind,
      id: r.record.id,
      relPath: r.relPath,
      incomingUpdatedAt: r.record.updatedAt,
      currentUpdatedAt,
      newer: r.record.updatedAt > currentUpdatedAt ? 'incoming' : r.record.updatedAt < currentUpdatedAt ? 'current' : 'same'
    })
  }
  return {
    dir,
    records,
    journal,
    screens,
    report: { token: '', source, kind, hasJournal: !!journal, valid, invalid, collisions, screens: screens.length, tooNew }
  }
}

/** Merge dictionaries, pairs and killzones that the imported records reference (by id / symbol). */
export function mergeJournal(current: JournalFile, incoming: JournalFile): JournalFile {
  const dicts = { ...current.dictionaries }
  for (const key of ['entryModels', 'pdArrays', 'liquidityPools', 'mistakeTags', 'missedReasons'] as const) {
    const have = new Set(dicts[key].map((d) => d.id))
    dicts[key] = [...dicts[key], ...incoming.dictionaries[key].filter((d) => !have.has(d.id))]
  }
  dicts.timeframes = [...new Set([...current.dictionaries.timeframes, ...incoming.dictionaries.timeframes])]
  const pairs = [...current.settings.pairs]
  for (const p of incoming.settings.pairs) if (!pairs.some((x) => x.symbol === p.symbol)) pairs.push(p)
  const killzones = [...current.settings.killzones]
  for (const k of incoming.settings.killzones) if (!killzones.some((x) => x.id === k.id)) killzones.push(k)
  return { ...current, dictionaries: dicts, settings: { ...current.settings, pairs, killzones } }
}

export async function applyImport(store: DataStore, inspected: Inspected, policy: ImportPolicy): Promise<{ imported: number; skipped: number; screensCopied: number }> {
  // Checked up front: screenshots are copied before the records, and nothing may land in a read-only folder.
  const status = store.status()
  if (status.readOnly) throw new Error(status.readOnlyReason ?? 'Folder danych jest tylko do odczytu.')
  const collisions = new Map(inspected.report.collisions.map((c) => [`${c.kind}:${c.id}`, c]))
  const chosen = inspected.records.filter((r) => {
    const c = collisions.get(`${r.kind}:${r.record.id}`) ?? inspected.report.collisions.find((x) => x.relPath === r.relPath)
    if (!c) return true
    if (policy === 'skip') return false
    if (policy === 'overwrite') return true
    return c.newer === 'incoming'
  })
  if (inspected.journal) await store.saveJournal(mergeJournal(store.journal, inspected.journal))
  let screensCopied = 0
  for (const rel of inspected.screens) {
    const target = store.abs(rel)
    try {
      await fs.access(target)
    } catch {
      await fs.mkdir(dirname(target), { recursive: true })
      await fs.copyFile(join(inspected.dir, ...rel.split('/')), target)
      screensCopied++
    }
  }
  await store.importRecords(chosen.map((r) => ({ kind: r.kind, record: r.record })))
  return { imported: chosen.length, skipped: inspected.records.length - chosen.length, screensCopied }
}

export { JOURNAL_FILE }
