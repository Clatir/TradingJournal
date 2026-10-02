/** Contract between the main process (data folder owner) and the renderer. */
import type { Collection, FileKind } from './paths'
import type { RecordTypes } from './records'
import type { JournalFile } from './schema'

export interface RecordEntry<T> {
  record: T
  relPath: string
  /** File written by a newer app version: shown, never overwritten. */
  readOnly: boolean
}

export type ProblemKind = 'corrupt' | 'invalid' | 'too-new' | 'unknown-file'

export interface Problem {
  relPath: string
  kind: ProblemKind
  message: string
}

export interface ConflictSide {
  relPath: string
  record: unknown | null
  error: string | null
  updatedAt: string | null
  mtimeMs: number
}

export interface ConflictEntry {
  /** Stable id = relative path of the copy. */
  id: string
  kind: FileKind
  /** 'copy' = file created by a sync tool; 'duplicate' = two canonical files with the same record id. */
  type: 'copy' | 'duplicate'
  source: string
  canonical: ConflictSide
  copy: ConflictSide
}

export interface FolderStatus {
  dataDir: string
  available: boolean
  readOnly: boolean
  readOnlyReason: string | null
  folderSchemaVersion: number
  appSchemaVersion: number
  /** Other machines that used this folder within the last few minutes. */
  otherMachines: Array<{ machine: string; lastSeen: string }>
  migratedFrom: number | null
  backupPath: string | null
  /** Demo folder with sample data (kept apart from real data). */
  isSample: boolean
}

export interface Snapshot {
  journal: JournalFile
  trades: RecordEntry<RecordTypes['trades']>[]
  days: RecordEntry<RecordTypes['days']>[]
  weeks: RecordEntry<RecordTypes['weeks']>[]
  library: RecordEntry<RecordTypes['library']>[]
  problems: Problem[]
  conflicts: ConflictEntry[]
  status: FolderStatus
  loadMs: number
}

export interface ChangeSet {
  upserts: Array<{ collection: Collection; entry: RecordEntry<RecordTypes[Collection]> }>
  removals: Array<{ collection: Collection; id: string }>
  journal: JournalFile | null
  problems: Problem[]
  conflicts: ConflictEntry[]
  status: FolderStatus
}

export interface SaveScreenInput {
  /** Date used for the screens/YYYY/MM folder (trading date of the record). */
  date: string
  label: string
  image: Uint8Array
  thumb: Uint8Array
  width: number
  height: number
}

export interface SavedScreen {
  id: string
  path: string
  thumbPath: string
  width: number
  height: number
  bytes: number
  createdAt: string
}

export interface OrphanScreen {
  path: string
  thumbPath: string | null
  bytes: number
  mtimeMs: number
}

export interface ScreensStats {
  totalBytes: number
  fileCount: number
  orphans: OrphanScreen[]
}

export interface MachineConfig {
  dataDir: string | null
  /** Last real (non-sample) data folder – used when leaving demo mode. */
  lastRealDir: string | null
  recentDirs: string[]
  sampleMode: boolean
  backupDirOverride: string | null
  window: { x?: number; y?: number; width: number; height: number; maximized: boolean } | null
}

export interface AppInfo {
  version: string
  machineName: string
  platform: string
  userDataDir: string
  sampleDir: string
  isPortable: boolean
}

export type OpenFolderResult =
  | { ok: true; snapshot: Snapshot }
  | { ok: false; reason: 'cancelled' | 'not-journal' | 'error'; message: string; dir?: string }

export interface JournalApi {
  appInfo(): Promise<AppInfo>
  getConfig(): Promise<MachineConfig>
  /** Open the configured folder (or null when none is configured yet). */
  loadCurrent(): Promise<OpenFolderResult | null>
  /** Show a folder picker. mode=create initializes an empty folder as a new journal. */
  pickDataDir(mode: 'open' | 'create'): Promise<OpenFolderResult>
  openDataDir(dir: string, createIfEmpty: boolean): Promise<OpenFolderResult>
  saveRecord<C extends Collection>(collection: C, record: RecordTypes[C]): Promise<RecordEntry<RecordTypes[C]>>
  deleteRecord(collection: Collection, id: string): Promise<void>
  saveJournal(journal: JournalFile): Promise<JournalFile>
  saveScreen(input: SaveScreenInput): Promise<SavedScreen>
  screensStats(): Promise<ScreensStats>
  deleteScreens(paths: string[]): Promise<number>
  resolveConflict(conflictId: string, keep: 'canonical' | 'copy'): Promise<void>
  trashProblemFile(relPath: string): Promise<void>
  showInFolder(relPath: string | null): Promise<void>
  openExternal(url: string): Promise<void>
  rescan(): Promise<void>
  /** Open (creating if needed) the separate demo folder in userData. */
  openSample(): Promise<OpenFolderResult>
  /** Delete the demo folder (only the demo folder). */
  resetSample(): Promise<void>
  /** Leave demo mode: reopen the last real data folder (null = none known). */
  exitSample(): Promise<OpenFolderResult | null>
  onChange(cb: (change: ChangeSet) => void): () => void
  /** Main asks the renderer to flush pending saves before the window closes. */
  onFlushRequest(cb: () => Promise<void>): () => void
}

export const FILE_URL_SCHEME = 'journal-file'

/** URL under which the renderer can load a file from the data folder. */
export function fileUrl(relPath: string): string {
  return `${FILE_URL_SCHEME}://data/${relPath.split('/').map(encodeURIComponent).join('/')}`
}
