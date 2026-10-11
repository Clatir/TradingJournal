/**
 * Time windows in New York time: sessions (liquidity pools), killzones (entries) and Silver Bullet windows.
 * Start inclusive, end exclusive; a window with `to` ≤ `from` runs through midnight (Asia 20:00–00:00).
 */
import type { TimeWindow } from './detectors/params'
import { nyParts, fromNyLocal, nyLocal } from './time'

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

/** True when the NY wall-clock minute of `t` is inside the window. */
export function inWindow(t: number, w: Pick<TimeWindow, 'from' | 'to'>): boolean {
  const m = nyParts(t).minuteOfDay
  const from = minutes(w.from)
  const to = minutes(w.to) || 1440
  return from < to ? m >= from && m < to : m >= from || m < to
}

export function windowsAt(t: number, windows: readonly TimeWindow[]): TimeWindow[] {
  return windows.filter((w) => inWindow(t, w))
}

/** [start, end) instants of the window occurrence that contains `t`, or the next one after `t`. */
export function windowRange(t: number, w: Pick<TimeWindow, 'from' | 'to'>): { from: number; to: number; active: boolean } {
  const p = nyParts(t)
  const dayStart = nyLocal(t) - p.minuteOfDay * 60 - (nyLocal(t) % 60)
  const from = minutes(w.from) * 60
  const to = (minutes(w.to) || 1440) * 60
  const len = from < to ? to - from : 86400 - from + to
  // Candidate starts: today's and yesterday's (for windows through midnight) and tomorrow's.
  for (const dayOffset of [-86400, 0, 86400]) {
    const start = dayStart + dayOffset + from
    const end = start + len
    const local = nyLocal(t)
    if (local >= start && local < end) return { from: fromNyLocal(start, t), to: fromNyLocal(end, t), active: true }
    if (local < start) return { from: fromNyLocal(start, t), to: fromNyLocal(end, t), active: false }
  }
  const start = dayStart + 2 * 86400 + from
  return { from: fromNyLocal(start, t), to: fromNyLocal(start + len, t), active: false }
}

/** The window currently active, else the next one to open (for the status bar countdown). */
export function currentOrNextWindow(t: number, windows: readonly TimeWindow[]): { window: TimeWindow; from: number; to: number; active: boolean } | null {
  let best: { window: TimeWindow; from: number; to: number; active: boolean } | null = null
  for (const w of windows) {
    const r = windowRange(t, w)
    if (r.active) return { window: w, ...r }
    if (!best || r.from < best.from) best = { window: w, ...r }
  }
  return best
}
