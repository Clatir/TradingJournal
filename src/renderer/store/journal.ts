import { create } from 'zustand'
import type { AppInfo, ChangeSet, ConflictEntry, FolderStatus, Problem, RecordEntry, Snapshot } from '@shared/api'
import type { Collection } from '@shared/paths'
import type { RecordTypes } from '@shared/records'
import type { JournalFile } from '@shared/schema'
import { chooser, merge3, type Side } from '@shared/merge'
import { decideRemote, decideRemoteRemoval, type RemoteMode } from '@shared/remoteChanges'
import { api, errorMessage } from '../lib/api'
import { useRemote, type PendingRemote } from './remote'
import { toast } from './ui'

type EntryMap<C extends Collection> = Record<string, RecordEntry<RecordTypes[C]>>

export interface SaveState {
  pending: number
  lastSavedAt: string | null
  error: string | null
}

interface JournalState {
  phase: 'boot' | 'setup' | 'ready'
  setupMessage: string | null
  setupDir: string | null
  appInfo: AppInfo | null
  journal: JournalFile | null
  trades: EntryMap<'trades'>
  days: EntryMap<'days'>
  weeks: EntryMap<'weeks'>
  library: EntryMap<'library'>
  forecasts: EntryMap<'forecasts'>
  drills: EntryMap<'drills'>
  problems: Problem[]
  conflicts: ConflictEntry[]
  status: FolderStatus | null
  loadMs: number
  save: SaveState
  /** Records created in the UI that were never edited (not written to disk yet). */
  drafts: Record<string, true>
}

const SAVE_DELAY_DEFAULT = 400
/** Even while typing continuously, a change is written at most this long after it was made. */
const SAVE_MAX_WAIT_DEFAULT = 2000
/** E2E hook: a longer autosave delay (window.__ICTJ_SAVE_DELAY__) keeps edits unsaved long enough to test merges. */
const testDelay = () => (globalThis as { __ICTJ_SAVE_DELAY__?: number }).__ICTJ_SAVE_DELAY__
const saveDelay = () => testDelay() ?? SAVE_DELAY_DEFAULT
const saveMaxWait = () => Math.max(testDelay() ?? 0, SAVE_MAX_WAIT_DEFAULT)
/** A failed save (file locked by OneDrive, pendrive briefly gone…) is retried with backoff. */
const RETRY_FIRST = 2000
const RETRY_MAX = 60_000

const timers = new Map<string, ReturnType<typeof setTimeout>>()
const versions = new Map<string, number>()
const dirty = new Map<string, { collection: Collection | 'journal'; id: string }>()
const inFlight = new Map<string, Promise<void>>()
const firstDirtyAt = new Map<string, number>()
const retryDelay = new Map<string, number>()
/** Keys whose last save attempt failed, with the error message. */
const failed = new Map<string, string>()
/**
 * Version of a dirty record as it is on disk (before the local edits, or the last version this computer wrote):
 * the base of a three-way merge when the same record changes on another computer.
 */
const bases = new Map<string, unknown>()

const saveError = (): string | null => [...failed.values()].at(-1) ?? null

function forget(key: string): void {
  const t = timers.get(key)
  if (t) clearTimeout(t)
  timers.delete(key)
  dirty.delete(key)
  firstDirtyAt.delete(key)
  retryDelay.delete(key)
  failed.delete(key)
  bases.delete(key)
}

const keyOf = (collection: Collection | 'journal', id: string) => `${collection}:${id}`

function toMap<C extends Collection>(entries: RecordEntry<RecordTypes[C]>[]): EntryMap<C> {
  const out: EntryMap<C> = {}
  for (const e of entries) out[e.record.id] = e
  return out
}

export const useJournal = create<JournalState>(() => ({
  phase: 'boot',
  setupMessage: null,
  setupDir: null,
  appInfo: null,
  journal: null,
  trades: {},
  days: {},
  weeks: {},
  library: {},
  forecasts: {},
  drills: {},
  problems: [],
  conflicts: [],
  status: null,
  loadMs: 0,
  save: { pending: 0, lastSavedAt: null, error: null },
  drafts: {}
}))

const set = useJournal.setState
const get = useJournal.getState

