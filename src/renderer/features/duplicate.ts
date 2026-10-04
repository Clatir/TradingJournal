import { shiftTradingDay } from '@shared/calc/time'
import { copyDayPlanTo, duplicateLibraryItem, duplicateTrade } from '@shared/duplicate'
import { addRecord, discardDraft, useJournal } from '../store/journal'
import { navigate, toast, useUi } from '../store/ui'
import { currentScenarioId, duplicateScenario } from './forecast/actions'

/**
 * Null when the entry can be copied; otherwise the reason (already shown as a toast). An entry written by
 * a newer app version is not copied: the copy would carry a format this version does not know.
 */
function blocked(entry: { readOnly: boolean }): string | null {
  const status = useJournal.getState().status
  const reason = status?.readOnly
    ? (status.readOnlyReason ?? 'Folder danych jest tylko do odczytu.')
    : entry.readOnly
      ? 'Ten wpis zapisała nowsza wersja aplikacji – zaktualizuj aplikację, żeby go skopiować.'
      : null
  if (reason) toast(reason, 'error', 5000)
  return reason
}

/** Save an exact copy of a trade right away and open it in the editor. */
export function duplicateTradeEntry(id: string): string | null {
  const { trades, drafts } = useJournal.getState()
  const entry = trades[id]
  if (!entry || blocked(entry)) return null
  const source = entry.record
  if (drafts[id]) {
    toast('Ta transakcja nie jest jeszcze zapisana – najpierw coś w niej wpisz.', 'info')
    return null
  }
  const copy = duplicateTrade(source, new Date().toISOString())
  addRecord('trades', copy)
  useUi.setState({ selectedTradeId: copy.id })
  navigate({ page: 'trade', id: copy.id })
  toast('Utworzono kopię transakcji – teraz edytujesz kopię.', 'success')
  return copy.id
}

export function duplicateLibraryEntry(id: string): string | null {
  const { library, drafts } = useJournal.getState()
  const entry = library[id]
  if (!entry || blocked(entry)) return null
  const source = entry.record
  if (drafts[id]) {
    toast('Ten przykład nie jest jeszcze zapisany – najpierw coś w nim wpisz.', 'info')
    return null
  }
  const copy = duplicateLibraryItem(source, new Date().toISOString())
  addRecord('library', copy)
  navigate({ page: 'library', id: copy.id })
  toast('Utworzono kopię przykładu.', 'success')
  return copy.id
}

/** Carry the analysis of the plan for `fromDate` over to `toDate` (a date without a plan yet). */
export function copyDayPlanToDate(fromDate: string, toDate: string): boolean {
  const { days, drafts } = useJournal.getState()
  const all = Object.values(days)
  const entry = all.find((e) => e.record.date === fromDate)
  if (!entry || blocked(entry)) return false
  const source = entry.record
  if (drafts[source.id]) {
    toast('Ten plan nie jest jeszcze zapisany – nie ma czego kopiować.', 'info')
    return false
  }
  if (toDate === fromDate) {
    toast('Wybierz inny dzień niż bieżący.', 'error')
    return false
  }
  const existing = all.find((e) => e.record.date === toDate)
  if (existing && !drafts[existing.record.id]) {
    toast(`Plan na ${toDate} już istnieje – nic nie skopiowano.`, 'error', 5000)
    return false
  }
  // An untouched (never saved) draft for the target day just makes room for the copy.
  if (existing) discardDraft('days', existing.record.id)
  addRecord('days', copyDayPlanTo(source, toDate, new Date().toISOString()))
  navigate({ page: 'day', date: toDate })
  toast(`Skopiowano analizę na ${toDate}.`, 'success')
  return true
}

/** Ctrl+Shift+D: duplicate whatever entry is on screen (a plan goes to the next trading day). */
export function duplicateCurrent(): void {
  const { route, selectedTradeId } = useUi.getState()
  if (route.page === 'trade') duplicateTradeEntry(route.id)
  else if (route.page === 'journal' && selectedTradeId) duplicateTradeEntry(selectedTradeId)
  else if (route.page === 'library' && route.id) duplicateLibraryEntry(route.id)
  else if (route.page === 'day') copyDayPlanToDate(route.date, shiftTradingDay(route.date, 1))
  else if (route.page === 'forecast') {
    const id = currentScenarioId(route.id)
    if (id) duplicateScenario(id)
    else toast('Nie ma jeszcze scenariusza do skopiowania.')
  } else toast('Duplikowanie: otwórz transakcję, przykład z biblioteki, plan dnia albo scenariusz prognozy.')
}
