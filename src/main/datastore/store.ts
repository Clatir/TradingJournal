import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import type {
  ChangeSet,
  ConflictEntry,
  ConflictSide,
  FolderStatus,
  OrphanScreen,
  Problem,
  ProblemKind,
  RecordEntry,
  SaveScreenInput,
  SavedScreen,
  ScreensStats,
  Snapshot
} from '@shared/api'
import { createDefaultJournal } from '@shared/defaults'
import { newId } from '@shared/ids'
import {
  BACKUPS_DIR,
  COLLECTIONS,
  JOURNAL_FILE,
  SCREENS_DIR,
  classifyCanonical,
  dayRelPath,
  detectConflictName,
  isIgnoredPath,
  isScreenFile,
  kindOfDir,
  recordRelPath,
  sanitizeRelPath,
  screenRelPaths,
  type Collection,
  type ConflictName,
  type FileKind
} from '@shared/paths'
import { SCHEMAS, parseRecordText, serializeRecord, type AnyRecord, type RecordTypes } from '@shared/records'
import { SCHEMA_VERSION, type JournalFile, type ScreenRef } from '@shared/schema'
import { tradingDateNy } from '@shared/calc/time'
import { pathExists, removeFile, sha1, withRetry, writeFileAtomic } from './atomic'
import { mapLimit, walkFiles } from './fsutil'
import { zipFolder } from './zip'

interface FileState {
  relPath: string
  kind: FileKind
  mtimeMs: number
  size: number
  hash: string
  status: 'record' | 'copy' | 'problem'
  record: AnyRecord | JournalFile | null
  readOnly: boolean
  error: string | null
  problemKind: ProblemKind | null
  conflict: ConflictName | null
  migrated: boolean
  fromVersion: number
  text: string | null
}

export class ReadOnlyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReadOnlyError'
  }
}

export interface DataStoreOptions {
  machineName: string
  /** Move a file to the recycle bin (Electron shell.trashItem); defaults to deleting it. */
  trash?: (absPath: string) => Promise<void>
  now?: () => string
  /** Per-machine override of the backups folder (absolute). */
  backupDir?: string | null
  isSample?: boolean
}

export type FolderKind = 'journal' | 'empty' | 'other' | 'missing'

type ViewKey = string

interface Views {
  records: Record<Collection, Map<string, FileState>>
  conflicts: ConflictEntry[]
  problems: Problem[]
}

const emptyRecords = (): Record<Collection, Map<string, FileState>> => ({
  trades: new Map(),
  days: new Map(),
  weeks: new Map(),
  library: new Map()
})

function stamp(iso: string): string {
  return iso.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
}

/** Serializes async operations so scans and writes never interleave. */
class Mutex {
  private tail: Promise<unknown> = Promise.resolve()
  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn)
    this.tail = result.catch(() => undefined)
    return result
  }
}

export class DataStore {
  readonly root: string
  private files = new Map<string, FileState>()
  private prevKeys: Record<Collection, Map<string, ViewKey>> = {
    trades: new Map(),
    days: new Map(),
    weeks: new Map(),
    library: new Map()
  }
  private prevMeta = ''
  private readonly mutex = new Mutex()
  private readonly opts: Required<Omit<DataStoreOptions, 'backupDir' | 'isSample'>> & { backupDir: string | null; isSample: boolean }
  journal!: JournalFile
  private folderReadOnlyReason: string | null = null
  private folderSchemaVersion = SCHEMA_VERSION
  private available = true
  migratedFrom: number | null = null
  backupPath: string | null = null
  otherMachines: FolderStatus['otherMachines'] = []

  constructor(root: string, opts: DataStoreOptions) {
    this.root = root
    this.opts = {
      machineName: opts.machineName,
      trash: opts.trash ?? ((p) => fs.rm(p, { force: true })),
      now: opts.now ?? (() => new Date().toISOString()),
      backupDir: opts.backupDir ?? null,
      isSample: opts.isSample ?? false
    }
  }

  // ---------------------------------------------------------------- folder lifecycle

  static async inspect(root: string): Promise<FolderKind> {
    try {
      const st = await fs.stat(root)
      if (!st.isDirectory()) return 'missing'
    } catch {
      return 'missing'
    }
    if (await pathExists(join(root, JOURNAL_FILE))) return 'journal'
    const entries = (await fs.readdir(root)).filter((n) => !n.startsWith('.') && n !== 'desktop.ini' && n !== 'Thumbs.db')
    return entries.length === 0 ? 'empty' : 'other'
  }

