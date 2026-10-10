/** Contract between the main process (data folder owner) and the renderer. */
import type { Collection, FileKind } from './paths'
import type { RecordTypes } from './records'
import type { FxFetchResult } from './fx'
import type { FxHistoryResult } from './fxHistory'
import type { MarketBarsResult, MarketCacheStats, MarketStatus, MarketTestResult } from './market'
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
  drills: RecordEntry<RecordTypes['drills']>[]
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
  /**
   * 'external': files changed outside this app instance (another computer through cloud sync, a manual edit, a
   * rescan); 'local': the result of this app's own action (save, delete, import, conflict resolution).
   */
  origin?: 'external' | 'local'
}

/** Why a version was kept in the history. */
export type HistoryReason = 'edit' | 'delete' | 'restore' | 'import' | 'merge' | 'discarded'

/** One kept version of a record (`.history/`). */
export interface HistoryEntry {
  file: string
  /** When the version was put into the history (= when it was replaced or deleted). */
  savedAt: string
  /** Computer that replaced it. */
  savedBy: string | null
  reason: HistoryReason
  /** updatedAt / updatedBy of the kept version itself. */
  updatedAt: string | null
  updatedBy: string | null
}

export type HistoryKind = Collection | 'journal'

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
  /** Market data (EODHD, 1.8.0): the key of this computer, encrypted with the system's protection when available. */
  market: {
    enabled: boolean
    key: string | null
    keyEncrypted: boolean
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
  /** Delay of the automatic market data fill after start (ICTJ_MARKET_DELAY_MS in test runs). */
  marketDelayMs: number
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
  /** Kept versions of a record, newest first (`id` = 'journal' for the settings). */
  historyList(kind: HistoryKind, id: string): Promise<HistoryEntry[]>
  /** The record of one kept version (null when gone). */
  historyRead(kind: HistoryKind, id: string, file: string): Promise<unknown>
  /** Deleted records of a collection that can be brought back. */
  historyDeleted(collection: Collection): Promise<Array<HistoryEntry & { id: string; record: unknown }>>
  /** Make a kept version the current one (the current version goes to the history first); restored settings are returned. */
  historyRestore(kind: HistoryKind, id: string, file: string): Promise<JournalFile | null>
  /** Keep a version that is about to be dropped without being written (e.g. local edits discarded in a merge). */
  historyKeep(kind: HistoryKind, record: unknown, reason: HistoryReason): Promise<void>
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
  /**
   * Offline OCR (Tesseract in a worker thread of the main process) of a PNG: words as Tesseract TSV. `psm` 11 = sparse
   * text (default), 7 = one line, 6 = a block; `whitelist` = the only characters allowed.
   */
  ocrImage(png: Uint8Array, options?: { psm?: 6 | 7 | 8 | 11; whitelist?: string }): Promise<string>
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
  /** Market data (EODHD): status without the key, set / remove the key, switch, connection test. */
  marketStatus(): Promise<MarketStatus>
  marketSetKey(key: string | null): Promise<MarketStatus>
  marketSetEnabled(enabled: boolean): Promise<MarketStatus>
  marketTest(): Promise<MarketTestResult>
  /** M1 bars of [fromMs, toMs) from the cache, missing days fetched (unless `offline`). */
  marketBars(ticker: string, fromMs: number, toMs: number, opts?: { offline?: boolean }): Promise<MarketBarsResult>
  marketCacheStats(): Promise<MarketCacheStats>
  marketClearCache(): Promise<void>
  onChange(cb: (change: ChangeSet) => void): () => void
  /** Main asks the renderer to flush pending saves before the window closes (false = something stayed unsaved). */
  onFlushRequest(cb: () => Promise<boolean>): () => void
}

export const FILE_URL_SCHEME = 'journal-file'

/** URL under which the renderer can load a file from the data folder. */
export function fileUrl(relPath: string): string {
  return `${FILE_URL_SCHEME}://data/${relPath.split('/').map(encodeURIComponent).join('/')}`
}
