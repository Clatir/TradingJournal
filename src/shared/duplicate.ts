/**
 * Copies of records under a new identity. Screenshot files are shared, never copied: the datastore only
 * deletes a screenshot when no record references it any more.
 */
import { newId } from './ids'
import { SCHEMA_VERSION } from './schema/common'
import type { DayPlan, LibraryItem, Trade } from './schema'

/** Exact copy of a trade (setup, prices, exits, psychology, notes, screenshots) as a new entry. */
export function duplicateTrade(trade: Trade, now: string): Trade {
  const copy = structuredClone(trade)
  return {
    ...copy,
    schemaVersion: SCHEMA_VERSION,
    id: newId(),
    createdAt: now,
    updatedAt: now,
    exits: copy.exits.map((x) => ({ ...x, id: newId() }))
  }
}

/** Copy of a library example; the title is marked so the two are easy to tell apart. */
export function duplicateLibraryItem(item: LibraryItem, now: string): LibraryItem {
  const copy = structuredClone(item)
  return {
    ...copy,
    schemaVersion: SCHEMA_VERSION,
    id: newId(),
    createdAt: now,
    updatedAt: now,
    title: copy.title.trim() ? `${copy.title} (kopia)` : 'Kopia przykładu'
  }
}

/**
 * The analysis of a day plan carried over to another trading date: per-pair bias, draw on liquidity,
 * key levels and scenarios, intermarket reads and notes. News, the post-session review and
 * screenshots describe the original day and are not copied.
 */
export function copyDayPlanTo(plan: DayPlan, date: string, now: string): DayPlan {
  const copy = structuredClone(plan)
  return {
    ...copy,
    schemaVersion: SCHEMA_VERSION,
    id: newId(),
    createdAt: now,
    updatedAt: now,
    date,
    pairs: copy.pairs.map((p) => ({ ...p, keyLevels: p.keyLevels.map((l) => ({ ...l, id: newId() })), screens: [] })),
    news: [],
    review: { ...copy.review, whatHappened: '', vsPlan: null, notes: '' },
    screens: []
  }
}
