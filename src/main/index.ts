import { existsSync, promises as fs } from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { BrowserWindow, ClipboardItem, Menu, app, clipboard, dialog, ipcMain, net, protocol, shell, type IpcMainInvokeEvent } from 'electron'
import { FILE_URL_SCHEME, type AppInfo, type ChangeSet, type HistoryKind, type HistoryReason, type ImportPolicy, type OpenFolderResult } from '@shared/api'
import { isIgnoredPath } from '@shared/paths'
import type { Collection } from '@shared/paths'
import { sanitizeRelPath } from '@shared/paths'
import { ConfigStore } from './config'
import { DataStore } from './datastore/store'
import { FolderWatcher } from './datastore/watch'
import { clearPresence, readOtherMachines, writePresence } from './datastore/presence'
import { initLog, log } from './log'
import { listBackups, manualBackup, runBackups } from './datastore/backup'
import { applyImport, extractZip, inspectFolder, type Inspected } from './datastore/transfer'
import { zipFolder } from './datastore/zip'
import { writeFileAtomic } from './datastore/atomic'
import { GITHUB_API, detectInstallMode, type UpdatePrefs } from '@shared/update'
import { Updater } from './update/updater'
import { startPortableSwap, startSilentInstaller } from './update/apply'
import { fetchNbpHistory, fetchNbpTable, nbpSource } from './fx/nbp'
import { writeXlsx } from './export/xlsx'
import { htmlToPdf } from './export/pdf'
import { readBrokerFile } from './import/broker'
import { ocrImage, stopOcr } from './ocr/ocr'
import type { XlsxSheet } from '@shared/export/xlsx'

// Test hooks: isolated user data and a preselected data folder (no dialogs in E2E runs).
if (process.env.ICTJ_USER_DATA) app.setPath('userData', process.env.ICTJ_USER_DATA)

// One instance per machine (the lock is tied to userData): a second window would autosave over the
// first one in the same data folder. Starting the app again just brings the open window to front.
const isPrimaryInstance = app.requestSingleInstanceLock()
if (!isPrimaryInstance) app.quit()

const machineName = process.env.ICTJ_MACHINE_NAME || hostname() || 'KOMPUTER'
const config = new ConfigStore(app.getPath('userData'))
const sampleDir = () => join(app.getPath('userData'), 'sample-journal')

let mainWindow: BrowserWindow | null = null
let store: DataStore | null = null
let watcher: FolderWatcher | null = null
let presenceTimer: NodeJS.Timeout | null = null
let updater: Updater | null = null
const imports = new Map<string, Inspected>()
/** First automatic update check after start (test runs shorten it). */
const updateCheckDelayMs = (): number => Number(process.env.ICTJ_UPDATE_CHECK_DELAY_MS) || 15_000
/** First automatic NBP fetch after start (done by the renderer, which knows the journal settings). */
const fxFetchDelayMs = (): number => Number(process.env.ICTJ_NBP_FETCH_DELAY_MS) || 20_000

function requireUpdater(): Updater {
  if (!updater) throw new Error('Moduł aktualizacji nie jest gotowy.')
  return updater
}

function createUpdater(): Updater {
  const portableFile = process.env.PORTABLE_EXECUTABLE_FILE || null
  const uninstaller = join(dirname(process.execPath), `Uninstall ${app.getName()}.exe`)
  const { mode, note } = detectInstallMode({
    platform: process.platform,
    isPackaged: app.isPackaged,
    portableFile: portableFile ?? undefined,
    uninstallerExists: existsSync(uninstaller)
  })
  // Test hook: a local release server instead of api.github.com (also allows plain http).
  const override = process.env.ICTJ_UPDATE_URL?.replace(/\/+$/, '') || null
  const savePrefs = (prefs: UpdatePrefs) => config.updateUpdates({ prefs }).then(() => undefined)
  return new Updater({
    currentVersion: app.getVersion(),
    mode,
    modeNote: note,
    portableFile,
    userDataDir: app.getPath('userData'),
    fetch: (url, init) => net.fetch(url, init),
    apiBase: override ?? GITHUB_API,
    allowInsecure: !!override,
    prefs: () => config.get().updates.prefs,
    savePrefs,
    pending: () => config.get().updates.pending,
    savePending: (pending) => config.updateUpdates({ pending }).then(() => undefined),
    lastRunVersion: () => config.get().updates.lastRunVersion,
    saveLastRunVersion: (lastRunVersion) => config.updateUpdates({ lastRunVersion }).then(() => undefined),
    applyPortable: startPortableSwap,
    applyInstaller: startSilentInstaller,
    // The portable launcher (parent process) keeps its exe open until the app exits.
    waitPids: [process.pid, process.ppid],
    log,
    onState: (state) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('journal:update', state)
    }
  })
}

