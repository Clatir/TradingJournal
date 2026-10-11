import { describe, expect, it } from 'vitest'
import { DateTime } from 'luxon'
import { defaultDetectorParams } from '@shared/scanner/detectors/params'
import { analyzeSeries } from '@shared/scanner/engine'
import { aggregate } from '@shared/scanner/aggregate'
import { isMarketOpen } from '@shared/scanner/time'
import type { Candle, Interval, SeriesCandle } from '@shared/scanner/types'
import { INTERVAL_SECONDS } from '@shared/scanner/types'
import { DEFAULT_LAYERS, LAYER_IDS, buildLayers, countsText, type LayerFlags } from '@renderer/features/scanner/layers'

const PIP = 0.0001
const ny = (s: string): number => DateTime.fromISO(s, { zone: 'America/New_York' }).toSeconds()
const PARAMS = defaultDetectorParams()
const ALL: LayerFlags = Object.fromEntries(LAYER_IDS.map((id) => [id, true])) as LayerFlags

/** M1 bars of two weeks (Sun 04 17:00 → Thu 15 Oct 2026 12:00 NY), a slow wave with an impulsive leg on 13 Oct. */
function m1(): Candle[] {
  const out: Candle[] = []
  let p = 1.1
  for (let t = ny('2026-10-04T17:00'); t < ny('2026-10-15T12:00'); t += 60) {
    if (!isMarketOpen(t)) continue
    const o = p
    const impulse = t >= ny('2026-10-13T08:00') && t < ny('2026-10-13T08:30') ? 2.5 * PIP : 0
    p = o + Math.sin(t / 3600) * 0.4 * PIP + impulse
    out.push({ t, o, h: Math.max(o, p) + 0.2 * PIP, l: Math.min(o, p) - 0.2 * PIP, c: p })
  }
  return out
}

function series(): Partial<Record<Interval, SeriesCandle[]>> {
  const bars = m1()
  return { M15: aggregate(bars, 'M15'), H1: aggregate(bars, 'H1'), H4: aggregate(bars, 'H4'), D: aggregate(bars, 'D') }
}

