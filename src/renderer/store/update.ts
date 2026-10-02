import { create } from 'zustand'
import type { UpdatePrefs, UpdateState } from '@shared/update'
import { api, errorMessage } from '../lib/api'
import { flushSaves } from './journal'
import { toast } from './ui'

/** Update status pushed by the main process (null until the first answer). */
export const useUpdate = create<{ state: UpdateState | null }>(() => ({ state: null }))

const setState = (state: UpdateState) => useUpdate.setState({ state })

let started = false
export function initUpdates(): void {
  if (started) return
  started = true
  api.onUpdateState(setState)
  void api.updateState().then(setState, () => undefined)
}

export async function checkForUpdates(): Promise<void> {
  try {
    setState(await api.checkForUpdates())
  } catch (e) {
    toast(errorMessage(e), 'error')
  }
}

export async function downloadUpdate(): Promise<void> {
  try {
    setState(await api.downloadUpdate())
  } catch (e) {
    toast(errorMessage(e), 'error')
  }
}

export async function setUpdatePrefs(prefs: Partial<UpdatePrefs>): Promise<void> {
  try {
    setState(await api.setUpdatePrefs(prefs))
  } catch (e) {
    toast(errorMessage(e), 'error')
  }
}

export async function dismissUpdateNotice(): Promise<void> {
  setState(await api.dismissUpdateNotice())
}

/** Save everything, then quit, install and start the new version. */
export async function restartToUpdate(): Promise<void> {
  if (!(await flushSaves())) {
    toast('Nie udało się zapisać bieżących zmian – aktualizacja wstrzymana. Spróbuj ponownie za chwilę.', 'error', 7000)
    return
  }
  try {
    await api.installUpdateNow()
  } catch (e) {
    toast(errorMessage(e), 'error')
  }
}