protocol.registerSchemesAsPrivileged([
  { scheme: FILE_URL_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

function send(change: ChangeSet | null): void {
  if (change && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('journal:change', change)
}

async function trash(absPath: string): Promise<void> {
  try {
    await shell.trashItem(absPath)
  } catch {
    // Removable or network drives may have no recycle bin.
    await fs.rm(absPath, { force: true })
  }
}

async function closeStore(): Promise<void> {
  watcher?.stop()
  watcher = null
  if (presenceTimer) clearInterval(presenceTimer)
  presenceTimer = null
  if (store) await clearPresence(store.root, machineName).catch(() => undefined)
  store = null
}

async function heartbeat(): Promise<void> {
  const s = store
  if (!s) return
  try {
    if (!s.status().readOnly) await writePresence(s.root, machineName, app.getVersion()).catch(() => undefined)
    const others = await readOtherMachines(s.root, machineName)
    if (JSON.stringify(others) !== JSON.stringify(s.otherMachines)) {
      s.otherMachines = others
      send(await s.refresh([]))
    }
  } catch (e) {
    log('warn', 'heartbeat failed', e)
  }
}

async function openFolder(dir: string, createIfEmpty: boolean): Promise<OpenFolderResult> {
  try {
    let target = dir
    let kind = await DataStore.inspect(target)
    if (kind === 'other' && createIfEmpty) {
      target = join(dir, 'ICT Trade Journal')
      kind = await DataStore.inspect(target)
    }
    if (kind === 'missing' || kind === 'empty') {
      if (!createIfEmpty) {
        return {
          ok: false,
          reason: 'not-journal',
          dir,
          message:
            kind === 'empty'
              ? 'Folder jest pusty - można w nim utworzyć nowy dziennik.'
              : 'Zapamiętany folder danych jest niedostępny (np. odłączony pendrive lub dysk sieciowy). Podłącz go i spróbuj ponownie albo wskaż inny folder.'
        }
      }
      await DataStore.initialize(target)
    } else if (kind === 'other') {
      return {
        ok: false,
        reason: 'not-journal',
        dir,
        message: 'W tym folderze nie ma dziennika (journal.json). Można utworzyć w nim podfolder „ICT Trade Journal”.'
      }
    }
    const isSample = target === sampleDir()
    const next = new DataStore(target, { machineName, trash, backupDir: isSample ? null : config.get().backupDirOverride, isSample })
    // Open the new folder first: if it fails, the current one stays open and keeps saving.
    const snapshot = await next.open()
    await closeStore()
    store = next
    next.otherMachines = await readOtherMachines(target, machineName)
    snapshot.status = next.status()
    watcher = new FolderWatcher(
      target,
      (paths) => {
        const s = store
        if (s !== next) return
        s.refresh(paths ?? undefined).then(send, (e) => log('error', 'refresh failed', e))
      },
      { onError: (e) => log('warn', 'watcher error', e) }
    )
    watcher.start()
    void heartbeat()
    presenceTimer = setInterval(() => void heartbeat(), 60_000)
    if (!isSample && !next.status().readOnly) {
      // Daily JSON backup + weekly full backup, in the background.
      runBackups(target, next.backupsDir).then(
        (r) => (r.daily || r.weekly) && log('info', `backup ${r.daily ?? ''} ${r.weekly ?? ''}`.trim()),
        (e) => log('warn', 'backup failed', e)
      )
    }
    await config.rememberDir(target, isSample)
    log('info', `opened ${target}: ${snapshot.trades.length} trades, ${snapshot.problems.length} problems, ${snapshot.conflicts.length} conflicts, ${snapshot.loadMs} ms`)
    return { ok: true, snapshot }
  } catch (e) {
    log('error', `open failed ${dir}`, e)
    return { ok: false, reason: 'error', dir, message: (e as Error).message }
  }
}

function requireStore(): DataStore {
  if (!store) throw new Error('Nie wybrano folderu danych.')
  return store
}

function handle<A extends unknown[], R>(channel: string, fn: (...args: A) => Promise<R> | R): void {
  ipcMain.handle(channel, async (_e: IpcMainInvokeEvent, ...args: unknown[]) => {
    try {
      return await fn(...(args as A))
    } catch (e) {
      log('error', channel, e)
      throw e
    }
  })
}

function registerIpc(): void {
  handle('journal:appInfo', (): AppInfo => ({
    version: app.getVersion(),
    machineName,
    platform: process.platform,
    userDataDir: app.getPath('userData'),
    sampleDir: sampleDir(),
    isPortable: !!process.env.PORTABLE_EXECUTABLE_DIR,
    fxFetchDelayMs: fxFetchDelayMs()
  }))
  handle('journal:getConfig', () => config.get())
  handle('journal:loadCurrent', async () => {
    const preset = process.env.ICTJ_DATA_DIR
    if (preset) return openFolder(preset, true)
    const dir = config.get().dataDir
    return dir ? openFolder(dir, false) : null
  })
  handle('journal:pickDataDir', async (mode: 'open' | 'create'): Promise<OpenFolderResult> => {
    const res = await dialog.showOpenDialog(mainWindow!, {
      title: mode === 'create' ? 'Wybierz folder na nowy dziennik' : 'Wskaż folder dziennika',
      properties: ['openDirectory', 'createDirectory', 'promptToCreate']
    })
    const dir = res.filePaths[0]
    if (res.canceled || !dir) return { ok: false, reason: 'cancelled', message: '' }
    return openFolder(dir, mode === 'create')
  })
  handle('journal:openDataDir', (dir: string, createIfEmpty: boolean) => openFolder(dir, createIfEmpty))
  handle('journal:saveRecord', async (collection: Collection, record: never) => {
    const { entry, change } = await requireStore().saveRecord(collection, record)
    send(change)
    return entry
  })
  handle('journal:deleteRecord', async (collection: Collection, id: string) => {
    send(await requireStore().deleteRecord(collection, id))
  })
  handle('journal:historyList', (kind: HistoryKind, id: string) => requireStore().historyList(kind, id))
  handle('journal:historyRead', (kind: HistoryKind, id: string, file: string) => requireStore().historyRead(kind, id, file))
  handle('journal:historyDeleted', (collection: Collection) => requireStore().historyDeleted(collection))
  handle('journal:historyKeep', (kind: HistoryKind, record: unknown, reason: HistoryReason) => requireStore().historyKeep(kind, record, reason))
  handle('journal:historyRestore', async (kind: HistoryKind, id: string, file: string) => {
    const { change, journal } = await requireStore().historyRestore(kind, id, file)
    send(change)
    // Restored settings go back to the caller (they are not part of a change set's upserts).
    return journal
  })
  handle('journal:saveJournal', (journal: never) => requireStore().saveJournal(journal))
  handle('journal:saveScreen', (input: never) => requireStore().saveScreen(input))
  handle('journal:screensStats', () => requireStore().screensStats())
  handle('journal:deleteScreens', (paths: string[]) => requireStore().deleteScreens(paths))
  handle('journal:resolveConflict', async (id: string, keep: 'canonical' | 'copy') => {
    send(await requireStore().resolveConflict(id, keep))
  })
  handle('journal:trashProblemFile', async (rel: string) => {
    send(await requireStore().trashFile(rel))
  })
  handle('journal:showInFolder', async (rel: string | null) => {
    const s = requireStore()
    if (!rel) {
      await shell.openPath(s.root)
      return
    }
    shell.showItemInFolder(s.abs(rel))
  })
  handle('journal:fetchFxRates', async () => {
    const result = await fetchNbpTable((url, init) => net.fetch(url, init), nbpSource(process.env.ICTJ_NBP_URL))
    log(result.ok ? 'info' : 'warn', result.ok ? `NBP table ${result.table.no} (${result.table.effectiveDate})` : `NBP fetch failed: ${result.message}`)
    return result
  })
  handle('journal:fetchFxHistory', async (code: string, start: string, end: string) => {
    const result = await fetchNbpHistory((url, init) => net.fetch(url, init), nbpSource(process.env.ICTJ_NBP_URL), code, start, end)
    log(result.ok ? 'info' : 'warn', result.ok ? `NBP history ${code} ${start}…${end}: ${Object.keys(result.rates).length} tables` : `NBP history ${code} failed: ${result.message}`)
    return result
  })
  handle('journal:openExternal', async (url: string) => {
    if (!/^https:\/\//i.test(url)) throw new Error('Można otwierać tylko adresy https://')
    await shell.openExternal(url)
  })
  handle('journal:rescan', async () => {
    if (store) send(await store.refresh())
  })
  handle('journal:saveTextFile', async (name: string, content: string, filter: { name: string; extensions: string[] }) => {
    const res = await dialog.showSaveDialog(mainWindow!, { defaultPath: name, filters: [filter] })
    if (res.canceled || !res.filePath) return null
    await writeFileAtomic(res.filePath, content)
    return res.filePath
  })
  handle('journal:saveXlsx', async (name: string, sheets: XlsxSheet[]) => {
    const res = await dialog.showSaveDialog(mainWindow!, { defaultPath: name, filters: [{ name: 'Excel', extensions: ['xlsx'] }] })
    if (res.canceled || !res.filePath) return null
    await writeXlsx(res.filePath, sheets)
    return res.filePath
  })
  handle('journal:savePdf', async (name: string, html: string) => {
    const res = await dialog.showSaveDialog(mainWindow!, { defaultPath: name, filters: [{ name: 'PDF', extensions: ['pdf'] }] })
    if (res.canceled || !res.filePath) return null
    await writeFileAtomic(res.filePath, await htmlToPdf(html))
    return res.filePath
  })
  handle('journal:exportZip', async () => {
    const s = requireStore()
    const res = await dialog.showSaveDialog(mainWindow!, {
      defaultPath: `ICT-Journal-${new Date().toISOString().slice(0, 10)}.zip`,
      filters: [{ name: 'ZIP', extensions: ['zip'] }]
    })
    if (res.canceled || !res.filePath) return null
    await zipFolder(s.root, res.filePath, (rel) => !isIgnoredPath(rel))
    return res.filePath
  })
  handle('journal:copyText', async (text: string) => {
    await clipboard.writeText(text)
  })
  handle('journal:copyImage', async (png: Uint8Array) => {
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([Buffer.from(png)], { type: 'image/png' }) })])
  })
  handle('journal:inspectImport', async (kind: 'zip' | 'folder') => {
    const s = requireStore()
    const res = await dialog.showOpenDialog(mainWindow!, {
      title: kind === 'zip' ? 'Wybierz plik ZIP z dziennikiem' : 'Wybierz folder z dziennikiem',
      properties: kind === 'zip' ? ['openFile'] : ['openDirectory'],
      filters: kind === 'zip' ? [{ name: 'ZIP', extensions: ['zip'] }] : undefined
    })
    const source = res.filePaths[0]
    if (res.canceled || !source) return null
    let dir = source
    if (kind === 'zip') {
      dir = join(tmpdir(), `ictj-import-${randomBytes(4).toString('hex')}`)
      await extractZip(source, dir)
    }
    const inspected = await inspectFolder(s, dir, source, kind)
    const token = randomBytes(8).toString('hex')
    inspected.report.token = token
    imports.set(token, inspected)
    return inspected.report
  })
  handle('journal:applyImport', async (token: string, policy: ImportPolicy) => {
    const s = requireStore()
    const inspected = imports.get(token)
    if (!inspected) throw new Error('Import wygasł – wybierz plik ponownie.')
    const result = await applyImport(s, inspected, policy)
    send(await s.refresh(undefined, 'local'))
    return result
  })
  handle('journal:openImportAsNew', async (token: string) => {
    const inspected = imports.get(token)
    if (!inspected) throw new Error('Import wygasł – wybierz plik ponownie.')
    if (inspected.report.kind === 'folder') return openFolder(inspected.dir, false)
    const res = await dialog.showOpenDialog(mainWindow!, { title: 'Folder na rozpakowany dziennik (pusty)', properties: ['openDirectory', 'createDirectory', 'promptToCreate'] })
    const dest = res.filePaths[0]
    if (res.canceled || !dest) return { ok: false, reason: 'cancelled', message: '' } as OpenFolderResult
    const kind = await DataStore.inspect(dest)
    const target = kind === 'empty' || kind === 'missing' ? dest : join(dest, basename(inspected.report.source).replace(/\.zip$/i, ''))
    await fs.cp(inspected.dir, target, { recursive: true, errorOnExist: true, force: false })
    return openFolder(target, false)
  })
  handle('journal:listBackups', async () => {
    const s = requireStore()
    return { dir: s.backupsDir, files: await listBackups(s.backupsDir) }
  })
  handle('journal:backupNow', async () => {
    const s = requireStore()
    return manualBackup(s.root, s.backupsDir)
  })
  handle('journal:setBackupDir', async (mode: 'pick' | 'default') => {
    const s = requireStore()
    let dir: string | null = null
    if (mode === 'pick') {
      const res = await dialog.showOpenDialog(mainWindow!, { title: 'Folder na kopie zapasowe (na tym komputerze)', properties: ['openDirectory', 'createDirectory', 'promptToCreate'] })
      if (res.canceled || !res.filePaths[0]) return s.backupsDir
      dir = res.filePaths[0]
    }
    await config.update({ backupDirOverride: dir })
    s.setBackupDir(dir)
    return s.backupsDir
  })
  handle('journal:pickTextFile', async (filter: { name: string; extensions: string[] }) => {
    const res = await dialog.showOpenDialog(mainWindow!, { properties: ['openFile'], filters: [filter] })
    const file = res.filePaths[0]
    if (res.canceled || !file) return null
    const st = await fs.stat(file)
    if (st.size > 50 * 1024 * 1024) throw new Error('Plik jest za duży (limit 50 MB).')
    return { name: basename(file), text: await fs.readFile(file, 'utf8') }
  })
  handle('journal:pickBrokerFile', async () => {
    const res = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile'],
      filters: [{ name: 'Historia od brokera (CSV, HTML, XLSX)', extensions: ['csv', 'txt', 'tsv', 'htm', 'html', 'xlsx'] }]
    })
    const file = res.filePaths[0]
    if (res.canceled || !file) return null
    return readBrokerFile(file)
  })
  handle('journal:ocrImage', async (png: Uint8Array) => {
    if (!(png instanceof Uint8Array) || png.byteLength === 0) throw new Error('Brak obrazu.')
    if (png.byteLength > 40 * 1024 * 1024) throw new Error('Obraz jest za duży (limit 40 MB).')
    return ocrImage(png)
  })
  handle('journal:showPath', async (abs: string) => {
    shell.showItemInFolder(abs)
  })
  handle('journal:updateState', () => requireUpdater().getState())
  handle('journal:checkForUpdates', () => requireUpdater().check(true))
  handle('journal:downloadUpdate', () => requireUpdater().download())
  handle('journal:installUpdateNow', async () => {
    const u = requireUpdater()
    if (!u.isReady) throw new Error('Aktualizacja nie jest jeszcze pobrana.')
    u.requestRestart()
    // The usual close path: flush in the renderer, close the folder, then will-quit applies the update.
    mainWindow?.close()
  })
  handle('journal:setUpdatePrefs', (prefs: Partial<UpdatePrefs>) => requireUpdater().setPrefs(prefs, updateCheckDelayMs()))
  handle('journal:dismissUpdateNotice', () => requireUpdater().dismissNotice())
  handle('journal:openSample', () => openFolder(sampleDir(), true))
  handle('journal:resetSample', async () => {
    const dir = sampleDir()
    if (store?.root === dir) await closeStore()
    await fs.rm(dir, { recursive: true, force: true })
  })
  handle('journal:exitSample', async () => {
    const real = config.get().lastRealDir
    return real ? openFolder(real, false) : null
  })
}