  /** Create the folder layout and a default journal.json in an empty folder. */
  static async initialize(root: string, journal: JournalFile = createDefaultJournal()): Promise<void> {
    await fs.mkdir(root, { recursive: true })
    if (await pathExists(join(root, JOURNAL_FILE))) throw new Error('Ten folder zawiera już dziennik (journal.json).')
    for (const dir of [...COLLECTIONS, SCREENS_DIR, BACKUPS_DIR]) await fs.mkdir(join(root, dir), { recursive: true })
    await writeFileAtomic(join(root, JOURNAL_FILE), serializeRecord('journal', journal))
  }

  get backupsDir(): string {
    return this.opts.backupDir ?? join(this.root, BACKUPS_DIR)
  }

  /** Per-machine backup location (null = backups/ inside the data folder). */
  setBackupDir(dir: string | null): void {
    this.opts.backupDir = dir
  }

  abs(rel: string): string {
    const clean = sanitizeRelPath(rel)
    if (!clean) throw new Error(`Niedozwolona ścieżka: ${rel}`)
    return join(this.root, ...clean.split('/'))
  }

  open(): Promise<Snapshot> {
    return this.mutex.run(async () => {
      const t0 = performance.now()
      const kind = await DataStore.inspect(this.root)
      if (kind !== 'journal') throw new Error('W tym folderze nie ma pliku journal.json.')
      await this.scanAll()
      this.applyJournalState()
      if (!this.folderReadOnlyReason) await this.migrateIfNeeded()
      await this.cleanupTempFiles()
      const views = this.buildViews()
      this.commit(views)
      return { ...this.snapshotFrom(views), loadMs: Math.round(performance.now() - t0) }
    })
  }

  status(): FolderStatus {
    return {
      dataDir: this.root,
      available: this.available,
      readOnly: !!this.folderReadOnlyReason || !this.available,
      readOnlyReason: !this.available
        ? 'Folder danych jest niedostępny (odłączony dysk lub brak dostępu). Zmiany nie są zapisywane.'
        : this.folderReadOnlyReason,
      folderSchemaVersion: this.folderSchemaVersion,
      appSchemaVersion: SCHEMA_VERSION,
      otherMachines: this.otherMachines,
      migratedFrom: this.migratedFrom,
      backupPath: this.backupPath,
      isSample: this.opts.isSample
    }
  }

  // ---------------------------------------------------------------- reading

  private async listDataFiles(): Promise<string[]> {
    const rels: string[] = []
    for (const c of COLLECTIONS) rels.push(...(await walkFiles(this.root, join(this.root, c), isIgnoredPath)))
    const rootEntries = await fs.readdir(this.root, { withFileTypes: true })
    for (const e of rootEntries) if (e.isFile() && e.name.toLowerCase().endsWith('.json') && !isIgnoredPath(e.name)) rels.push(e.name)
    return rels
  }

  private async scanAll(): Promise<void> {
    const rels = await this.listDataFiles()
    const states = await mapLimit(rels, 64, (rel) => this.loadFile(rel))
    const next = new Map<string, FileState>()
    states.forEach((s) => s && next.set(s.relPath, s))
    this.files = next
  }

  private async loadFile(rel: string): Promise<FileState | null> {
    const abs = join(this.root, ...rel.split('/'))
    let st
    try {
      st = await fs.stat(abs)
    } catch {
      return null
    }
    if (!st.isFile()) return null
    const prev = this.files.get(rel)
    if (prev && prev.mtimeMs === st.mtimeMs && prev.size === st.size) return prev
    let buf: Buffer
    try {
      buf = await withRetry(() => fs.readFile(abs))
    } catch (e) {
      return this.problemState(rel, st, '', 'corrupt', `Nie można odczytać pliku: ${(e as Error).message}`)
    }
    const hash = sha1(buf)
    if (prev && prev.hash === hash) return { ...prev, mtimeMs: st.mtimeMs, size: st.size }
    const text = buf.toString('utf8')

    const canonical = classifyCanonical(rel)
    if (canonical) return this.parseState(rel, canonical, text, hash, st)
    const conflict = detectConflictName(rel)
    if (conflict) {
      const parsed = this.parseState(rel, conflict.kind, text, hash, st)
      return { ...parsed, status: 'copy', conflict, problemKind: null }
    }
    if (rel.toLowerCase().endsWith('.json') && kindOfDir(rel)) {
      return this.problemState(rel, st, hash, 'unknown-file', 'Nieznany plik JSON (nazwa nie pasuje do układu folderu danych).')
    }
    return null
  }

