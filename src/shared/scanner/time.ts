/**
 * New York time for the scanner: trading day 17:00 → 17:00 NY, H4 aligned to 17:00 NY, week Sunday 17:00 → Friday
 * 17:00 NY, FX market hours. Offsets come from the IANA database (luxon) and are cached per year, so per-minute
 * calls stay cheap; never a fixed UTC offset.
 */
import { DateTime } from 'luxon'
import type { Interval, Range } from './types'
import { INTERVAL_SECONDS } from './types'

export const NY_ZONE = 'America/New_York'
const DAY = 86400
/** Shifting New York local time by 7 h moves 17:00 to midnight, so a trading day is a calendar day of the shift. */
const SHIFT = 7 * 3600

interface Change {
  /** Instant from which `offset` applies (Unix seconds). */
  at: number
  /** UTC offset in minutes (−300 EST, −240 EDT). */
  offset: number
}

const yearChanges = new Map<number, Change[]>()

function ianaOffset(t: number): number {
  return DateTime.fromSeconds(t, { zone: NY_ZONE }).offset
}

/** Offset changes of one UTC year: the offset at 1 January plus every DST switch, found to the second. */
function changesOf(year: number): Change[] {
  const cached = yearChanges.get(year)
  if (cached) return cached
  const start = Date.UTC(year, 0, 1) / 1000
  const end = Date.UTC(year + 1, 0, 1) / 1000
  const out: Change[] = [{ at: start, offset: ianaOffset(start) }]
  let prevT = start
  let prev = out[0]!.offset
  for (let t = start + DAY / 2; t < end + DAY / 2; t += DAY) {
    const probe = Math.min(t, end - 1)
    const off = ianaOffset(probe)
    if (off !== prev) {
      // Binary search the first second with the new offset.
      let lo = prevT
      let hi = probe
      while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2)
        if (ianaOffset(mid) === prev) lo = mid
        else hi = mid
      }
      out.push({ at: hi, offset: off })
      prev = off
    }
    prevT = probe
  }
  yearChanges.set(year, out)
  return out
}

/** UTC offset of New York in minutes at instant `t`. */
export function nyOffsetMin(t: number): number {
  const year = new Date(t * 1000).getUTCFullYear()
  const changes = changesOf(year)
  let off = changes[0]!.offset
  for (const c of changes) {
    if (c.at <= t) off = c.offset
    else break
  }
  return off
}

/** New York wall clock as "seconds since epoch" (a UTC timestamp whose UTC fields read as NY local time). */
export function nyLocal(t: number): number {
  return t + nyOffsetMin(t) * 60
}

/** Converts a NY wall-clock value (seconds, as from nyLocal) to an instant; `hint` is any instant on the same day. */
export function fromNyLocal(local: number, hint: number = local): number {
  let t = local - nyOffsetMin(hint) * 60
  // A DST switch between hint and target: retry with the offset of the first guess.
  if (nyLocal(t) !== local) {
    const t2 = local - nyOffsetMin(t) * 60
    if (nyLocal(t2) === local) t = t2
  }
  return t
}

function isoDate(days: number): string {
  return new Date(days * DAY * 1000).toISOString().slice(0, 10)
}

/** Monday = 1 … Sunday = 7 for an epoch day number (1970-01-01 was a Thursday). */
function weekdayOfDay(days: number): number {
  return ((((days + 3) % 7) + 7) % 7) + 1
}

export interface NyParts {
  /** NY calendar date YYYY-MM-DD. */
  date: string
  /** Monday = 1 … Sunday = 7. */
  weekday: number
  hour: number
  minute: number
  /** Minutes since NY midnight. */
  minuteOfDay: number
}

export function nyParts(t: number): NyParts {
  const local = nyLocal(t)
  const days = Math.floor(local / DAY)
  const sec = local - days * DAY
  const minuteOfDay = Math.floor(sec / 60)
  return {
    date: isoDate(days),
    weekday: weekdayOfDay(days),
    hour: Math.floor(minuteOfDay / 60),
    minute: minuteOfDay % 60,
    minuteOfDay
  }
}

/** FX market open: Sunday 17:00 NY → Friday 17:00 NY (holidays are just missing data, not closures). */
export function isMarketOpen(t: number): boolean {
  const wd = weekdayOfDay(Math.floor((nyLocal(t) + SHIFT) / DAY))
  return wd <= 5
}

/** Trading day (17:00 → 17:00 NY) containing `t`, labelled with the NY date on which it ends. */
export function tradingDay(t: number): string {
  return isoDate(Math.floor((nyLocal(t) + SHIFT) / DAY))
}

/** Start of the bucket of `interval` containing `t`. */
export function bucketStart(t: number, interval: Interval): number {
  switch (interval) {
    case 'M1':
    case 'M5':
    case 'M15':
    case 'H1': {
      // NY offsets are whole hours, so these align identically in UTC and NY.
      const size = INTERVAL_SECONDS[interval]
      return Math.floor(t / size) * size
    }
    case 'H4': {
      const s = nyLocal(t) + SHIFT
      const start = Math.floor(s / (4 * 3600)) * 4 * 3600
      return fromNyLocal(start - SHIFT, t)
    }
    case 'D': {
      const s = nyLocal(t) + SHIFT
      return fromNyLocal(Math.floor(s / DAY) * DAY - SHIFT, t)
    }
    case 'W': {
      const s = nyLocal(t) + SHIFT
      const days = Math.floor(s / DAY)
      const monday = days - (weekdayOfDay(days) - 1)
      return fromNyLocal(monday * DAY - SHIFT, t)
    }
  }
}

/** End (exclusive) of the bucket that starts at `start`; D and W end at 17:00 NY (W on Friday). */
export function bucketEnd(start: number, interval: Interval): number {
  switch (interval) {
    case 'M1':
    case 'M5':
    case 'M15':
    case 'H1':
    case 'H4':
      return start + INTERVAL_SECONDS[interval]
    case 'D':
      return fromNyLocal(nyLocal(start) + DAY, start + DAY)
    case 'W':
      return fromNyLocal(nyLocal(start) + 5 * DAY, start + 5 * DAY)
  }
}

/** Open-market parts of [from, to): the weekend (Friday 17:00 → Sunday 17:00 NY) is cut out. */
export function marketRanges(from: number, to: number): Range[] {
  const out: Range[] = []
  let t = from
  while (t < to) {
    const wStart = bucketStart(t, 'W')
    const wEnd = bucketEnd(wStart, 'W')
    const a = Math.max(t, wStart)
    const b = Math.min(to, wEnd)
    if (b > a) out.push({ from: a, to: b })
    // Next week starts the Sunday after this week's Friday close.
    t = bucketStart(wEnd + 3 * DAY, 'W')
    if (t <= a) break
  }
  return out
}

/** Seconds of open market in [from, to). */
export function marketSeconds(from: number, to: number): number {
  return marketRanges(from, to).reduce((s, r) => s + (r.to - r.from), 0)
}
