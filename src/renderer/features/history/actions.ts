import type { HistoryKind } from '@shared/api'
import { api, errorMessage } from '../../lib/api'
import { adoptJournal, flushSaves } from '../../store/journal'
import { toast } from '../../store/ui'

/** Make a kept version current: pending edits are written first, the current version goes to the history. */
export async function restoreVersion(kind: HistoryKind, id: string, file: string, label: string): Promise<boolean> {
  try {
    if (!(await flushSaves())) throw new Error('Nie udało się zapisać bieżących zmian – spróbuj ponownie za chwilę.')
    const journal = await api.historyRestore(kind, id, file)
    if (journal) adoptJournal(journal)
    toast(`Przywrócono: ${label}. Poprzednia wersja jest w historii.`, 'success', 5000)
    return true
  } catch (e) {
    toast(errorMessage(e), 'error', 7000)
    return false
  }
}