  private problemState(
    rel: string,
    st: { mtimeMs: number; size: number },
    hash: string,
    kind: ProblemKind,
    message: string
  ): FileState {
    return {
      relPath: rel,
      kind: kindOfDir(rel) ?? 'journal',
      mtimeMs: st.mtimeMs,
      size: st.size,
      hash,
      status: 'problem',
      record: null,
      readOnly: true,
      error: message,
      problemKind: kind,
      conflict: null,
      migrated: false,
      fromVersion: SCHEMA_VERSION,
      text: null
    }
  }

  private parseState(rel: string, kind: FileKind, text: string, hash: string, st: { mtimeMs: number; size: number }): FileState {
    const base = {
      relPath: rel,
      kind,
      mtimeMs: st.mtimeMs,
      size: st.size,
      hash,
      conflict: null,
      text
    }
    const outcome = parseRecordText(kind, text)
    if (outcome.ok) {
      return {
        ...base,
        status: 'record',
        record: outcome.value,
        readOnly: false,
        error: null,
        problemKind: null,
        migrated: outcome.migrated,
        fromVersion: outcome.fromVersion
      }
    }
    if (outcome.tooNewVersion != null) {
      // Newer format: show it read-only if it still fits the current schema, never overwrite it.
      try {
        const raw = JSON.parse(text) as Record<string, unknown>
        delete raw.computed
        const parsed = SCHEMAS[kind].safeParse(raw)
        if (parsed.success) {
          return {
            ...base,
            status: 'record',
            record: parsed.data,
            readOnly: true,
            error: outcome.error,
            problemKind: null,
            migrated: false,
            fromVersion: outcome.tooNewVersion
          }
        }
      } catch {
        /* fall through */
      }
      return this.problemState(rel, st, hash, 'too-new', outcome.error)
    }
    const problemKind: ProblemKind = outcome.error.startsWith('Uszkodzony JSON') ? 'corrupt' : 'invalid'
    return { ...this.problemState(rel, st, hash, problemKind, outcome.error), kind }
  }

  private applyJournalState(): void {
    const state = this.files.get(JOURNAL_FILE)
    if (!state || state.status !== 'record' || !state.record) {
      const msg = state?.error ?? 'Brak pliku journal.json'
      throw new Error(`Nie można wczytać journal.json: ${msg}`)
    }
    this.journal = state.record as JournalFile
    this.folderSchemaVersion = state.readOnly ? state.fromVersion : SCHEMA_VERSION
    this.folderReadOnlyReason = state.readOnly
      ? `Folder danych ma format v${state.fromVersion}, a ta wersja aplikacji obsługuje v${SCHEMA_VERSION}. ` +
        'Zaktualizuj aplikację - do tego czasu dane są tylko do odczytu.'
      : null
  }

  /**
   * journal.json changed on disk while the folder is open. A broken file (e.g. half-synced) must not
   * take the folder down: the last good settings stay in memory and the file shows up as a problem.
   * Returns true when new settings were loaded.
   */
  private refreshJournalState(): boolean {
    const state = this.files.get(JOURNAL_FILE)
    if (state?.status === 'record' && state.record) {
      this.applyJournalState()
      return true
    }
    if (state?.problemKind === 'too-new') {
      this.folderReadOnlyReason =
        'journal.json zapisała nowsza wersja aplikacji (nowszy format danych). Zaktualizuj aplikację - do tego czasu dane są tylko do odczytu.'
    }
    return false
  }

  // ---------------------------------------------------------------- migrations

  private async migrateIfNeeded(): Promise<void> {
    const pending = [...this.files.values()].filter((s) => s.status === 'record' && s.migrated && !s.readOnly)
    if (pending.length === 0) return
    const journalState = this.files.get(JOURNAL_FILE)
    const from = Math.min(...pending.map((s) => s.fromVersion))
    if (journalState?.migrated) {
      // Folder-level migration: full ZIP backup first.
      const out = join(this.backupsDir, 'pre-migration', `${stamp(this.opts.now())}_v${from}-v${SCHEMA_VERSION}.zip`)
      await zipFolder(this.root, out, (rel) => !isIgnoredPath(rel))
      this.backupPath = out
      this.migratedFrom = journalState.fromVersion
    } else {
      await this.backupOriginals(pending)
    }
    for (const s of pending) await this.rewrite(s)
  }

