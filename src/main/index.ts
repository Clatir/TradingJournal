import { promises as fs } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { BrowserWindow, Menu, app, dialog, ipcMain, net, protocol, shell, type IpcMainInvokeEvent } from 'electron'
import { FILE_URL_SCHEME, type AppInfo, type ChangeSet, type OpenFolderResult } from '@shared/api'
import type { Collection } from '@shared/paths'
import { sanitizeRelPath } from '@shared/paths'
import { ConfigStore } from './config'
import { DataStore } from './datastore/store'
import { FolderWatcher } from './datastore/watch'
import { clearPresence, readOtherMachines, writePresence } from './datastore/presence'
import { initLog, log } from './log'

// Test hooks: isolated user data and a preselected data folder (no dialogs in E2E runs).
if (process.env.ICTJ_USER_DATA) app.setPath('userData', process.env.ICTJ_USER_DATA)

const machineName = process.env.ICTJ_MACHINE_NAME || hostname() || 'KOMPUTER'
const config = new ConfigStore(app.getPath('userData'))
const sampleDir = () => join(app.getPath('userData'), 'sample-journal')

let mainWindow: BrowserWindow | null = null
let store: DataStore | null = null
let watcher: FolderWatcher | null = null
let presenceTimer: NodeJS.Timeout | null = null

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
  if (!s.status().readOnly) await writePresence(s.root, machineName, app.getVersion()).catch(() => undefined)
  const others = await readOtherMachines(s.root, machineName)
  if (JSON.stringify(others) !== JSON.stringify(s.otherMachines)) {
    s.otherMachines = others
    send(await s.refresh([]))
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
          message: kind === 'empty' ? 'Folder jest pusty - można w nim utworzyć nowy dziennik.' : 'Folder nie istnieje.'
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
    await closeStore()
    const isSample = target === sampleDir()
    const next = new DataStore(target, { machineName, trash, backupDir: isSample ? null : config.get().backupDirOverride, isSample })
    const snapshot = await next.open()
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
    isPortable: !!process.env.PORTABLE_EXECUTABLE_DIR
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
  handle('journal:openExternal', async (url: string) => {
    if (!/^https:\/\//i.test(url)) throw new Error('Można otwierać tylko adresy https://')
    await shell.openExternal(url)
  })
  handle('journal:rescan', async () => {
    if (store) send(await store.refresh())
  })
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
  win.on('close', (e) => {
    if (allowClose) return
    e.preventDefault()
    const b = win.getNormalBounds()
    void config.update({ window: { ...b, maximized: win.isMaximized() } })
    const finish = () => {
      if (allowClose) return
      allowClose = true
      win.close()
    }
    const timeout = setTimeout(finish, 4000)
    ipcMain.once('journal:flushed', () => {
      clearTimeout(timeout)
      finish()
    })
    win.webContents.send('journal:flush')
  })
  win.on('focus', () => {
    store?.refresh().then(send, () => undefined)
  })
  win.on('closed', () => {
    mainWindow = null
  })

  if (devUrl) void win.loadURL(devUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)
  initLog(app.getPath('userData'))
  log('info', `start v${app.getVersion()} on ${machineName}`)
  await config.load()
  registerFileProtocol()
  registerIpc()
  createWindow()
})

app.on('window-all-closed', () => {
  void closeStore().finally(() => app.quit())
})
