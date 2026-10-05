/**
 * Copies of records under a new identity. Screenshot files are shared, never copied: the datastore only
 * deletes a screenshot when no record references it any more.
 */
import { newId } from './ids'
import { SCHEMA_VERSION } from './schema/common'
import type { DayPlan, Forecast, LibraryItem, Trade } from './schema'

/** Exact copy of a trade (setup, prices, exits, psychology, notes, screenshots) as a new entry. */
export function duplicateTrade(trade: Trade, now: string): Trade {
  const copy = structuredClone(trade)
  return {
    ...copy,
    schemaVersion: SCHEMA_VERSION,
    id: newId(),
    createdAt: now,
    updatedAt: now,
    exits: copy.exits.map((x) => ({ ...x, id: newId() })),
    // The copy is not the broker's position: a later history import must not see one ticket twice.
    broker: null
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

/** "<name> (kopia)", then "(kopia 2)", "(kopia 3)"… – the first one not taken; the name is shortened to fit `max`. */
export function copyName(name: string, taken: Iterable<string>, max = 60): string {
  // Case-insensitive, like the duplicate check of the name field.
  const names = new Set([...taken].map((t) => t.toLowerCase()))
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? ' (kopia)' : ` (kopia ${n})`
    const candidate = `${name.slice(0, Math.max(0, max - suffix.length)).trimEnd()}${suffix}`
    if (!names.has(candidate.toLowerCase())) return candidate
  }
}

/**
 * Copy of a payout forecast scenario under a new identity and a "(kopia)" name. The stored random numbers
 * are kept, so the copy shows the same table until something is changed.
 */
export function duplicateForecast(forecast: Forecast, takenNames: Iterable<string>, now: string): Forecast {
  const copy = structuredClone(forecast)
  return {
    ...copy,
    schemaVersion: SCHEMA_VERSION,
    id: newId(),
    createdAt: now,
    updatedAt: now,
    name: copyName(copy.name, takenNames),
    goals: copy.goals.map((g) => ({ ...g, id: newId() }))
  }
}
