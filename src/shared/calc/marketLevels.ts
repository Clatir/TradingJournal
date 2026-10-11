/**
 * ICT levels of a New York trading day from M1 bars (EODHD, 1.9.0). A trading day D is the forex daily candle
 * 17:00 NY of the day before → 17:00 NY of D (as TradingView's forex daily); the previous trading day of a Monday is
 * Friday. Weekend bars (EODHD has some) fall outside every session. Sessions: Asia from the settings (20:00–00:00 NY,
 * ending on D), London = the killzone named London (else 02:00–05:00 NY).
 */
import { DateTime } from 'luxon'
import type { Bar } from './ohlc'
import { nyWallToMs } from './sessionSpans'
import { ZONE_NY } from './time'
import type { Killzone } from '../schema/journal'

export type LevelId = 'pdh' | 'pdl' | 'pwh' | 'pwl' | 'asiaH' | 'asiaL' | 'londonH' | 'londonL' | 'dayOpen' | 'midnight' | 'open0830'

export interface MarketLevel {
  id: LevelId
  label: string
  price: number
  /** UTC ms of the bar holding the extreme / the open. */
  at: number
  /** From this moment the level is known (the session that makes it has ended). */
  knownFrom: number
  /** Highs are taken from below, lows from above; opens are references, not liquidity. */
  side: 'high' | 'low' | 'open'
}

export const LEVEL_LABELS: Record<LevelId, string> = {
  pdh: 'PDH',
  pdl: 'PDL',
  pwh: 'PWH',
  pwl: 'PWL',
  asiaH: 'Asia high',
  asiaL: 'Asia low',
  londonH: 'London high',
  londonL: 'London low',
  dayOpen: 'Otwarcie dnia (17:00)',
  midnight: 'NY midnight open',
  open0830: 'Otwarcie 08:30'
}

export interface LevelSessions {
  asia: { start: string; end: string }
  london: { start: string; end: string }
}

/** Asia from the settings, London from the killzone named "London" (else ICT's 02:00–05:00). */
export function levelSessions(asia: { start: string; end: string }, killzones: readonly Killzone[]): LevelSessions {
  const kz = killzones.find((k) => !k.archived && /london|londyn/i.test(k.name) && k.kind === 'killzone')
  return { asia, london: kz ? { start: kz.start, end: kz.end } : { start: '02:00', end: '05:00' } }
}

const nyDate = (date: string) => DateTime.fromISO(date, { zone: ZONE_NY })
const iso = (d: DateTime) => d.toISODate()!

/** Trading day (New York) an instant belongs to as a forex daily candle: from 17:00 NY it is the next day. */
export function sessionDateOf(iso: string): string {
  const ny = DateTime.fromISO(iso, { zone: 'utc' }).setZone(ZONE_NY)
  return (ny.hour >= 17 ? ny.plus({ days: 1 }) : ny).toISODate()!
}

/** The trading day before D (Monday → Friday). */
export function previousTradingDay(date: string): string {
  let d = nyDate(date).minus({ days: 1 })
  while (d.weekday > 5) d = d.minus({ days: 1 })
  return iso(d)
}

/** Forex daily session of D: 17:00 NY the day before → 17:00 NY of D. */
export function daySession(date: string): { from: number; to: number } {
  return { from: nyWallToMs(iso(nyDate(date).minus({ days: 1 })), '17:00'), to: nyWallToMs(date, '17:00') }
}

/** The week of D (Sunday 17:00 NY → Friday 17:00 NY) and the one before. */
export function weekSession(date: string, weeksBack = 0): { from: number; to: number } {
  const monday = nyDate(date).startOf('week').minus({ weeks: weeksBack })
  return { from: nyWallToMs(iso(monday.minus({ days: 1 })), '17:00'), to: nyWallToMs(iso(monday.plus({ days: 4 })), '17:00') }
}

/** The bars needed for the levels of D: from the previous week's start to the end of D. */
export function levelsWindow(date: string): { fromMs: number; toMs: number } {
  return { fromMs: weekSession(date, 1).from, toMs: daySession(date).to }
}

function extremes(bars: readonly Bar[], from: number, to: number): { high: Bar; low: Bar } | null {
  let high: Bar | null = null
  let low: Bar | null = null
  for (const b of bars) {
    if (b.t < from || b.t >= to) continue
    if (!high || b.high > high.high) high = b
    if (!low || b.low < low.low) low = b
  }
  return high && low ? { high, low } : null
}