describe('chart layers', () => {
  const s = series()
  const snap = analyzeSeries(s, PIP, PARAMS)
  const m15 = s.M15!
  const from = m15[0]!.t
  const to = m15[m15.length - 1]!.end

  it('draws pools of the daily levels and the sessions with their labels', () => {
    const l = buildLayers(snap, 'M15', ALL, PARAMS, from, to, INTERVAL_SECONDS.M15)
    const labels = l.levels.map((x) => x.label)
    expect(labels).toContain('PDH')
    expect(labels).toContain('PDL')
    expect(labels.some((x) => x.startsWith('Asia H'))).toBe(true)
    expect(labels.some((x) => x.startsWith('London L'))).toBe(true)
    // PWH sits on the IPDA 20-day high as well → rank 2 → "PWH ×2".
    expect(labels.some((x) => x.startsWith('PWH'))).toBe(true)
    const only = buildLayers(snap, 'M15', { ...DEFAULT_LAYERS, fvg: false, blocks: false, sweeps: false, structure: false, opens: false, windows: false }, PARAMS, from, to, 900)
    expect(only.counts.pools).toBe(only.levels.length)
    expect(only.zones).toEqual([])
    expect(l.bars).toEqual({ first: from, last: to - 900, seconds: 900 })
  })

  it('tags higher-interval objects TradingView style and never shows lower ones', () => {
    const m15Layers = buildLayers(snap, 'M15', ALL, PARAMS, from, to, 900)
    const h1 = s.H1!
    const h1Layers = buildLayers(snap, 'H1', ALL, PARAMS, h1[0]!.t, h1[h1.length - 1]!.end, 3600)
    const h4Layers = buildLayers(snap, 'H4', ALL, PARAMS, from, to, 14400)
    const fvgLabels = (l: typeof m15Layers) => l.zones.filter((z) => z.label.includes('FVG')).map((z) => z.label)
    // The impulse made at least one M15 FVG and the H1 one is tagged "60 FVG" on the M15 chart.
    expect(fvgLabels(m15Layers)).toContain('FVG')
    expect(fvgLabels(m15Layers).some((x) => x.startsWith('60 '))).toBe(true)
    expect(fvgLabels(h1Layers).every((x) => !x.startsWith('15 '))).toBe(true)
    expect(fvgLabels(h4Layers).every((x) => !x.startsWith('15 ') && !x.startsWith('60 '))).toBe(true)
    expect(m15Layers.counts.fvg!).toBeGreaterThan(h1Layers.counts.fvg!)
  })

  it('bull zones are burgundy and bear zones green (user convention)', () => {
    const l = buildLayers(snap, 'M15', ALL, PARAMS, from, to, 900)
    const bull = l.zones.find((z) => z.label === 'FVG' && z.stroke.includes('196, 72, 120'))
    expect(bull).toBeDefined()
    const bear = l.zones.find((z) => z.label.includes('FVG') && z.stroke.includes('46, 189, 133'))
    expect(bear).toBeDefined()
  })

  it('killzone bands cover every trading day on M15 and H1, never on H4 and above', () => {
    const l = buildLayers(snap, 'M15', ALL, PARAMS, from, to, 900)
    const days = new Set(l.bands.map((b) => DateTime.fromSeconds(b.from, { zone: 'America/New_York' }).toISODate()))
    expect(days.size).toBe(9) // 05–09 and 12–15 Oct, nothing on the weekend
    expect(l.bands.filter((b) => b.label === 'London KZ')).toHaveLength(9)
    expect(l.bands.filter((b) => b.label === 'SB')).toHaveLength(9)
    expect(l.bands.filter((b) => b.label === 'NY KZ')).toHaveLength(9)
    expect(l.bands.every((b) => b.from >= from && b.to <= to && b.to > b.from)).toBe(true)
    expect(buildLayers(snap, 'H4', ALL, PARAMS, from, to, 14400).bands).toEqual([])
  })

  it('opens: midnight and 08:30 of every day, the week open, with the expired ones ending', () => {
    const l = buildLayers(snap, 'M15', ALL, PARAMS, from, to, 900)
    const opens = l.levels.filter((x) => x.label.includes('open'))
    expect(opens.filter((x) => x.label === 'midnight open')).toHaveLength(9)
    expect(opens.filter((x) => x.label === '08:30 open')).toHaveLength(9)
    expect(opens.filter((x) => x.label === 'open tyg.')).toHaveLength(2)
    expect(opens.filter((x) => x.to === null)).toHaveLength(3)
  })

  it('toggles: a layer that is off adds nothing and is not counted', () => {
    const l = buildLayers(snap, 'M15', { ...DEFAULT_LAYERS, fvg: false, windows: false, pools: false, opens: false }, PARAMS, from, to, 900)
    expect(l.zones.filter((z) => z.label.includes('FVG'))).toEqual([])
    expect(l.bands).toEqual([])
    expect(l.counts.fvg).toBeUndefined()
    expect(l.counts.windows).toBeUndefined()
    expect(countsText(l.counts)).toMatch(/^OB \d+ · sweepy \d+ · MSS \/ BOS \d+$/)
  })

  it('objects gone before the loaded range are skipped, the rest keep their end', () => {
    const late = ny('2026-10-14T00:00')
    const full = buildLayers(snap, 'M15', ALL, PARAMS, from, to, 900)
    const part = buildLayers(snap, 'M15', ALL, PARAMS, late, to, 900)
    expect(part.levels.length).toBeLessThan(full.levels.length)
    expect(part.levels.every((x) => x.to === null || x.to >= late)).toBe(true)
    expect(part.zones.every((z) => z.to === null || z.to >= late)).toBe(true)
  })

  it('markers: sweeps and structure of the chart interval only', () => {
    const l = buildLayers(snap, 'H1', ALL, PARAMS, from, to, 3600)
    const own = snap.intervals.H1!
    expect(l.markers.filter((m) => m.text.startsWith('sweep'))).toHaveLength(own.sweeps.length)
    expect(l.markers.filter((m) => m.text === 'MSS' || m.text === 'BOS')).toHaveLength(own.structure.length)
    expect(l.counts.structure).toBe(own.structure.length)
    for (const m of l.markers) expect(own.swings.some((s) => s.at === m.time) || own.sweeps.some((s) => s.at === m.time) || own.structure.some((s) => s.at === m.time) || own.displacements.some((d) => d.to === m.time)).toBe(true)
  })
})
