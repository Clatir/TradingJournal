import { create } from 'zustand'
import type { ScreenRef } from '@shared/schema'

export type Route =
  | { page: 'journal' }
  | { page: 'trade'; id: string }
  | { page: 'day'; date: string }
  | { page: 'analytics' }
  | { page: 'calculator'; tradeId?: string }
  | { page: 'settings'; tab?: SettingsTab }
  | { page: 'sync' }

export type SettingsTab = 'folder' | 'pairs' | 'killzones' | 'rules' | 'dictionaries' | 'screens' | 'display'

export interface Toast {
  id: number
  kind: 'info' | 'success' | 'error'
  text: string
}

export interface LightboxState {
  screens: ScreenRef[]
  index: number
}

interface UiState {
  route: Route
  history: Route[]
  paletteOpen: boolean
  lightbox: LightboxState | null
  toasts: Toast[]
  selectedTradeId: string | null
}

export const useUi = create<UiState>(() => ({
  route: { page: 'journal' },
  history: [],
  paletteOpen: false,
  lightbox: null,
  toasts: [],
  selectedTradeId: null
}))

export function navigate(route: Route): void {
  useUi.setState((s) => ({ route, history: [...s.history.slice(-20), s.route] }))
}

export function goBack(): void {
  useUi.setState((s) => {
    const prev = s.history.at(-1)
    return prev ? { route: prev, history: s.history.slice(0, -1) } : { route: { page: 'journal' } }
  })
}

let toastSeq = 0
export function toast(text: string, kind: Toast['kind'] = 'info', ms = 3200): void {
  const id = ++toastSeq
  useUi.setState((s) => ({ toasts: [...s.toasts.slice(-4), { id, kind, text }] }))
  setTimeout(() => useUi.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ms)
}

export function openLightbox(screens: ScreenRef[], index: number): void {
  if (screens.length) useUi.setState({ lightbox: { screens, index } })
}

export function closeLightbox(): void {
  useUi.setState({ lightbox: null })
}

export function setPalette(open: boolean): void {
  useUi.setState({ paletteOpen: open })
}
