import { create } from 'zustand'
import type { RecordEntry } from '@shared/api'
import type { Collection } from '@shared/paths'
import type { RecordTypes } from '@shared/records'
import type { JournalFile } from '@shared/schema'

/** A change from another computer waiting for the user's decision (merge / keep mine / take theirs). */
export interface PendingRemote {
  key: string
  collection: Collection | 'journal'
  id: string
  type: 'update' | 'removal'
  /** What this computer had on disk before its own edits (undefined = unknown). */
  base: unknown
  /** The incoming version (null for a deletion). */
  theirs: RecordEntry<RecordTypes[Collection]> | JournalFile | null
  /** This computer had unsaved edits of the record when the change arrived. */
  hadLocalEdits: boolean
  receivedAt: string
}

interface RemoteState {
  pending: PendingRemote[]
  /** The dialog is shown (hidden with "Później"; reopened from the top bar). */
  open: boolean
}

export const useRemote = create<RemoteState>(() => ({ pending: [], open: false }))

export function setRemoteDialog(open: boolean): void {
  useRemote.setState({ open })
}