function bumpPending(delta: number, patch: Partial<SaveState> = {}): void {
  set((s) => ({ save: { ...s.save, pending: Math.max(0, s.save.pending + delta), ...patch } }))
}

export function applySnapshot(snapshot: Snapshot): void {
  for (const t of timers.values()) clearTimeout(t)
  timers.clear()
  dirty.clear()
  firstDirtyAt.clear()
  retryDelay.clear()
  failed.clear()
  bases.clear()
  useRemote.setState({ pending: [], open: false })
  set({
    phase: 'ready',
    setupMessage: null,
    setupDir: null,
    journal: snapshot.journal,
    trades: toMap(snapshot.trades),
    days: toMap(snapshot.days),
    weeks: toMap(snapshot.weeks),
    library: toMap(snapshot.library),
    forecasts: toMap(snapshot.forecasts),
    drills: toMap(snapshot.drills),
    problems: snapshot.problems,
    conflicts: snapshot.conflicts,
    status: snapshot.status,
    loadMs: snapshot.loadMs,
    drafts: {},
    save: { pending: 0, lastSavedAt: null, error: null }
  })
}

const pendingFor = (key: string) => useRemote.getState().pending.find((p) => p.key === key)

/**
 * Apply changes coming from disk.
 * - Own actions (origin 'local') and anything without local unsaved edits in "merge" mode: taken as they are.
 * - From outside (another computer): a record with local unsaved edits is merged field by field (shared/merge.ts);
 *   fields changed on both sides – or every change in "ask" mode – wait for a decision in the dialog
 *   (store/remote.ts), and the record is not saved until then. Nothing is overwritten silently.
 */
export function applyChange(change: ChangeSet): void {
  const external = change.origin === 'external'
  const mode: RemoteMode = get().journal?.settings.sync.remoteChanges ?? 'merge'
  const queued: PendingRemote[] = []
  const toSave: Array<{ collection: Collection | 'journal'; id: string; from: string | null }> = []
  const now = new Date().toISOString()
  const queue = (item: Omit<PendingRemote, 'receivedAt' | 'hadLocalEdits'>, localEdits: boolean) => {
    const prev = pendingFor(item.key)
    queued.push({ ...item, base: prev ? prev.base : item.base, hadLocalEdits: localEdits || !!prev?.hadLocalEdits, receivedAt: now })
  }
  set((s) => {
    const next: Partial<JournalState> = {
      problems: change.problems,
      conflicts: change.conflicts,
      status: change.status
    }
    const maps: Partial<Record<Collection, Record<string, RecordEntry<RecordTypes[Collection]>>>> = {}
    const mapFor = (c: Collection) => (maps[c] ??= { ...(s[c] as Record<string, RecordEntry<RecordTypes[Collection]>>) })
    for (const { collection, entry } of change.upserts) {
      const id = entry.record.id
      const key = keyOf(collection, id)
      const local = (s[collection] as Record<string, RecordEntry<RecordTypes[Collection]>>)[id]
      if (!external) {
        if (!dirty.has(key)) mapFor(collection)[id] = entry
        continue
      }
      const pending = pendingFor(key)
      const localEdits = dirty.has(key)
      const busy = localEdits || !!pending
      const base = pending ? pending.base : (bases.get(key) ?? (busy ? undefined : local?.record))
      const d = decideRemote({ mode, dirty: busy, base, mine: local?.record ?? null, theirs: entry.record })
      if (d.action === 'take') mapFor(collection)[id] = entry
      else if (d.action === 'ignore') {
        if (!pending) bases.set(key, entry.record)
      } else if (d.action === 'merge') {
        mapFor(collection)[id] = { ...entry, record: d.merged as RecordTypes[Collection] }
        bases.set(key, entry.record)
        toSave.push({ collection, id, from: entry.record.updatedBy ?? null })
      } else queue({ key, collection, id, type: 'update', base, theirs: entry }, localEdits)
    }
    for (const { collection, id } of change.removals) {
      const key = keyOf(collection, id)
      const local = (s[collection] as Record<string, RecordEntry<RecordTypes[Collection]>>)[id]
      if (!external) {
        if (!dirty.has(key)) delete mapFor(collection)[id]
        continue
      }
      if (!local) continue
      const localEdits = dirty.has(key)
      if (decideRemoteRemoval({ mode, dirty: localEdits || !!pendingFor(key) }) === 'remove') delete mapFor(collection)[id]
      else queue({ key, collection, id, type: 'removal', base: bases.get(key) ?? local.record, theirs: null }, localEdits)
    }
    Object.assign(next, maps)
    if (change.journal) {
      const key = keyOf('journal', 'journal')
      if (!external) {
        if (!dirty.has(key)) next.journal = change.journal
      } else if (s.journal) {
        const pending = pendingFor(key)
        const localEdits = dirty.has(key)
        const busy = localEdits || !!pending
        const base = pending ? pending.base : (bases.get(key) ?? (busy ? undefined : s.journal))
        const d = decideRemote({ mode, dirty: busy, base, mine: s.journal, theirs: change.journal })
        if (d.action === 'take') next.journal = change.journal
        else if (d.action === 'ignore') {
          if (!pending) bases.set(key, change.journal)
        } else if (d.action === 'merge') {
          next.journal = d.merged as JournalFile
          bases.set(key, change.journal)
          toSave.push({ collection: 'journal', id: 'journal', from: change.journal.updatedBy ?? null })
        } else queue({ key, collection: 'journal', id: 'journal', type: 'update', base, theirs: change.journal }, localEdits)
      } else next.journal = change.journal
    }
    return next
  })
  for (const t of toSave) scheduleSave(t.collection, t.id)
  if (toSave.length) {
    const from = toSave.find((t) => t.from)?.from
    toast(`Scalono zmiany${from ? ` z komputera ${from}` : ' z dysku'} z Twoimi niezapisanymi (${toSave.length}).`, 'success', 4500)
  }
  if (queued.length) {
    useRemote.setState((r) => ({
      pending: [...r.pending.filter((p) => !queued.some((q) => q.key === p.key)), ...queued],
      open: true
    }))
  }
}

