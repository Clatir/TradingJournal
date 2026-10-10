/**
 * Sessions (killzones, New York local time) as UTC spans within a time window: for each New York date, start
 * inclusive, end exclusive, windows across midnight end the next day. DST is New York's (luxon / IANA), so a session
 * keeps its New York hours all year.
 */
import { DateTime } from 'luxon'
import type { Killzone } from '../schema/journal'
import { ZONE_NY } from './time'

export interface SessionSpan {
  id: string
  name: string
  kind: Killzone['kind']
  /** New York date the session starts on. */
  date: string
  from: number
  to: number
}

/** UTC ms of a New York wall time (a nonexistent one is moved forward, a double one takes the earlier instant). */
export function nyWallToMs(date: string, hhmm: string): number {
  return DateTime.fromISO(`${date}T${hhmm}`, { zone: ZONE_NY }).toMillis()
}

/** Spans of the (not archived) sessions overlapping [fromMs, toMs). */
export function sessionSpans(fromMs: number, toMs: number, killzones: readonly Killzone[]): SessionSpan[] {
  const out: SessionSpan[] = []
  if (!(toMs > fromMs)) return out
  // A session starting the day before the window may still be running in it.
  let d = DateTime.fromMillis(fromMs, { zone: ZONE_NY }).startOf('day').minus({ days: 1 })
  const last = DateTime.fromMillis(toMs, { zone: ZONE_NY }).startOf('day')
  for (; d <= last; d = d.plus({ days: 1 })) {
    const date = d.toISODate()!
    for (const kz of killzones) {
      if (kz.archived) continue
      const from = nyWallToMs(date, kz.start)
      let to = nyWallToMs(date, kz.end)
      if (to <= from) to = nyWallToMs(d.plus({ days: 1 }).toISODate()!, kz.end)
      if (to > fromMs && from < toMs) out.push({ id: kz.id, name: kz.name, kind: kz.kind, date, from, to })
    }
  }
  return out.sort((a, b) => a.from - b.from || a.to - b.to)
}