function registerFileProtocol(): void {
  protocol.handle(FILE_URL_SCHEME, async (request) => {
    const s = store
    if (!s) return new Response('Brak folderu danych', { status: 404 })
    const url = new URL(request.url)
    const rel = sanitizeRelPath(decodeURIComponent(url.pathname.replace(/^\/+/, '')))
    if (!rel) return new Response('Niedozwolona ścieżka', { status: 400 })
    try {
      return await net.fetch(pathToFileURL(s.abs(rel)).toString())
    } catch {
      return new Response('Nie znaleziono', { status: 404 })
    }
  })
}

function createWindow(): void {
  const saved = config.get().window
  const win = new BrowserWindow({
    width: saved?.width ?? 1440,
    height: saved?.height ?? 900,
    x: saved?.x,
    y: saved?.y,
    minWidth: 1100,
    minHeight: 680,
    show: false,
    backgroundColor: '#0b0d10',
    title: 'ICT Trade Journal',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })
  mainWindow = win
  if (saved?.maximized) win.maximize()
  win.once('ready-to-show', () => win.show())

  const devUrl = process.env.ELECTRON_RENDERER_URL
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e, url) => {
    if (!devUrl || !url.startsWith(devUrl)) e.preventDefault()
  })

  let allowClose = false
  let closing = false
  win.on('close', (e) => {
    if (allowClose) return
    e.preventDefault()
    if (closing) return
    closing = true
    const b = win.getNormalBounds()
    void config.update({ window: { ...b, maximized: win.isMaximized() } })
    const finish = (saved: boolean) => {
      clearTimeout(timeout)
      ipcMain.removeListener('journal:flushed', onFlushed)
      if (allowClose || win.isDestroyed()) return
      if (!saved) {
        // The renderer keeps unsaved changes and retries; closing now would lose them.
        const choice = dialog.showMessageBoxSync(win, {
          type: 'warning',
          title: 'Niezapisane zmiany',
          message: 'Nie udało się zapisać ostatnich zmian.',
          detail:
            'Folder danych może być niedostępny albo plik jest zablokowany (OneDrive, antywirus). Wybierz „Anuluj”, żeby aplikacja spróbowała ponownie, albo zamknij i utrać te zmiany.',
          buttons: ['Anuluj', 'Zamknij mimo to'],
          defaultId: 0,
          cancelId: 0
        })
        if (choice === 0) {
          closing = false
          updater?.cancelRestart()
          return
        }
      }
      allowClose = true
      win.close()
    }
    const onFlushed = (_e: Electron.IpcMainEvent, saved?: boolean) => finish(saved !== false)
    // An unresponsive renderer must not keep the window open forever.
    const timeout = setTimeout(() => finish(true), 4000)
    ipcMain.on('journal:flushed', onFlushed)
    win.webContents.send('journal:flush')
  })
  win.on('focus', () => {
    store?.refresh().then(send, () => undefined)
  })
  // Shutdown / log-off (Windows): no installer or swap helper now, the update waits for the next close.
  win.on('query-session-end', () => updater?.postponeInstall())
  win.on('session-end', () => updater?.postponeInstall())
  win.on('closed', () => {
    mainWindow = null
  })

  if (devUrl) void win.loadURL(devUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
})

app.whenReady().then(async () => {
  if (!isPrimaryInstance) return
  Menu.setApplicationMenu(null)
  initLog(app.getPath('userData'))
  log('info', `start v${app.getVersion()} on ${machineName}`)
  await config.load()
  updater = createUpdater()
  registerFileProtocol()
  registerIpc()
  createWindow()
  const u = updater
  void u.init().then(
    () => u.startAuto(updateCheckDelayMs()),
    (e) => log('warn', 'update init failed', e)
  )
})

app.on('window-all-closed', () => {
  void closeStore().finally(() => app.quit())
})

// Last step of quitting (data flushed, folder closed): a downloaded update is installed now; the
// installer / swap helper finishes after this process has exited.
app.on('will-quit', () => {
  stopOcr()
  updater?.applyOnQuit()
})