/**
 * Decide about a change from another computer: merge (fields changed on both sides as `fieldChoices` say, default
 * mine), keep this computer's version (written over theirs; theirs stays in the history) or take theirs (local
 * unsaved edits go to the history).
 */
export function resolveRemote(key: string, choice: 'merge' | Side, fieldChoices: Record<string, Side> = {}): void {
  const item = pendingFor(key)
  if (!item) return
  useRemote.setState((r) => {
    const pending = r.pending.filter((p) => p.key !== key)
    return { pending, open: r.open && pending.length > 0 }
  })
  if (item.collection === 'journal') {
    const mine = get().journal
    const theirs = item.theirs as JournalFile
    if (!mine) return
    if (choice === 'theirs') {
      if (dirty.has(key)) void api.historyKeep('journal', mine, 'discarded').catch(() => undefined)
      forget(key)
      set({ journal: theirs })
      return
    }
    const journal = choice === 'mine' ? mine : merge3(item.base, mine, theirs, chooser(fieldChoices)).merged
    bases.set(key, theirs)
    set({ journal })
    scheduleSave('journal', 'journal', 0)
    return
  }
  const c = item.collection
  const local = (get()[c] as Record<string, RecordEntry<RecordTypes[Collection]>>)[item.id]
  const setEntry = (entry: RecordEntry<RecordTypes[Collection]> | null) =>
    set((s) => {
      const map = { ...(s[c] as Record<string, RecordEntry<RecordTypes[Collection]>>) }
      if (entry) map[item.id] = entry
      else delete map[item.id]
      return { [c]: map } as Partial<JournalState>
    })
  if (item.type === 'removal') {
    if (choice === 'theirs') {
      if (dirty.has(key) && local) void api.historyKeep(c, local.record, 'discarded').catch(() => undefined)
      forget(key)
      setEntry(null)
    } else if (local) scheduleSave(c, item.id, 0)
    return
  }
  const theirs = item.theirs as RecordEntry<RecordTypes[Collection]>
  if (choice === 'theirs' || !local) {
    if (dirty.has(key) && local) void api.historyKeep(c, local.record, 'discarded').catch(() => undefined)
    forget(key)
    setEntry(theirs)
    return
  }
  bases.set(key, theirs.record)
  const record = choice === 'mine' ? local.record : merge3(item.base, local.record, theirs.record, chooser(fieldChoices)).merged
  setEntry({ ...theirs, record })
  scheduleSave(c, item.id, 0)
}

