/// <reference types="vite/client" />
import type { JournalApi } from '@shared/api'

declare global {
  interface Window {
    journal: JournalApi
  }
}

export {}