  /** Keep the original text of single migrated files (e.g. synced from an older app version). */
  private async backupOriginals(states: FileState[]): Promise<void> {
    const dir = join(this.backupsDir, 'pre-migration', stamp(this.opts.now()))
    for (const s of states) {
      if (s.text == null) continue
      await writeFileAtomic(join(dir, ...s.relPath.split('/')), s.text)
    }
    this.backupPath = dir
  }

  /** Settings + day plan of the trade's date, for the informational `computed` block. */
  private ctxFor(kind: FileKind, record: AnyRecord): { settings: JournalFile['settings']; dayPlan: RecordTypes['days'] | null } | undefined {
    if (kind !== 'trades') return undefined
    const date = tradingDateNy((record as RecordTypes['trades']).entryTime)
    const day = this.files.get(dayRelPath(date))
    return { settings: this.journal.settings, dayPlan: day?.status === 'record' ? (day.record as RecordTypes['days']) : null }
  }

  private async rewrite(s: FileState): Promise<void> {
    const text = serializeRecord(s.kind, s.record as AnyRecord, this.ctxFor(s.kind, s.record as AnyRecord))
    await this.writeState(s.relPath, s.kind, s.record as AnyRecord, text)
  }

  private async writeState(rel: string, kind: FileKind, record: AnyRecord | JournalFile, text: string): Promise<FileState> {
    const abs = this.abs(rel)
    await writeFileAtomic(abs, text)
    const st = await fs.stat(abs)
    const state: FileState = {
      relPath: rel,
      kind,
      mtimeMs: st.mtimeMs,
      size: st.size,
      hash: sha1(text),
      status: 'record',
      record,
      readOnly: false,
      error: null,
      problemKind: null,
      conflict: null,
      migrated: false,
      fromVersion: SCHEMA_VERSION,
      text
    }
    this.files.set(rel, state)
    return state
  }

  private async cleanupTempFiles(): Promise<void> {
    const cutoff = Date.now() - 60 * 60 * 1000
    for (const dir of [...COLLECTIONS, SCREENS_DIR]) {
      const all = await walkFiles(this.root, join(this.root, dir))
      for (const rel of all.filter((r) => r.includes('.tmp-'))) {
        try {
          const st = await fs.stat(join(this.root, rel))
          if (st.mtimeMs < cutoff) await removeFile(join(this.root, rel))
        } catch {
          /* ignore */
        }
      }
    }
  }

  // ---------------------------------------------------------------- views & diffs

  private buildViews(): Views {
    const records = emptyRecords()
    const conflicts: ConflictEntry[] = []
    const problems: Problem[] = []
    const groups = new Map<string, FileState[]>()

    for (const s of this.files.values()) {
      if (s.status === 'problem') {
        problems.push({ relPath: s.relPath, kind: s.problemKind ?? 'invalid', message: s.error ?? '' })
        continue
      }
      if (s.status === 'copy' || s.kind === 'journal') continue
      const id = (s.record as AnyRecord).id
      const key = `${s.kind}:${id}`
      const g = groups.get(key)
      if (g) g.push(s)
      else groups.set(key, [s])
    }

    for (const [key, group] of groups) {
      const kind = key.split(':')[0] as Collection
      const sorted = [...group].sort((a, b) => {
        const ua = (a.record as AnyRecord).updatedAt
        const ub = (b.record as AnyRecord).updatedAt
        if (ua !== ub) return ua < ub ? 1 : -1
        return a.relPath < b.relPath ? -1 : 1
      })
      const primary = sorted[0] as FileState
      records[kind].set((primary.record as AnyRecord).id, primary)
      for (const dup of sorted.slice(1)) {
        conflicts.push({
          id: dup.relPath,
          kind,
          type: 'duplicate',
          source: 'ten sam identyfikator w dwóch plikach',
          canonical: this.side(primary),
          copy: this.side(dup)
        })
      }
    }

    for (const s of this.files.values()) {
      if (s.status !== 'copy' || !s.conflict) continue
      const canonicalState = this.files.get(s.conflict.canonicalPath)
      conflicts.push({
        id: s.relPath,
        kind: s.kind,
        type: 'copy',
        source: s.conflict.source,
        canonical: canonicalState
          ? this.side(canonicalState)
          : { relPath: s.conflict.canonicalPath, record: null, error: 'Brak pliku oryginalnego', updatedAt: null, mtimeMs: 0 },
        copy: this.side(s)
      })
    }

    conflicts.sort((a, b) => a.id.localeCompare(b.id))
    problems.sort((a, b) => a.relPath.localeCompare(b.relPath))
    return { records, conflicts, problems }
  }

