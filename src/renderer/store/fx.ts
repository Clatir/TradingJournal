import { useEffect } from 'react'
import { create } from 'zustand'
import { NBP_RECHECK_MS, nbpFetchDue, nbpRecheckDue } from '@shared/fx'
import { changeAccountCurrency } from '@shared/risk'
import { api, errorMessage } from '../lib/api'
import { fmtAmount } from '../lib/format'
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
 * switched on, the folder is writable, it is not the demo and the last table is older than 12 h. While the app stays
 * open, every hour: when the table of the latest working day (from 12:30 Warsaw time) is not there yet. Without the
 * internet nothing changes – the calculators keep the last fetched table.
 */
export function useFxAutoFetch(): void {
  const dataDir = useJournal((s) => (s.phase === 'ready' ? (s.status?.dataDir ?? null) : null))
  const delay = useJournal((s) => s.appInfo?.fxFetchDelayMs ?? null)
  useEffect(() => {
    if (!dataDir || delay == null) return
    const check = (due: typeof nbpFetchDue) => {
      const { journal, status } = useJournal.getState()
      if (!journal || !status || status.dataDir !== dataDir) return
      if (due(journal.settings, { readOnly: status.readOnly, isSample: status.isSample, now: new Date() })) void refreshFxRates(false)
    }
    const timer = setTimeout(() => check(nbpFetchDue), delay)
    const interval = setInterval(() => check(nbpRecheckDue), NBP_RECHECK_MS)
    return () => {
      clearTimeout(timer)
      clearInterval(interval)
    }
  }, [dataDir, delay])
}

/**
 * Account currency from the calculator or the settings: hand-entered rates and pip values stay with their currency,
 * the balance is converted at the rate old → new (NBP or typed), so the position size keeps its meaning.
 */
export function setAccountCurrency(next: string): void {
  const { journal, status } = useJournal.getState()
  if (!journal) return
  const prev = journal.settings.risk.accountCurrency
  if (prev === next) return
  if (status?.readOnly) {
    toast(status.readOnlyReason ?? 'Folder danych jest tylko do odczytu.', 'error', 5000)
    return
  }
  const { balance } = changeAccountCurrency(journal.settings, next)
  updateJournal((j) => ({ ...j, settings: { ...j.settings, risk: changeAccountCurrency(j.settings, next).risk } }))
  const kept = 'Kursy wpisane ręcznie i ręczne wartości pipsa są pamiętane osobno dla każdej waluty konta.'
  if (balance)
    toast(
      `Waluta konta: ${next}. Kapitał przeliczony: ${fmtAmount(balance.before, prev)} → ${fmtAmount(balance.after, next)} (kurs ${balance.rate.rate}${balance.rate.source === 'nbp' ? ' NBP' : ', wpisany ręcznie'}). ${kept}`,
      'info',
      9000
    )
  else if (journal.settings.risk.accountBalance)
    toast(`Waluta konta: ${next}. Brak kursu ${prev} → ${next}, więc kapitał nie został przeliczony – sprawdź kwotę. ${kept}`, 'info', 9000)
  else toast(`Waluta konta: ${next}. ${kept}`, 'info', 6000)
}