/** Open of the first bar within 5 minutes after `at`. */
function openAt(bars: readonly Bar[], at: number): Bar | null {
  return bars.find((b) => b.t >= at && b.t < at + 5 * 60_000) ?? null
}

/** The levels of trading day D known from the bars (a session without bars gives none). */
export function dayLevels(date: string, bars: readonly Bar[], sessions: LevelSessions): MarketLevel[] {
  const out: MarketLevel[] = []
  const add = (id: LevelId, price: number, at: number, knownFrom: number, side: MarketLevel['side']) => out.push({ id, label: LEVEL_LABELS[id], price, at, knownFrom, side })
  const day = daySession(date)
  const prev = daySession(previousTradingDay(date))
  const pd = extremes(bars, prev.from, prev.to)
  if (pd) {
    add('pdh', pd.high.high, pd.high.t, prev.to, 'high')
    add('pdl', pd.low.low, pd.low.t, prev.to, 'low')
  }
  const pw = weekSession(date, 1)
  const w = extremes(bars, pw.from, pw.to)
  if (w) {
    add('pwh', w.high.high, w.high.t, pw.to, 'high')
    add('pwl', w.low.low, w.low.t, pw.to, 'low')
  }
  const before = iso(nyDate(date).minus({ days: 1 }))
  const asiaFrom = nyWallToMs(before, sessions.asia.start)
  let asiaTo = nyWallToMs(before, sessions.asia.end)
  if (asiaTo <= asiaFrom) asiaTo = nyWallToMs(date, sessions.asia.end)
  const asia = extremes(bars, asiaFrom, asiaTo)
  if (asia) {
    add('asiaH', asia.high.high, asia.high.t, asiaTo, 'high')
    add('asiaL', asia.low.low, asia.low.t, asiaTo, 'low')
  }
  const lonFrom = nyWallToMs(date, sessions.london.start)
  let lonTo = nyWallToMs(date, sessions.london.end)
  if (lonTo <= lonFrom) lonTo += 86_400_000
  const lon = extremes(bars, lonFrom, lonTo)
  if (lon) {
    add('londonH', lon.high.high, lon.high.t, lonTo, 'high')
    add('londonL', lon.low.low, lon.low.t, lonTo, 'low')
  }
  const dayOpen = openAt(bars, day.from)
  if (dayOpen) add('dayOpen', dayOpen.open, dayOpen.t, dayOpen.t, 'open')
  const mid = openAt(bars, nyWallToMs(date, '00:00'))
  if (mid) add('midnight', mid.open, mid.t, mid.t, 'open')
  const o830 = openAt(bars, nyWallToMs(date, '08:30'))
  if (o830) add('open0830', o830.open, o830.t, o830.t, 'open')
  return out
}

export interface TakenLevel {
  id: LevelId
  label: string
  /** yes = beyond the level by more than the margin, near = within it. */
  touch: 'yes' | 'near'
  /** When price first got beyond (UTC ms). */
  at: number
}

/**
 * Liquidity taken before `entryMs`: highs / lows known before the entry that price went beyond between their
 * forming and the entry (the margin as for other touches: another feed than the broker's).
 */
export function liquidityTakenBefore(levels: readonly MarketLevel[], bars: readonly Bar[], entryMs: number, margin: number): TakenLevel[] {
  const out: TakenLevel[] = []
  for (const l of levels) {
    if (l.side === 'open' || l.knownFrom > entryMs) continue
    let near: number | null = null
    let yes: number | null = null
    for (const b of bars) {
      if (b.t < l.knownFrom || b.t >= entryMs) continue
      const beyond = l.side === 'high' ? b.high - l.price : l.price - b.low
      if (beyond > margin) {
        yes = b.t
        break
      }
      if (beyond > -margin && near == null) near = b.t
    }
    if (yes != null) out.push({ id: l.id, label: l.label, touch: 'yes', at: yes })
    else if (near != null) out.push({ id: l.id, label: l.label, touch: 'near', at: near })
  }
  return out
}

/** Names of the liquidity dictionary a level matches ("PDH", "Asia high"…), case and spaces ignored. */
export function liquidityNameMatches(levelId: LevelId, name: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '')
  return norm(LEVEL_LABELS[levelId]) === norm(name)
}
