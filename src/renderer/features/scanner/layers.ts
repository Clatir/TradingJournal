/**
 * Chart layers from an engine snapshot: which objects to draw on a chart of `interval`, in the user's colours
 * (green = bearish zones, burgundy = bullish zones). Pure; the chart only renders what this returns. Objects of
 * higher intervals are drawn with a TradingView-style tag ("60 FVG", "240 OB", "D FVG"), lower intervals never.
 */
import type { EngineSnapshot, PoolKind } from '@shared/scanner/detectors/types'
import { INTERVAL_LABEL, INTERVAL_ORDER } from '@shared/scanner/detectors/types'
import type { DetectorParams } from '@shared/scanner/detectors/params'
import type { Interval } from '@shared/scanner/types'
import { isMarketOpen } from '@shared/scanner/time'
import { windowRange } from '@shared/scanner/windows'

export interface Zone {
  from: number
  to: number | null
  top: number
  bottom: number
  fill: string
  stroke: string
  label: string
  /** Drawn with a dashed border (e.g. invalidated). */
  dashed?: boolean
}

export interface Level {
  from: number
  to: number | null
  price: number
  color: string
  label: string
  dashed?: boolean
  width?: number
}

export interface Band {
  from: number
  to: number
  fill: string
  label: string
}

export interface LayerData {
  zones: Zone[]
  levels: Level[]
  bands: Band[]
  /** First and last loaded candle and the bar length (seconds) for times outside the data. */
  bars: { first: number; last: number; seconds: number } | null
}

export const EMPTY_LAYERS: LayerData = { zones: [], levels: [], bands: [], bars: null }

export const LAYER_IDS = ['fvg', 'blocks', 'pools', 'sweeps', 'structure', 'range', 'opens', 'windows', 'swings'] as const
export type LayerId = (typeof LAYER_IDS)[number]
export type LayerFlags = Record<LayerId, boolean>

export const LAYER_LABELS: Record<LayerId, string> = {
  fvg: 'FVG',
  blocks: 'OB',
  pools: 'pule',
  sweeps: 'sweepy',
  structure: 'MSS / BOS',
  range: 'DR / OTE',
  opens: 'otwarcia',
  windows: 'okna',
  swings: 'swingi'
}

export const DEFAULT_LAYERS: LayerFlags = { fvg: true, blocks: true, pools: true, sweeps: true, structure: true, range: false, opens: true, windows: true, swings: false }

/** Bearish zones green, bullish burgundy (user convention, specification section 2). */
const ZONE = {
  bull: { fill: 'rgba(128, 32, 64, 0.28)', stroke: 'rgba(196, 72, 120, 0.9)' },
  bear: { fill: 'rgba(46, 189, 133, 0.20)', stroke: 'rgba(46, 189, 133, 0.9)' }
}
const BULL = '#c44878'
const BEAR = '#2ebd85'
const MUTED = '#7a838e'
const DIM = '#4f5862'
const ACCENT = '#e8a33d'
const ACCENT_SOFT = 'rgba(232,163,61,0.7)'
const BAND = 'rgba(232, 163, 61, 0.05)'
const BAND_SB = 'rgba(232, 163, 61, 0.09)'

export interface ChartMarker {
  time: number
  position: 'aboveBar' | 'belowBar'
  shape: 'arrowUp' | 'arrowDown' | 'circle' | 'square'
  color: string
  text: string
}

export interface ChartLayers extends LayerData {
  markers: ChartMarker[]
  counts: Partial<Record<LayerId, number>>
}

const POOL_PRIORITY: PoolKind[] = ['PDH', 'PDL', 'PWH', 'PWL', 'PMH', 'PML', 'EQH', 'EQL', 'SESSION_H', 'SESSION_L', 'IPDA_H', 'IPDA_L', 'SWING_H', 'SWING_L']
const OPEN_LABEL = { midnight: 'midnight open', '0830': '08:30 open', week: 'open tyg.' } as const

/**
 * @param from time of the first loaded candle: objects gone before it are skipped
 * @param to end of the last loaded candle: time bands are generated up to it
 */