async function runSave(key: string): Promise<void> {
  const target = dirty.get(key)
  if (!target) return
  // Waiting for a decision about a change from another computer: writing now would overwrite it.
  if (pendingFor(key)) return
  const version = versions.get(key) ?? 0
  if (target.collection === 'journal' ? !get().journal : !(get()[target.collection] as Record<string, unknown>)[target.id]) {
    forget(key)
    bumpPending(0, { error: saveError() })
    return
  }
  bumpPending(1)
  try {
    if (target.collection === 'journal') {
      const journal = get().journal as JournalFile
      const saved = await api.saveJournal(journal)
      if ((versions.get(key) ?? 0) === version) {
        dirty.delete(key)
        bases.delete(key)
        set({ journal: saved })
      } else bases.set(key, saved)
    } else {
      const c = target.collection
      const current = (get()[c] as Record<string, RecordEntry<RecordTypes[Collection]>>)[target.id] as RecordEntry<RecordTypes[Collection]>
      const entry = await api.saveRecord(c, current.record)
      set((s) => {
        const map = { ...(s[c] as Record<string, RecordEntry<RecordTypes[Collection]>>) }
        const latest = map[target.id]
        if ((versions.get(key) ?? 0) === version) {
          dirty.delete(key)
          bases.delete(key)
          // Deleted while the save was in flight: do not bring it back.
          if (latest) map[target.id] = entry
        } else if (latest) {
          // Disk now holds what was sent: the base of a later merge.
          bases.set(key, entry.record)
          // Newer local edits pending: keep them, but adopt the new path.
          map[target.id] = { ...latest, relPath: entry.relPath }
        }
        const drafts = { ...s.drafts }
        delete drafts[target.id]
        return { [c]: map, drafts } as Partial<JournalState>
      })
    }
    retryDelay.delete(key)
    failed.delete(key)
    bumpPending(-1, { lastSavedAt: new Date().toISOString(), error: saveError() })
  } catch (e) {
    // A record deleted meanwhile is no longer dirty: nothing to report or retry.
    if (dirty.has(key)) failed.set(key, errorMessage(e))
    bumpPending(-1, { error: saveError() })
    scheduleRetry(key)
  }
}

/** Run the save of `key` after any save of it that is already in progress. */
function enqueue(key: string): Promise<void> {
  const prev = inFlight.get(key) ?? Promise.resolve()
  const p = prev.then(() => runSave(key))
  inFlight.set(key, p)
  void p.finally(() => {
    if (inFlight.get(key) === p) inFlight.delete(key)
  })
  return p
}

/** A save failed: keep the change and try again later (never drop it silently). */
function scheduleRetry(key: string): void {
  if (timers.has(key) || !dirty.has(key)) return
  const delay = retryDelay.get(key) ?? RETRY_FIRST
  retryDelay.set(key, Math.min(RETRY_MAX, delay * 2))
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key)
      void enqueue(key)
    }, delay)
  )
}

function scheduleSave(collection: Collection | 'journal', id: string, delay = saveDelay()): void {
  const key = keyOf(collection, id)
  versions.set(key, (versions.get(key) ?? 0) + 1)
  dirty.set(key, { collection, id })
  const existing = timers.get(key)
  if (existing) clearTimeout(existing)
  const now = Date.now()
  if (!firstDirtyAt.has(key)) firstDirtyAt.set(key, now)
  const waited = now - (firstDirtyAt.get(key) ?? now)
  const wait = Math.min(delay, Math.max(0, saveMaxWait() - waited))
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key)
      firstDirtyAt.delete(key)
      void enqueue(key)
    }, wait)
  )
}

const folderReadOnly = () => !!get().status?.readOnly

