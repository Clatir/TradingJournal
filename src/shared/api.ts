/** Contract between the main process (data folder owner) and the renderer. */
import type { Collection, FileKind } from './paths'
import type { RecordTypes } from './records'
import type { FxFetchResult } from './fx'
import type { FxHistoryResult } from './fxHistory'
import type { XlsxSheet } from './export/xlsx'
import type { JournalFile } from './schema'
import type { PendingUpdate, UpdatePrefs, UpdateState } from './update'

/** A broker's history file: worksheets of an XLSX, or the bytes of a text / HTML file. */
export interface BrokerFile {
  name: string
  sheets: Array<{ name: string; rows: string[][] }> | null
  bytes: Uint8Array | null
}

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
  forecasts: RecordEntry<RecordTypes['forecasts']>[]
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

export type ImportPolicy = 'newer' | 'skip' | 'overwrite'

export interface ImportReport {
  token: string
  source: string
  kind: 'zip' | 'folder'
  hasJournal: boolean
  valid: Record<Collection, number>
  invalid: Array<{ relPath: string; error: string }>
  collisions: Array<{
    kind: Collection
    id: string
    relPath: string
    incomingUpdatedAt: string
    currentUpdatedAt: string
    newer: 'incoming' | 'current' | 'same'
  }>
  screens: number
  tooNew: boolean
}

export interface BackupInfo {
  name: string
  path: string
  kind: 'daily' | 'weekly' | 'manual' | 'pre-migration'
  bytes: number
  mtimeMs: number
}

export interface MachineConfig {
  dataDir: string | null
  /** Last real (non-sample) data folder – used when leaving demo mode. */
  lastRealDir: string | null
  recentDirs: string[]
  sampleMode: boolean
  backupDirOverride: string | null
  window: { x?: number; y?: number; width: number; height: number; maximized: boolean } | null
  updates: {
    prefs: UpdatePrefs
    pending: PendingUpdate | null
    /** Version that ran last on this machine (to say "updated to …" once). */
    lastRunVersion: string | null
  }
}

export interface AppInfo {
  version: string
  machineName: string
  platform: string
  userDataDir: string
  sampleDir: string
  isPortable: boolean
  /** Delay of the automatic NBP fetch after start (ICTJ_NBP_FETCH_DELAY_MS in test runs). */
  fxFetchDelayMs: number
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
  /** Save dialog + write a text file (CSV, markdown). Returns the path or null when cancelled. */
  saveTextFile(defaultName: string, content: string, filter: { name: string; extensions: string[] }): Promise<string | null>
  /** Save dialog + write an XLSX workbook built from `sheets` (main process, yazl). Returns the path or null when cancelled. */
  saveXlsx(defaultName: string, sheets: XlsxSheet[]): Promise<string | null>
  /** Save dialog + an A4 PDF printed from a self-contained HTML document (hidden window, no JavaScript). */
  savePdf(defaultName: string, html: string): Promise<string | null>
  /** Open dialog for a broker's history (CSV, HTML report, XLSX); null when cancelled. */
  pickBrokerFile(): Promise<BrokerFile | null>
  /** ZIP of the whole data folder (without backups). */
  exportZip(): Promise<string | null>
  copyText(text: string): Promise<void>
  copyImage(png: Uint8Array): Promise<void>
  /** Pick a folder or a ZIP and validate it without touching current data. */
  inspectImport(kind: 'zip' | 'folder'): Promise<ImportReport | null>
  applyImport(token: string, policy: ImportPolicy): Promise<{ imported: number; skipped: number; screensCopied: number }>
  /** Use the imported folder/ZIP as the data folder (ZIP is extracted to a chosen folder). */
  openImportAsNew(token: string): Promise<OpenFolderResult>
  listBackups(): Promise<{ dir: string; files: BackupInfo[] }>
  backupNow(): Promise<string>
  /** Change the backups folder on this machine: 'pick' shows a dialog, 'default' = backups/ in the data folder. */
  setBackupDir(mode: 'pick' | 'default'): Promise<string | null>
  /** Pick a CSV file (TradingView export) and return its text. */
  pickTextFile(filter: { name: string; extensions: string[] }): Promise<{ name: string; text: string } | null>
  showPath(absPath: string): Promise<void>
  /** Updates from GitHub Releases. */
  updateState(): Promise<UpdateState>
  checkForUpdates(): Promise<UpdateState>
  downloadUpdate(): Promise<UpdateState>
  /** Quit, install the downloaded update and start the new version (call after flushing saves). */
  installUpdateNow(): Promise<void>
  setUpdatePrefs(prefs: Partial<UpdatePrefs>): Promise<UpdateState>
  dismissUpdateNotice(): Promise<UpdateState>
  onUpdateState(cb: (state: UpdateState) => void): () => void
  /** Fetch the latest NBP table A (main process, net.fetch, 10 s limit). Nothing is saved. */
  fetchFxRates(): Promise<FxFetchResult>
  /** Archive NBP mid rates of one currency for start…end (at most 367 days). Nothing is saved. */
  fetchFxHistory(code: string, start: string, end: string): Promise<FxHistoryResult>
  onChange(cb: (change: ChangeSet) => void): () => void
  /** Main asks the renderer to flush pending saves before the window closes (false = something stayed unsaved). */
  onFlushRequest(cb: () => Promise<boolean>): () => void
}

export const FILE_URL_SCHEME = 'journal-file'

/** URL under which the renderer can load a file from the data folder. */
export function fileUrl(relPath: string): string {
  return `${FILE_URL_SCHEME}://data/${relPath.split('/').map(encodeURIComponent).join('/')}`
}