export function buildLayers(snap: EngineSnapshot, interval: Interval, flags: LayerFlags, params: DetectorParams, from: number, to: number, barSeconds: number): ChartLayers {
  const zones: Zone[] = []
  const levels: Level[] = []
  const bands: Band[] = []
  const markers: ChartMarker[] = []
  const counts: Partial<Record<LayerId, number>> = {}
  const order = INTERVAL_ORDER[interval]
  const tag = (i: Interval) => (i === interval ? '' : `${INTERVAL_LABEL[i]} `)
  // Higher intervals first, so the chart's own objects are drawn on top.
  const shown = (Object.keys(snap.intervals) as Interval[]).filter((i) => INTERVAL_ORDER[i] >= order).sort((a, b) => INTERVAL_ORDER[b] - INTERVAL_ORDER[a])
  const own = snap.intervals[interval]

  if (flags.fvg) {
    let n = 0
    for (const i of shown) {
      for (const f of snap.intervals[i]!.fvgs) {
        const end = f.invertedAt ?? f.filledAt
        if (end !== null && end < from) continue
        n++
        const c = ZONE[f.dir]
        const inverted = f.state === 'inverted'
        zones.push({ from: f.at, to: end, top: f.top, bottom: f.bottom, fill: inverted ? 'rgba(0,0,0,0)' : c.fill, stroke: c.stroke, label: `${tag(i)}FVG${f.state === 'filled' ? ' (wyp.)' : ''}`, dashed: inverted })
      }
    }
    counts.fvg = n
  }

  if (flags.blocks) {
    let n = 0
    for (const i of shown) {
      const objs = snap.intervals[i]!
      for (const b of objs.blocks) {
        const end = b.state === 'invalid' ? (b.flipInvalidatedAt ?? b.invalidatedAt) : null
        if (end !== null && end < from) continue
        n++
        const c = ZONE[b.dir]
        const name = b.kind === 'OB' ? 'OB' : b.kind === 'breaker' ? 'breaker' : 'MB'
        zones.push({ from: b.flippedAt ?? b.at, to: end, top: b.top, bottom: b.bottom, fill: c.fill, stroke: c.stroke, label: `${tag(i)}${name}`, dashed: b.state === 'invalid' })
      }
      for (const b of objs.bprs) {
        if (b.at < from) continue
        n++
        const c = ZONE[b.dir]
        zones.push({ from: b.at, to: null, top: b.top, bottom: b.bottom, fill: 'rgba(0,0,0,0)', stroke: c.stroke, label: `${tag(i)}BPR`, dashed: true })
      }
    }
    counts.blocks = n
  }

  if (flags.pools) {
    let n = 0
    const sorted = [...snap.pools].sort((a, b) => POOL_PRIORITY.indexOf(a.kind) - POOL_PRIORITY.indexOf(b.kind))
    for (const p of sorted) {
      const swing = p.kind === 'SWING_H' || p.kind === 'SWING_L'
      // Swing pools only of this and higher intervals, and only while untouched (taken ones become sweeps).
      if (swing && (INTERVAL_ORDER[p.interval] < order || p.state !== 'untouched')) continue
      if (p.state === 'expired' && (p.kind.startsWith('SESSION') || p.kind.startsWith('IPDA'))) continue
      const end = p.takenAt ?? p.expiredAt
      if (end !== null && end < from) continue
      n++
      const strong = p.rank >= 2
      levels.push({
        from: p.createdAt,
        to: end,
        price: p.price,
        color: p.state === 'untouched' ? (strong ? ACCENT : MUTED) : DIM,
        label: `${p.label}${strong ? ` ×${p.rank}` : ''}`,
        dashed: p.state !== 'untouched',
        width: strong ? 2 : 1
      })
    }
    counts.pools = n
  }

  if (flags.sweeps && own) {
    const labels = new Map(snap.pools.map((p) => [p.id, p.label]))
    let n = 0
    for (const s of own.sweeps) {
      if (s.at < from) continue
      n++
      const bsl = s.side === 'BSL'
      markers.push({ time: s.at, position: bsl ? 'aboveBar' : 'belowBar', shape: bsl ? 'arrowDown' : 'arrowUp', color: ACCENT, text: `sweep ${labels.get(s.poolId) ?? s.poolKind}` })
    }
    counts.sweeps = n
  }

  if (flags.structure && own) {
    let n = 0
    for (const e of own.structure) {
      if (e.at < from) continue
      n++
      const bull = e.dir === 'bull'
      markers.push({ time: e.at, position: bull ? 'belowBar' : 'aboveBar', shape: bull ? 'arrowUp' : 'arrowDown', color: bull ? BULL : BEAR, text: e.kind })
    }
    for (const d of own.displacements) {
      if (d.to < from) continue
      markers.push({ time: d.to, position: d.dir === 'bull' ? 'belowBar' : 'aboveBar', shape: 'square', color: DIM, text: '' })
    }
    counts.structure = n
  }

  if (flags.range && own) {
    const dr = own.dealingRange
    if (dr) {
      const start = Math.min(dr.highAt, dr.lowAt)
      levels.push({ from: start, to: null, price: dr.high, color: DIM, label: 'DR high', dashed: true })
      levels.push({ from: start, to: null, price: dr.low, color: DIM, label: 'DR low', dashed: true })
      levels.push({ from: start, to: null, price: dr.eq, color: DIM, label: `EQ (${dr.zone})`, dashed: true })
    }
    let n = 0
    for (const o of own.otes) {
      if (o.invalidatedAt !== null && o.invalidatedAt < from) continue
      n++
      zones.push({ from: o.createdAt, to: o.invalidatedAt, top: Math.max(o.l62, o.l79), bottom: Math.min(o.l62, o.l79), fill: 'rgba(232,163,61,0.10)', stroke: ACCENT_SOFT, label: 'OTE 62–79', dashed: o.state === 'invalid' })
      levels.push({ from: o.createdAt, to: o.invalidatedAt, price: o.l705, color: ACCENT_SOFT, label: '70.5', dashed: true })
    }
    counts.range = n
  }

  if (flags.opens) {
    let n = 0
    for (const o of snap.opens) {
      if (o.expiredAt !== null && o.expiredAt < from) continue
      n++
      levels.push({ from: o.at, to: o.expiredAt, price: o.price, color: o.expiredAt === null ? ACCENT : DIM, label: OPEN_LABEL[o.kind], dashed: true })
    }
    for (const g of snap.gaps) {
      if (g.expiredAt !== null && g.expiredAt < from) continue
      n++
      zones.push({ from: g.at, to: g.expiredAt, top: g.top, bottom: g.bottom, fill: 'rgba(122,131,142,0.12)', stroke: 'rgba(122,131,142,0.7)', label: g.kind })
    }
    counts.opens = n
  }

  if (flags.windows && order <= INTERVAL_ORDER.H1) {
    const all = [...params.windows.map((w) => ({ w, fill: BAND })), ...params.silverBullet.map((w) => ({ w, fill: BAND_SB }))]
    for (const { w, fill } of all) {
      let t = from
      for (let guard = 0; guard < 400 && t < to; guard++) {
        const r = windowRange(t, w)
        if (r.from >= to) break
        // Weekend occurrences have no candles under them.
        if (r.to > from && isMarketOpen(r.from)) bands.push({ from: Math.max(r.from, from), to: Math.min(r.to, to), fill, label: w.label || w.id })
        t = r.to + 60
      }
    }
    counts.windows = bands.length
  }

  if (flags.swings && own) {
    let n = 0
    for (const s of own.swings) {
      if (s.at < from) continue
      n++
      markers.push({ time: s.at, position: s.kind === 'high' ? 'aboveBar' : 'belowBar', shape: 'circle', color: s.cls === 'LT' ? ACCENT : s.cls === 'IT' ? MUTED : DIM, text: s.cls === 'ST' ? '' : s.cls })
    }
    counts.swings = n
  }

  return { zones, levels, bands, markers, counts, bars: { first: from, last: to - barSeconds, seconds: barSeconds } }
}

/** Short text for the chart corner: "FVG 12 · OB 3 · pule 9". */
export function countsText(counts: Partial<Record<LayerId, number>>): string {
  return LAYER_IDS.filter((id) => counts[id] !== undefined)
    .map((id) => `${LAYER_LABELS[id]} ${counts[id]}`)
    .join(' · ')
}