/** Update a record in memory immediately and save it to disk shortly after (autosave). */
export function updateRecord<C extends Collection>(collection: C, id: string, updater: (r: RecordTypes[C]) => RecordTypes[C]): void {
  const current = (get()[collection] as EntryMap<C>)[id]
  // Read-only folder (newer format, unavailable drive) or file: no edits that could never be saved.
  if (!current || current.readOnly || folderReadOnly()) return
  const key = keyOf(collection, id)
  if (!dirty.has(key) && !bases.has(key) && !get().drafts[id]) bases.set(key, current.record)
  const record = updater(current.record)
  set((s) => {
    // The first edit turns a draft into a real record (saved shortly), so leaving the page never discards it.
    let drafts = s.drafts
    if (drafts[id]) {
      drafts = { ...drafts }
      delete drafts[id]
    }
    return { [collection]: { ...(s[collection] as EntryMap<C>), [id]: { ...current, record } }, drafts } as Partial<JournalState>
  })
  scheduleSave(collection, id)
}

/** Add a record. Drafts live only in memory until the first edit. */
export function addRecord<C extends Collection>(collection: C, record: RecordTypes[C], opts: { draft?: boolean } = {}): void {
  if (folderReadOnly()) return
  set(
    (s) =>
      ({
        [collection]: { ...(s[collection] as EntryMap<C>), [record.id]: { record, relPath: '', readOnly: false } },
        drafts: opts.draft ? { ...s.drafts, [record.id]: true } : s.drafts
      }) as Partial<JournalState>
  )
  if (!opts.draft) scheduleSave(collection, record.id, 0)
}

/** Drop an untouched draft (never written to disk). */
export function discardDraft(collection: Collection, id: string): void {
  if (!get().drafts[id]) return
  set((s) => {
    const map = { ...(s[collection] as Record<string, unknown>) }
    delete map[id]
    const drafts = { ...s.drafts }
    delete drafts[id]
    return { [collection]: map, drafts } as Partial<JournalState>
  })
}

export async function deleteRecord(collection: Collection, id: string): Promise<void> {
  const key = keyOf(collection, id)
  forget(key)
  useRemote.setState((r) => ({ pending: r.pending.filter((p) => p.key !== key) }))
  bumpPending(0, { error: saveError() })
  const wasDraft = !!get().drafts[id]
  set((s) => {
    const map = { ...(s[collection] as Record<string, unknown>) }
    delete map[id]
    const drafts = { ...s.drafts }
    delete drafts[id]
    return { [collection]: map, drafts } as Partial<JournalState>
  })
  await inFlight.get(key)
  if (!wasDraft) await api.deleteRecord(collection, id)
}

/** Settings written by the main process (restored from the history): replace the in-memory copy. */
export function adoptJournal(journal: JournalFile): void {
  const key = keyOf('journal', 'journal')
  forget(key)
  set({ journal })
  bumpPending(0, { error: saveError() })
}

export function updateJournal(updater: (j: JournalFile) => JournalFile): void {
  const j = get().journal
  if (!j || folderReadOnly()) return
  const key = keyOf('journal', 'journal')
  if (!dirty.has(key) && !bases.has(key)) bases.set(key, j)
  set({ journal: updater(j) })
  scheduleSave('journal', 'journal')
}

/**
 * Write every pending change now (window close, folder switch, Ctrl+S, "retry"), including changes
 * whose earlier save failed. Resolves to true when nothing is left unsaved.
 */
export async function flushSaves(): Promise<boolean> {
  for (const key of new Set([...timers.keys(), ...dirty.keys()])) {
    const t = timers.get(key)
    if (t) clearTimeout(t)
    timers.delete(key)
    firstDirtyAt.delete(key)
    void enqueue(key)
  }
  await Promise.all([...inFlight.values()])
  return !hasUnsaved()
}

export function hasUnsaved(): boolean {
  return dirty.size > 0
}

export async function boot(): Promise<void> {
  const info = await api.appInfo()
  set({ appInfo: info })
  api.onChange(applyChange)
  api.onFlushRequest(flushSaves)
  const res = await api.loadCurrent()
  if (res?.ok) applySnapshot(res.snapshot)
  else set({ phase: 'setup', setupMessage: res && !res.ok ? res.message : null, setupDir: res && !res.ok ? (res.dir ?? null) : null })
}

export async function openResult(res: Awaited<ReturnType<typeof api.pickDataDir>>): Promise<boolean> {
  if (res.ok) {
    applySnapshot(res.snapshot)
    return true
  }
  if (res.reason !== 'cancelled') set({ setupMessage: res.message, setupDir: res.dir ?? null })
  return false
}