  private side(s: FileState): ConflictSide {
    return {
      relPath: s.relPath,
      record: s.record,
      error: s.error,
      updatedAt: (s.record as { updatedAt?: string } | null)?.updatedAt ?? null,
      mtimeMs: s.mtimeMs
    }
  }

  private entry<C extends Collection>(s: FileState): RecordEntry<RecordTypes[C]> {
    return { record: s.record as RecordTypes[C], relPath: s.relPath, readOnly: s.readOnly }
  }

  private snapshotFrom(views: Views): Omit<Snapshot, 'loadMs'> {
    const list = <C extends Collection>(c: C) => [...views.records[c].values()].map((s) => this.entry<C>(s))
    return {
      journal: this.journal,
      trades: list('trades'),
      days: list('days'),
      weeks: list('weeks'),
      library: list('library'),
      problems: views.problems,
      conflicts: views.conflicts,
      status: this.status()
    }
  }

  private viewKey(s: FileState): ViewKey {
    return `${s.relPath}|${s.hash}|${s.readOnly ? 1 : 0}`
  }

  private metaKey(views: Views): string {
    return JSON.stringify([views.problems, views.conflicts.map((c) => [c.id, c.canonical.mtimeMs, c.copy.mtimeMs]), this.status(), this.journal.updatedAt])
  }

  private commit(views: Views): void {
    for (const c of COLLECTIONS) {
      const keys = new Map<string, ViewKey>()
      for (const [id, s] of views.records[c]) keys.set(id, this.viewKey(s))
      this.prevKeys[c] = keys
    }
    this.prevMeta = this.metaKey(views)
  }

  private diff(views: Views, journalChanged: boolean): ChangeSet | null {
    const change: ChangeSet = {
      upserts: [],
      removals: [],
      journal: journalChanged ? this.journal : null,
      problems: views.problems,
      conflicts: views.conflicts,
      status: this.status()
    }
    for (const c of COLLECTIONS) {
      const prev = this.prevKeys[c]
      for (const [id, s] of views.records[c]) {
        if (prev.get(id) !== this.viewKey(s)) change.upserts.push({ collection: c, entry: this.entry(s) })
      }
      for (const id of prev.keys()) if (!views.records[c].has(id)) change.removals.push({ collection: c, id })
    }
    const metaChanged = this.metaKey(views) !== this.prevMeta
    this.commit(views)
    if (!change.upserts.length && !change.removals.length && !journalChanged && !metaChanged) return null
    return change
  }

  // ---------------------------------------------------------------- external changes

  /**
   * Re-read changed files. `paths` = relative paths reported by the watcher; omit for a full rescan.
   * Returns null when nothing visible changed.
   */
  refresh(paths?: string[]): Promise<ChangeSet | null> {
    return this.mutex.run(async () => {
      const wasAvailable = this.available
      this.available = (await DataStore.inspect(this.root)) === 'journal'
      if (!this.available) {
        // Keep everything in memory; the folder may come back (pendrive, network drive).
        return wasAvailable ? this.diff(this.buildViews(), false) : null
      }
      const journalBefore = this.files.get(JOURNAL_FILE)?.hash
      const needsFull = !paths || !wasAvailable || paths.some((p) => !p.toLowerCase().endsWith('.json'))
      if (needsFull) {
        const rels = await this.listDataFiles()
        const seen = new Set(rels)
        const states = await mapLimit(rels, 64, (rel) => this.loadFile(rel))
        for (const rel of [...this.files.keys()]) if (!seen.has(rel)) this.files.delete(rel)
        states.forEach((s) => s && this.files.set(s.relPath, s))
      } else {
        for (const p of new Set(paths)) {
          const rel = sanitizeRelPath(p)
          if (!rel || isIgnoredPath(rel)) continue
          const s = await this.loadFile(rel)
          if (s) this.files.set(rel, s)
          else this.files.delete(rel)
        }
      }
      const journalChanged = this.files.get(JOURNAL_FILE)?.hash !== journalBefore && this.refreshJournalState()
      if (!this.folderReadOnlyReason) {
        const migrated = [...this.files.values()].filter((s) => s.status === 'record' && s.migrated && !s.readOnly)
        if (migrated.length) {
          await this.backupOriginals(migrated)
          for (const s of migrated) await this.rewrite(s)
        }
      }
      return this.diff(this.buildViews(), journalChanged)
    })
  }

  // ---------------------------------------------------------------- writing

  private assertWritable(): void {
    const status = this.status()
    if (status.readOnly) throw new ReadOnlyError(status.readOnlyReason ?? 'Tylko do odczytu')
  }

