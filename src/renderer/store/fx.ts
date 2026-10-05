import { useEffect } from 'react'
import { create } from 'zustand'
import { nbpFetchDue } from '@shared/fx'
import { api, errorMessage } from '../lib/api'
import { updateJournal, useJournal } from './journal'
import { toast } from './ui'

/** An NBP fetch is running (the refresh button waits). */
export const useFxFetch = create<{ busy: boolean }>(() => ({ busy: false }))

/**
 * Fetch NBP table A through the main process and keep it in the journal settings when its number changed.
 * The automatic fetch stays silent on failure (the main process logs it); the button reports it.
 */
export async function refreshFxRates(manual: boolean): Promise<void> {
  if (useFxFetch.getState().busy) return
  if (useJournal.getState().status?.readOnly) {
    // The table could not be kept in the settings (e.g. the palette command in a read-only folder).
    if (manual) toast('Folder jest tylko do odczytu – kursów NBP nie można zapisać.', 'error', 5000)
    return
  }
  useFxFetch.setState({ busy: true })
  const current = useJournal.getState().journal?.settings.fx.nbp ?? null
  const kept = current ? ` Zostają kursy z dnia ${current.effectiveDate}.` : ''
  try {
    const res = await api.fetchFxRates()
    if (res.ok) {
      const changed = current?.no !== res.table.no
      if (changed) updateJournal((j) => ({ ...j, settings: { ...j.settings, fx: { ...j.settings.fx, nbp: res.table } } }))
      if (manual)
        toast(
          changed ? `Pobrano kursy NBP: tabela ${res.table.no} z dnia ${res.table.effectiveDate}.` : `Kursy NBP są aktualne: tabela ${res.table.no} z dnia ${res.table.effectiveDate}.`,
          'success'
        )
    } else if (manual) toast(`Nie udało się pobrać kursów NBP: ${res.message}.${kept}`, 'error', 6000)
  } catch (e) {
    if (manual) toast(`Nie udało się pobrać kursów NBP: ${errorMessage(e)}.${kept}`, 'error', 6000)
  } finally {
    useFxFetch.setState({ busy: false })
  }
}

/**
 * Automatic fetch a while after a journal is opened (20 s, ICTJ_NBP_FETCH_DELAY_MS in tests): only when it is
 * switched on, the folder is writable, it is not the demo and the last table is older than 12 h.
 */
export function useFxAutoFetch(): void {
  const dataDir = useJournal((s) => (s.phase === 'ready' ? (s.status?.dataDir ?? null) : null))
  const delay = useJournal((s) => s.appInfo?.fxFetchDelayMs ?? null)
  useEffect(() => {
    if (!dataDir || delay == null) return
    const timer = setTimeout(() => {
      const { journal, status } = useJournal.getState()
      if (!journal || !status || status.dataDir !== dataDir) return
      if (nbpFetchDue(journal.settings, { readOnly: status.readOnly, isSample: status.isSample, now: new Date() })) void refreshFxRates(false)
    }, delay)
    return () => clearTimeout(timer)
  }, [dataDir, delay])
}
