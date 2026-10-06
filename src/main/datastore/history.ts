/**
 * Version history of records: before a record is overwritten or deleted, the version on disk is kept in
 * `.history/<kind>/<id>/<time>_<reason>_<rand>.json` (a dot folder: the scanner, the watcher and the ZIP backups skip
 * it; cloud sync carries it, so every computer sees the same history). Edits are throttled (one snapshot per record
 * per 10 minutes of editing); a version written by another computer, a deletion, a restore and a merge are always kept.
 * The newest MAX_PER_RECORD snapshots of a record stay.
 */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { HistoryEntry, HistoryReason } from '@shared/api'
import type { FileKind } from '@shared/paths'
import { removeFile, writeFileAtomic } from './atomic'

export const HISTORY_DIR = '.history'
const EDIT_THROTTLE_MS = 10 * 60 * 1000
export const MAX_PER_RECORD = 40

interface SnapshotFile {
  savedAt: string
  savedBy: string
  reason: HistoryReason
  record: { id?: string; updatedAt?: string; updatedBy?: string | null } & Record<string, unknown>
}

const safeId = (id: string) => id.replace(/[^0-9A-Za-z_-]/g, '')
const fileStamp = (iso: string) => iso.replace(/[-:.]/g, '')

export class RecordHistory {
  private lastSnapshot = new Map<string, number>()

  constructor(
    private readonly root: string,
    private readonly machineName: string,
    private readonly now: () => string
  ) {}

  private dir(kind: FileKind, id: string): string {
    return join(this.root, HISTORY_DIR, kind, safeId(id))
  }

  /**
   * Keep `record` (the version about to be replaced or deleted). Never throws: a failed snapshot must not block
   * the save itself (it is reported through `onError`).
   */
  async snapshot(kind: FileKind, record: SnapshotFile['record'], reason: HistoryReason, onError?: (e: unknown) => void): Promise<boolean> {
    try {
      const id = String(record.id ?? 'journal')
      const key = `${kind}/${id}`
      const nowIso = this.now()
      const nowMs = Date.parse(nowIso)
      const fromOther = record.updatedBy != null && record.updatedBy !== this.machineName
      if (reason === 'edit' && !fromOther) {
        const last = this.lastSnapshot.get(key)
        if (last != null && nowMs - last < EDIT_THROTTLE_MS) return false
      }
      this.lastSnapshot.set(key, nowMs)
      const dir = this.dir(kind, id)
      const name = `${fileStamp(nowIso)}_${reason}_${randomBytes(2).toString('hex')}.json`
      const body: SnapshotFile = { savedAt: nowIso, savedBy: this.machineName, reason, record }
      await writeFileAtomic(join(dir, name), `${JSON.stringify(body, null, 2)}\n`)
      await this.prune(dir)
      return true
    } catch (e) {
      onError?.(e)
      return false
    }
  }

  private async files(dir: string): Promise<string[]> {
    try {
      return (await fs.readdir(dir)).filter((n) => n.endsWith('.json') && !n.startsWith('.')).sort()
    } catch {
      return []
    }
  }

  private async prune(dir: string): Promise<void> {
    const names = await this.files(dir)
    for (const name of names.slice(0, Math.max(0, names.length - MAX_PER_RECORD))) await removeFile(join(dir, name))
  }

  private async readFile(dir: string, name: string): Promise<SnapshotFile | null> {
    try {
      const parsed = JSON.parse(await fs.readFile(join(dir, name), 'utf8')) as SnapshotFile
      return parsed && typeof parsed === 'object' && parsed.record && typeof parsed.record === 'object' ? parsed : null
    } catch {
      return null
    }
  }

  private entryOf(name: string, s: SnapshotFile): HistoryEntry {
    return {
      file: name,
      savedAt: s.savedAt,
      savedBy: s.savedBy ?? null,
      reason: s.reason,
      updatedAt: typeof s.record.updatedAt === 'string' ? s.record.updatedAt : null,
      updatedBy: typeof s.record.updatedBy === 'string' ? s.record.updatedBy : null
    }
  }

  /** Versions of a record, newest first (unreadable files are skipped). */
  async list(kind: FileKind, id: string): Promise<HistoryEntry[]> {
    const dir = this.dir(kind, id)
    const out: HistoryEntry[] = []
    for (const name of (await this.files(dir)).reverse()) {
      const s = await this.readFile(dir, name)
      if (s) out.push(this.entryOf(name, s))
    }
    return out
  }

  /** The stored record of one version; null when the file is gone or unreadable. */
  async read(kind: FileKind, id: string, file: string): Promise<SnapshotFile['record'] | null> {
    if (!/^[0-9A-Za-z_.-]+\.json$/.test(file)) return null
    return (await this.readFile(this.dir(kind, id), file))?.record ?? null
  }

  /** Records of `kind` whose latest version is a deletion and that do not exist any more, newest first. */
  async deleted(kind: FileKind, existing: ReadonlySet<string>): Promise<Array<HistoryEntry & { id: string; record: SnapshotFile['record'] }>> {
    const base = join(this.root, HISTORY_DIR, kind)
    let ids: string[]
    try {
      ids = await fs.readdir(base)
    } catch {
      return []
    }
    const out: Array<HistoryEntry & { id: string; record: SnapshotFile['record'] }> = []
    for (const id of ids) {
      if (existing.has(id)) continue
      const dir = join(base, id)
      const names = await this.files(dir)
      const last = names.at(-1)
      if (!last || !last.includes('_delete_')) continue
      const s = await this.readFile(dir, last)
      if (s) out.push({ ...this.entryOf(last, s), id, record: s.record })
    }
    return out.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1))
  }
}