  private currentState(collection: Collection, id: string): FileState | null {
    const candidates = [...this.files.values()].filter(
      (s) => s.status === 'record' && s.kind === collection && (s.record as AnyRecord).id === id
    )
    if (candidates.length === 0) return null
    return candidates.sort((a, b) => ((a.record as AnyRecord).updatedAt < (b.record as AnyRecord).updatedAt ? 1 : -1))[0] ?? null
  }

  /**
   * A corrupt / invalid file sits where a record is about to be written (e.g. a half-synced day plan):
   * move it aside as a conflict copy instead of overwriting it. A file in a newer format is never replaced.
   */
  private async setAsideProblem(state: FileState): Promise<void> {
    if (state.problemKind === 'too-new') {
      throw new ReadOnlyError(`Plik ${state.relPath} zapisała nowsza wersja aplikacji – zaktualizuj aplikację, żeby go zmienić.`)
    }
    const copyRel = state.relPath.replace(/\.json$/i, `-uszkodzona-${stamp(this.opts.now())}.json`)
    try {
      await withRetry(() => fs.rename(this.abs(state.relPath), this.abs(copyRel)))
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    }
    this.files.delete(state.relPath)
    const copy = await this.loadFile(copyRel)
    if (copy) this.files.set(copyRel, copy)
  }

  /** If the file on disk changed behind our back, keep that version as a conflict copy before overwriting. */
  private async preserveExternalChange(existing: FileState): Promise<void> {
    const abs = this.abs(existing.relPath)
    let buf: Buffer
    try {
      const st = await fs.stat(abs)
      if (st.mtimeMs === existing.mtimeMs && st.size === existing.size) return
      buf = await fs.readFile(abs)
    } catch {
      return
    }
    if (sha1(buf) === existing.hash) return
    const copyRel = existing.relPath.replace(/\.json$/, `-zewnetrzna-${stamp(this.opts.now())}.json`)
    await writeFileAtomic(this.abs(copyRel), buf)
    const st = await this.loadFile(copyRel)
    if (st) this.files.set(copyRel, st)
  }

  saveRecord<C extends Collection>(collection: C, input: RecordTypes[C]): Promise<{ entry: RecordEntry<RecordTypes[C]>; change: ChangeSet | null }> {
    return this.mutex.run(async () => {
      this.assertWritable()
      const existing = this.currentState(collection, input.id)
      if (existing?.readOnly) throw new ReadOnlyError('Ten wpis zapisała nowsza wersja aplikacji - jest tylko do odczytu.')
      const parsed = SCHEMAS[collection].safeParse({ ...input, schemaVersion: SCHEMA_VERSION, updatedAt: this.opts.now() })
      if (!parsed.success) throw new Error(`Niepoprawne dane: ${parsed.error.issues[0]?.path.join('.')}: ${parsed.error.issues[0]?.message}`)
      const record = parsed.data as RecordTypes[C]
      const rel = recordRelPath(collection, record as unknown as Record<string, unknown>)
      const occupant = this.files.get(rel)
      if (occupant?.status === 'record' && (occupant.record as AnyRecord).id !== record.id) {
        throw new Error(`Plik ${rel} należy do innego wpisu (np. plan dla tej daty już istnieje).`)
      }
      if (occupant?.status === 'problem') await this.setAsideProblem(occupant)
      if (existing) await this.preserveExternalChange(existing)
      const text = serializeRecord(collection, record, this.ctxFor(collection, record))
      const state = await this.writeState(rel, collection, record, text)
      if (existing && existing.relPath !== rel) {
        await removeFile(this.abs(existing.relPath))
        this.files.delete(existing.relPath)
      }
      const change = this.diff(this.buildViews(), false)
      return { entry: this.entry<C>(state), change }
    })
  }

  deleteRecord(collection: Collection, id: string): Promise<ChangeSet | null> {
    return this.mutex.run(async () => {
      this.assertWritable()
      const state = this.currentState(collection, id)
      if (!state) return null
      if (state.readOnly) throw new ReadOnlyError('Ten wpis jest tylko do odczytu.')
      await this.opts.trash(this.abs(state.relPath))
      this.files.delete(state.relPath)
      // Screens shared with another record (e.g. a library example) stay.
      const stillUsed = this.referencedScreens()
      for (const screen of screensOf(collection, state.record as AnyRecord)) {
        for (const p of [screen.path, screen.thumbPath]) {
          if (stillUsed.has(p)) continue
          try {
            const abs = this.abs(p)
            if (await pathExists(abs)) await this.opts.trash(abs)
          } catch {
            // A hand-edited path or a locked file: the record is already gone, the file stays as an orphan.
          }
        }
      }
      return this.diff(this.buildViews(), false)
    })
  }

