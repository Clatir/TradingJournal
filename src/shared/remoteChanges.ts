/**
 * What to do with a version of a record that arrived from outside (another computer through cloud sync) while
 * this computer has the data folder open. Pure; the renderer store applies the decision.
 */
import { deepEqual, diffRecords, merge3, type MergeConflict } from './merge'

export type RemoteMode = 'merge' | 'ask'

export type RemoteDecision =
  /** Take the incoming version as it is. */
  | { action: 'take' }
  /** Nothing to do (the incoming version is what this computer already has). */
  | { action: 'ignore' }
  /** Local unsaved edits and incoming changes touch different fields: use `merged` and save it. */
  | { action: 'merge'; merged: unknown }
  /** Ask the user (conflicting fields, or "ask" mode). */
  | { action: 'ask'; conflicts: MergeConflict[] }

export interface RemoteInput {
  mode: RemoteMode
  /** The local record has unsaved edits (or edits waiting for a decision). */
  dirty: boolean
  /** Version both sides started from: what this computer had on disk before its edits (undefined = unknown). */
  base: unknown
  /** What this computer has now (null = it does not have the record). */
  mine: unknown | null
  /** The incoming version. */
  theirs: unknown
}

export function decideRemote({ mode, dirty, base, mine, theirs }: RemoteInput): RemoteDecision {
  if (mine == null) return { action: 'take' }
  if (diffRecords(mine, theirs).length === 0) return dirty ? { action: 'ignore' } : { action: 'take' }
  if (!dirty) return mode === 'merge' ? { action: 'take' } : { action: 'ask', conflicts: [] }
  const { merged, conflicts } = merge3(base, mine, theirs)
  if (mode === 'merge' && conflicts.length === 0) return { action: 'merge', merged }
  return { action: 'ask', conflicts }
}

/** Deletion on the other computer: delete here too, or ask (local edits, or "ask" mode). */
export function decideRemoteRemoval({ mode, dirty }: { mode: RemoteMode; dirty: boolean }): 'remove' | 'ask' {
  return !dirty && mode === 'merge' ? 'remove' : 'ask'
}

/** True when two versions differ only in bookkeeping (updatedAt…). */
export const sameContent = (a: unknown, b: unknown) => deepEqual(a, b) || diffRecords(a, b).length === 0
