import { DateTime } from 'luxon'
import type { Killzone } from '../schema/journal'

export const ZONE_NY = 'America/New_York'
export const ZONE_WAW = 'Europe/Warsaw'
export type ZoneKey = 'NY' | 'WAW' | 'UTC'

export const ZONES: Record<ZoneKey, string> = { NY: ZONE_NY, WAW: ZONE_WAW, UTC: 'UTC' }

export function zoned(iso: string, zone: ZoneKey): DateTime {
  return DateTime.fromISO(iso, { zone: 'utc' }).setZone(ZONES[zone])
}

/** Trading day = New York calendar date of the given instant. */
export function tradingDateNy(iso: string): string {
  return zoned(iso, 'NY').toISODate() ?? iso.slice(0, 10)
}

export function formatClock(iso: string, zone: ZoneKey): string {
  return zoned(iso, zone).toFormat('HH:mm')
}

export function formatDateTime(iso: string, zone: ZoneKey): string {
  return zoned(iso, zone).toFormat('yyyy-MM-dd HH:mm')
}

export function minutesOfDay(iso: string, zone: ZoneKey): number {
  const d = zoned(iso, zone)
  return d.hour * 60 + d.minute
}

export function parseClock(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

export interface LocalTimeResult {
  /** UTC ISO string (always with Z). */
  iso: string
  /** Local time does not exist (spring forward gap); shifted forward by Luxon. */
  nonexistent: boolean
  /** Local time occurs twice (fall back); the earlier instant is used. */
  ambiguous: boolean
}

/**
 * Convert a wall-clock date/time in the given zone to a UTC instant.
 * Flags DST gaps and overlaps so the UI can warn about them.
 */
export function fromLocal(date: string, time: string, zone: ZoneKey): LocalTimeResult | null {
  const wall = `${date} ${time}`
  const naive = DateTime.fromFormat(wall, 'yyyy-MM-dd HH:mm', { zone: 'utc' })
  if (!naive.isValid) return null
  const zoneName = ZONES[zone]
  // Offsets in force half a day around the wall time cover both sides of any DST switch.
  const offsets = new Set([
    naive.minus({ hours: 12 }).setZone(zoneName).offset,
    naive.plus({ hours: 12 }).setZone(zoneName).offset
  ])
  const candidates = [...offsets]
    .map((offset) => naive.minus({ minutes: offset }))
    .filter((c) => c.setZone(zoneName).toFormat('yyyy-MM-dd HH:mm') === wall)
    .sort((a, b) => a.toMillis() - b.toMillis())
  if (candidates.length === 0) {
    // Spring-forward gap: Luxon moves the wall time forward by the DST shift.
    const shifted = DateTime.fromFormat(wall, 'yyyy-MM-dd HH:mm', { zone: zoneName })
    return { iso: shifted.toUTC().toISO() ?? '', nonexistent: true, ambiguous: false }
  }
  return { iso: candidates[0]!.toUTC().toISO() ?? '', nonexistent: false, ambiguous: candidates.length > 1 }
}

/** UTC offset difference (hours) between Warsaw and New York at an instant; 6 normally, 5 in DST mismatch weeks. */
export function nyWarsawGapHours(iso: string): number {
  return (zoned(iso, 'WAW').offset - zoned(iso, 'NY').offset) / 60
}

function inWindow(minute: number, start: number, end: number): boolean {
  if (start === end) return false
  if (start < end) return minute >= start && minute < end
  // Window crossing midnight, e.g. 20:00-00:00 or 22:00-02:00
  return minute >= start || minute < end
}

/** All (non-archived) killzones containing the instant, evaluated in New York local time. */
export function killzonesAt(iso: string, killzones: readonly Killzone[]): Killzone[] {
  const minute = minutesOfDay(iso, 'NY')
  return killzones.filter((kz) => !kz.archived && inWindow(minute, parseClock(kz.start), parseClock(kz.end)))
}

/** The killzone currently active (NY time), preferring the narrowest window. */
export function primaryKillzone(iso: string, killzones: readonly Killzone[]): Killzone | null {
  const hits = killzonesAt(iso, killzones)
  if (hits.length === 0) return null
  const width = (kz: Killzone) => {
    const s = parseClock(kz.start)
    const e = parseClock(kz.end)
    return e > s ? e - s : 1440 - s + e
  }
  return [...hits].sort((a, b) => width(a) - width(b))[0] ?? null
}

/** ISO week id (e.g. 2026-W40) of a trading date. */
export function isoWeekOf(date: string): string {
  const d = DateTime.fromISO(date, { zone: 'utc' })
  return `${d.weekYear}-W${String(d.weekNumber).padStart(2, '0')}`
}

/** NY weekday 1 (Mon) .. 7 (Sun) of an instant. */
export function weekdayNy(iso: string): number {
  return zoned(iso, 'NY').weekday
}

export function nowIso(): string {
  return new Date().toISOString()
}
