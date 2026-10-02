import type { JournalApi } from '@shared/api'

export const api: JournalApi = window.journal

/** Strip Electron's "Error invoking remote method ..." prefix from IPC errors. */
export function errorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  return raw.replace(/^Error invoking remote method '[^']+': /, '').replace(/^(\w*Error): /, '')
}