  /** Write imported records as-is (keeping their updatedAt), moving files whose canonical path changed. */
  importRecords(items: Array<{ kind: Collection; record: AnyRecord }>): Promise<ChangeSet | null> {
    return this.mutex.run(async () => {
      this.assertWritable()
      for (const { kind, record } of items) {
        const parsed = SCHEMAS[kind].parse({ ...record, schemaVersion: SCHEMA_VERSION }) as AnyRecord
        const existing = this.currentState(kind, parsed.id)
        if (existing?.readOnly) continue
        const rel = recordRelPath(kind, parsed as unknown as Record<string, unknown>)
        const occupant = this.files.get(rel)
        if (occupant?.status === 'record' && (occupant.record as AnyRecord).id !== parsed.id) {
          if (occupant.readOnly) continue
          // Same date/week plan with a different id: the imported one replaces it.
          await this.opts.trash(this.abs(rel))
          this.files.delete(rel)
        }
        if (occupant?.status === 'problem') {
          if (occupant.problemKind === 'too-new') continue
          await this.setAsideProblem(occupant)
        }
        await this.writeState(rel, kind, parsed, serializeRecord(kind, parsed, this.ctxFor(kind, parsed)))
        if (existing && existing.relPath !== rel) {
          await removeFile(this.abs(existing.relPath))
          this.files.delete(existing.relPath)
        }
      }
      return this.diff(this.buildViews(), false)
    })
  }

  saveJournal(input: JournalFile): Promise<JournalFile> {
    return this.mutex.run(async () => {
      this.assertWritable()
      const journal = SCHEMAS.journal.parse({ ...input, schemaVersion: SCHEMA_VERSION, updatedAt: this.opts.now() })
      const existing = this.files.get(JOURNAL_FILE)
      if (existing?.status === 'problem') await this.setAsideProblem(existing)
      else if (existing) await this.preserveExternalChange(existing)
      await this.writeState(JOURNAL_FILE, 'journal', journal, serializeRecord('journal', journal))
      this.journal = journal
      this.commit(this.buildViews())
      return journal
    })
  }

  saveScreen(input: SaveScreenInput): Promise<SavedScreen> {
    return this.mutex.run(async () => {
      this.assertWritable()
      const id = newId()
      const { path, thumbPath } = screenRelPaths(id, input.label, input.date)
      await writeFileAtomic(this.abs(path), input.image)
      await writeFileAtomic(this.abs(thumbPath), input.thumb)
      return {
        id,
        path,
        thumbPath,
        width: input.width,
        height: input.height,
        bytes: input.image.byteLength,
        createdAt: this.opts.now()
      }
    })
  }

  // ---------------------------------------------------------------- screens housekeeping

  private referencedScreens(): Set<string> {
    const refs = new Set<string>()
    for (const s of this.files.values()) {
      if (!s.record || s.kind === 'journal') continue
      for (const screen of screensOf(s.kind, s.record as AnyRecord)) {
        refs.add(screen.path)
        refs.add(screen.thumbPath)
      }
    }
    return refs
  }

  screensStats(): Promise<ScreensStats> {
    return this.mutex.run(async () => {
      const rels = await walkFiles(this.root, join(this.root, SCREENS_DIR), isIgnoredPath)
      const refs = this.referencedScreens()
      let totalBytes = 0
      const sizes = new Map<string, { bytes: number; mtimeMs: number }>()
      await mapLimit(rels, 64, async (rel) => {
        try {
          const st = await fs.stat(join(this.root, rel))
          totalBytes += st.size
          sizes.set(rel, { bytes: st.size, mtimeMs: st.mtimeMs })
        } catch {
          /* removed */
        }
      })
      const orphans: OrphanScreen[] = []
      for (const [rel, info] of sizes) {
        if (!isScreenFile(rel) || refs.has(rel) || rel.endsWith('.thumb.webp')) continue
        const thumb = rel.replace(/\.webp$/, '.thumb.webp')
        const thumbInfo = sizes.get(thumb)
        orphans.push({
          path: rel,
          thumbPath: thumbInfo && !refs.has(thumb) ? thumb : null,
          bytes: info.bytes + (thumbInfo && !refs.has(thumb) ? thumbInfo.bytes : 0),
          mtimeMs: info.mtimeMs
        })
      }
      // Thumbnails whose main image is gone.
      for (const [rel, info] of sizes) {
        if (!rel.endsWith('.thumb.webp') || refs.has(rel)) continue
        if (!sizes.has(rel.replace(/\.thumb\.webp$/, '.webp'))) orphans.push({ path: rel, thumbPath: null, bytes: info.bytes, mtimeMs: info.mtimeMs })
      }
      orphans.sort((a, b) => a.path.localeCompare(b.path))
      return { totalBytes, fileCount: sizes.size, orphans }
    })
  }

