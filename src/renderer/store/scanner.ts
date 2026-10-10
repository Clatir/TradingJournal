/**
 * Scanner state in the window: status from the main process, last prices, and the sync of the journal's scanner
 * settings to the main process (which connects to EODHD). Charts subscribe to live M1 updates with `onScannerLive`.
 */
import { useEffect } from 'react'
import { create } from 'zustand'
import type { LiveUpdate, ScannerStatus } from '@shared/scanner/api'
import { api } from '../lib/api'
import { useJournal } from './journal'

interface ScannerUiState {
  status: ScannerStatus | null
  /** Last bid / ask per symbol. */
  prices: Record<string, { bid: number; ask: number; t: number }>
}

export const useScanner = create<ScannerUiState>(() => ({ status: null, prices: {} }))

type LiveListener = (updates: LiveUpdate[]) => void
const liveListeners = new Set<LiveListener>()

export function onScannerLive(cb: LiveListener): () => void {
  liveListeners.add(cb)
  return () => liveListeners.delete(cb)
}

let started = false

/** Listens to the main process (called once from the app). */
export function initScanner(): void {
  if (started) return
  started = true
  api.scanner.onEvent((event) => {
    if (event.type === 'status') {
      useScanner.setState({ status: event.status })
      return
    }
    const prices = { ...useScanner.getState().prices }
    for (const u of event.updates) prices[u.symbol] = { bid: u.bid, ask: u.ask, t: u.t }
    useScanner.setState({ prices })
    for (const cb of liveListeners) cb(event.updates)
  })
  void api.scanner.status().then((status) => useScanner.setState({ status }))
}

/** Sends the scanner settings to the main process whenever they change (after a folder is open). */
export function useScannerSync(): void {
  const scanner = useJournal((s) => s.journal?.settings.scanner ?? null)
  const accountCurrency = useJournal((s) => s.journal?.settings.risk.accountCurrency ?? 'USD')
  useEffect(() => {
    initScanner()
  }, [])
  useEffect(() => {
    if (!scanner) return
    const t = setTimeout(() => {
      api.scanner.configure({ scanner, accountCurrency }).then(
        (status) => useScanner.setState({ status }),
        () => undefined
      )
    }, 500)
    return () => clearTimeout(t)
  }, [scanner, accountCurrency])
}

/** Re-reads the status now (after actions in the settings). */
export async function refreshScannerStatus(): Promise<void> {
  useScanner.setState({ status: await api.scanner.status() })
}
