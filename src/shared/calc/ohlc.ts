/**
 * Import of OHLC data exported from TradingView ("Export chart data…" → CSV) for the weekly review:
 * which day made the high / low of the week and at what New York time each daily high / low formed.
 */
import { DateTime } from 'luxon'
import { WEEKDAYS, type Weekday, type WeekPair } from '../schema/week'
import { isoWeekOf } from './time'

export interface Bar {
  /** Bar open time, UTC milliseconds. */
  t: number
  open: number
  high: number
  low: number
  close: number
}

export interface ParsedOhlc {
  bars: Bar[]
  skipped: number
}

function splitLine(line: string, sep: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"'
        i++
      } else quoted = !quoted
    } else if (ch === sep && !quoted) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

function parseTime(raw: string): number | null {
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const n = Number(raw)
    return n > 1e12 ? n : n * 1000
  }
  const t = Date.parse(raw)
  return Number.isFinite(t) ? t : null
}

/** Parse a TradingView CSV (comma or semicolon separated; time as UNIX seconds or ISO with offset). */
export function parseTradingViewCsv(text: string): ParsedOhlc {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim())
  if (lines.length < 2) throw new Error('Plik CSV jest pusty.')
  const headerLine = lines[0] as string
  const sep = headerLine.includes(';') && !headerLine.includes(',') ? ';' : ','
  const header = splitLine(headerLine, sep).map((h) => h.toLowerCase())
  const col = (name: string) => header.findIndex((h) => h === name || h.startsWith(`${name} `))
  const idx = { time: col('time'), open: col('open'), high: col('high'), low: col('low'), close: col('close') }
  if (Object.values(idx).some((i) => i < 0)) throw new Error('Brak kolumn time, open, high, low, close – użyj „Export chart data” z TradingView.')
  const bars: Bar[] = []
  let skipped = 0
  for (const line of lines.slice(1)) {
    const cells = splitLine(line, sep)
    const num = (i: number) => Number((cells[i] ?? '').replace(',', '.'))
    const t = parseTime(cells[idx.time] ?? '')
    const bar = { t: t ?? NaN, open: num(idx.open), high: num(idx.high), low: num(idx.low), close: num(idx.close) }
    if (t == null || ![bar.open, bar.high, bar.low, bar.close].every(Number.isFinite)) {
      skipped++
      continue
    }
    bars.push(bar)
  }
  bars.sort((a, b) => a.t - b.t)
  return { bars, skipped }
}

export interface WeekExtremes {
  week: string
  days: WeekPair['days']
  weekHighDay: Weekday | null
  weekLowDay: Weekday | null
  barCount: number
}

/** Daily high/low (NY calendar days Mon–Fri) and their NY times for one ISO week. */
export function weekExtremes(bars: readonly Bar[], week: string): WeekExtremes {
  const perDay = new Map<Weekday, { high: number; highT: number; low: number; lowT: number }>()
  let count = 0
  for (const b of bars) {
    const ny = DateTime.fromMillis(b.t, { zone: 'America/New_York' })
    if (ny.weekday > 5) continue
    if (isoWeekOf(ny.toISODate() as string) !== week) continue
    count++
    const day = WEEKDAYS[ny.weekday - 1] as Weekday
    const cur = perDay.get(day)
    if (!cur) perDay.set(day, { high: b.high, highT: b.t, low: b.low, lowT: b.t })
    else {
      if (b.high > cur.high) {
        cur.high = b.high
        cur.highT = b.t
      }
      if (b.low < cur.low) {
        cur.low = b.low
        cur.lowT = b.t
      }
    }
  }
  const nyClock = (t: number) => DateTime.fromMillis(t, { zone: 'America/New_York' }).toFormat('HH:mm')
  const days = WEEKDAYS.map((day) => {
    const d = perDay.get(day)
    return d
      ? { day, high: d.high, low: d.low, highTimeNy: nyClock(d.highT), lowTimeNy: nyClock(d.lowT) }
      : { day, high: null, low: null, highTimeNy: null, lowTimeNy: null }
  })
  let weekHighDay: Weekday | null = null
  let weekLowDay: Weekday | null = null
  for (const [day, d] of perDay) {
    if (weekHighDay == null || d.high > (perDay.get(weekHighDay)?.high ?? -Infinity)) weekHighDay = day
    if (weekLowDay == null || d.low < (perDay.get(weekLowDay)?.low ?? Infinity)) weekLowDay = day
  }
  return { week, days, weekHighDay, weekLowDay, barCount: count }
}

/** ISO weeks present in the data (NY dates), newest first. */
export function weeksInBars(bars: readonly Bar[]): string[] {
  const set = new Set<string>()
  for (const b of bars) {
    const ny = DateTime.fromMillis(b.t, { zone: 'America/New_York' })
    if (ny.weekday <= 5) set.add(isoWeekOf(ny.toISODate() as string))
  }
  return [...set].sort().reverse()
}