  async deleteScreens(paths: string[]): Promise<number> {
    const stats = await this.screensStats()
    return this.mutex.run(async () => {
      this.assertWritable()
      const allowed = new Map(stats.orphans.map((o) => [o.path, o]))
      let removed = 0
      for (const p of paths) {
        const orphan = allowed.get(p)
        if (!orphan) continue
        for (const rel of [orphan.path, orphan.thumbPath]) {
          if (!rel) continue
          const abs = this.abs(rel)
          if (await pathExists(abs)) {
            await this.opts.trash(abs)
            removed++
          }
        }
      }
      return removed
    })
  }

  // ---------------------------------------------------------------- conflicts & problems

  async resolveConflict(conflictId: string, keep: 'canonical' | 'copy'): Promise<ChangeSet | null> {
    await this.mutex.run(async () => {
      this.assertWritable()
      const conflict = this.buildViews().conflicts.find((c) => c.id === conflictId)
      if (!conflict) throw new Error('Konflikt już nie istnieje (mógł zostać rozwiązany na innym komputerze).')
      if (keep === 'canonical') {
        await this.opts.trash(this.abs(conflict.copy.relPath))
        this.files.delete(conflict.copy.relPath)
        return
      }
      const copyState = this.files.get(conflict.copy.relPath)
      if (!copyState?.record) throw new Error('Kopii nie da się odczytać - można zachować tylko oryginał.')
      // The kept version is rewritten (newest updatedAt) at its canonical path; every other file of the pair goes to the bin.
      let keptPath: string
      let keptId: string
      if (conflict.kind === 'journal') {
        const journal = SCHEMAS.journal.parse({ ...(copyState.record as JournalFile), updatedAt: this.opts.now() })
        await this.writeState(JOURNAL_FILE, 'journal', journal, serializeRecord('journal', journal))
        this.journal = journal
        keptPath = JOURNAL_FILE
        keptId = journal.id
      } else {
        const kind = conflict.kind as Collection
        const record = { ...(copyState.record as AnyRecord), updatedAt: this.opts.now() } as AnyRecord
        keptPath = recordRelPath(kind, record as unknown as Record<string, unknown>)
        keptId = record.id
        await this.writeState(keptPath, kind, record, serializeRecord(kind, record, this.ctxFor(kind, record)))
      }
      for (const side of [conflict.canonical, conflict.copy]) {
        if (side.relPath === keptPath) continue
        const state = this.files.get(side.relPath)
        if (!state) continue
        const sameRecord = (state.record as { id?: string } | null)?.id === keptId
        if (state.status !== 'record' || sameRecord) {
          await this.opts.trash(this.abs(side.relPath))
          this.files.delete(side.relPath)
        }
      }
    })
    return this.refresh()
  }

  async trashFile(relPath: string): Promise<ChangeSet | null> {
    await this.mutex.run(async () => {
      this.assertWritable()
      const s = this.files.get(relPath)
      if (!s || s.status === 'record') throw new Error('Można usuwać tylko pliki z listy problemów lub kopie konfliktów.')
      await this.opts.trash(this.abs(relPath))
      this.files.delete(relPath)
    })
    return this.refresh()
  }

  /** Snapshot of everything currently loaded (used after reconnecting the renderer). */
  snapshot(): Promise<Snapshot> {
    return this.mutex.run(async () => ({ ...this.snapshotFrom(this.buildViews()), loadMs: 0 }))
  }

  /** Directory of a file, for "show in folder". */
  dirOf(rel: string): string {
    return dirname(this.abs(rel))
  }
}

export function screensOf(kind: FileKind, record: AnyRecord): ScreenRef[] {
  switch (kind) {
    case 'trades':
    case 'library':
      return (record as RecordTypes['trades'] | RecordTypes['library']).screens
    case 'days': {
      const day = record as RecordTypes['days']
      return [...day.screens, ...day.pairs.flatMap((p) => p.screens)]
    }
    default:
      return []
  }
}
