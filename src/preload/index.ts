import { contextBridge, ipcRenderer } from 'electron'
import type { ChangeSet, JournalApi } from '@shared/api'

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
  pickTextFile: (filter) => invoke('pickTextFile', filter),
  showPath: (abs) => invoke('showPath', abs),
  onChange: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, change: ChangeSet) => cb(change)
    ipcRenderer.on('journal:change', listener)
    return () => ipcRenderer.removeListener('journal:change', listener)
  },
  onFlushRequest: (cb) => {
    const listener = () => {
      cb().finally(() => ipcRenderer.send('journal:flushed'))
    }
    ipcRenderer.on('journal:flush', listener)
    return () => ipcRenderer.removeListener('journal:flush', listener)
  }
}

contextBridge.exposeInMainWorld('journal', api)
