import { contextBridge, ipcRenderer } from 'electron'
import type { ChangeSet, JournalApi } from '@shared/api'
import type { UpdateState } from '@shared/update'

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(`journal:${channel}`, ...args)

const api: JournalApi = {
  appInfo: () => invoke('appInfo'),
  getConfig: () => invoke('getConfig'),
  loadCurrent: () => invoke('loadCurrent'),
  pickDataDir: (mode) => invoke('pickDataDir', mode),
  openDataDir: (dir, createIfEmpty) => invoke('openDataDir', dir, createIfEmpty),
  saveRecord: (collection, record) => invoke('saveRecord', collection, record),
  deleteRecord: (collection, id) => invoke('deleteRecord', collection, id),
  saveJournal: (journal) => invoke('saveJournal', journal),
  saveScreen: (input) => invoke('saveScreen', input),
  screensStats: () => invoke('screensStats'),
  deleteScreens: (paths) => invoke('deleteScreens', paths),
  resolveConflict: (id, keep) => invoke('resolveConflict', id, keep),
  trashProblemFile: (rel) => invoke('trashProblemFile', rel),
  showInFolder: (rel) => invoke('showInFolder', rel),
  openExternal: (url) => invoke('openExternal', url),
  rescan: () => invoke('rescan'),
  openSample: () => invoke('openSample'),
  resetSample: () => invoke('resetSample'),
  exitSample: () => invoke('exitSample'),
  saveTextFile: (name, content, filter) => invoke('saveTextFile', name, content, filter),
  exportZip: () => invoke('exportZip'),
  copyText: (text) => invoke('copyText', text),
  copyImage: (png) => invoke('copyImage', png),
  inspectImport: (kind) => invoke('inspectImport', kind),
  applyImport: (token, policy) => invoke('applyImport', token, policy),
  openImportAsNew: (token) => invoke('openImportAsNew', token),
  listBackups: () => invoke('listBackups'),
  backupNow: () => invoke('backupNow'),
  setBackupDir: (mode) => invoke('setBackupDir', mode),
  pickTextFile: (filter) => invoke('pickTextFile', filter),
  showPath: (abs) => invoke('showPath', abs),
  updateState: () => invoke('updateState'),
  checkForUpdates: () => invoke('checkForUpdates'),
  downloadUpdate: () => invoke('downloadUpdate'),
  installUpdateNow: () => invoke('installUpdateNow'),
  setUpdatePrefs: (prefs) => invoke('setUpdatePrefs', prefs),
  dismissUpdateNotice: () => invoke('dismissUpdateNotice'),
  fetchFxRates: () => invoke('fetchFxRates'),
  onUpdateState: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, state: UpdateState) => cb(state)
    ipcRenderer.on('journal:update', listener)
    return () => ipcRenderer.removeListener('journal:update', listener)
  },
  onChange: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, change: ChangeSet) => cb(change)
    ipcRenderer.on('journal:change', listener)
    return () => ipcRenderer.removeListener('journal:change', listener)
  },
  onFlushRequest: (cb) => {
    const listener = () => {
      cb().then(
        (saved) => ipcRenderer.send('journal:flushed', saved),
        () => ipcRenderer.send('journal:flushed', false)
      )
    }
    ipcRenderer.on('journal:flush', listener)
    return () => ipcRenderer.removeListener('journal:flush', listener)
  }
}

contextBridge.exposeInMainWorld('journal', api)
