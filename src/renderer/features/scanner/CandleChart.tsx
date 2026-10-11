import { useEffect, useRef, useState } from 'react'
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  TickMarkType,
  createChart,
  createSeriesMarkers,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp
} from 'lightweight-charts'
import type { DetectorParams } from '@shared/scanner/detectors/params'
import type { EngineSnapshot } from '@shared/scanner/detectors/types'
import { bucketEnd, bucketStart, nyParts } from '@shared/scanner/time'
import { INTERVAL_SECONDS, type Candle, type Interval, type Range, type SeriesCandle } from '@shared/scanner/types'
import { api } from '../../lib/api'
import { onScannerLive } from '../../store/scanner'
import { EMPTY_LAYERS, buildLayers, countsText, type LayerFlags } from './layers'
import { LayerPrimitive } from './primitives'

const UP = '#2ebd85'
const DOWN = '#f6465d'
const DIM_UP = 'rgba(46,189,133,0.35)'
const DIM_DOWN = 'rgba(246,70,93,0.35)'

/** How far back a chart of each interval loads. */
const LOOKBACK_DAYS: Record<Interval, number> = { M1: 3, M5: 10, M15: 30, H1: 120, H4: 400, D: 1500, W: 1500 }

const MONTHS = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru']

function nyLabel(t: number, withTime: boolean): string {
  const p = nyParts(t)
  const [, m, d] = p.date.split('-')
  const day = `${Number(d)} ${MONTHS[Number(m) - 1]}`
  return withTime ? `${day} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}` : day
}

function toData(c: Candle & { incomplete?: boolean }): CandlestickData<UTCTimestamp> {
  const up = c.c >= c.o
  const dim = (c as SeriesCandle).incomplete
  return {
    time: c.t as UTCTimestamp,
    open: c.o,
    high: c.h,
    low: c.l,
    close: c.c,
    ...(dim ? { color: up ? DIM_UP : DIM_DOWN, wickColor: up ? DIM_UP : DIM_DOWN, borderColor: up ? DIM_UP : DIM_DOWN } : {})
  }
}

function durationText(sec: number): string {
  if (sec >= 86400) return `${Math.round(sec / 86400)} d`
  if (sec >= 3600) return `${Math.round(sec / 3600)} h`
  return `${Math.max(1, Math.round(sec / 60))} min`
}

type Marker = SeriesMarker<Time>

/**
 * Candles of one symbol (New York time axis), gaps marked, the last candle updated live from stream M1 bars, and
 * the ICT layers (engine snapshot → zones, levels, bands and markers) when `snapshot` is given.
 */
export function CandleChart({
  symbol,
  interval,
  decimals,
  dataVersion = '',
  snapshot = null,
  layers,
  params
}: {
  symbol: string
  interval: Interval
  decimals: number
  /** Changes when stored data of the symbol changed (history download, import): the chart reloads. */
  dataVersion?: string
  snapshot?: EngineSnapshot | null
  layers?: LayerFlags
  params?: DetectorParams
}) {
  const ref = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
  const primitiveRef = useRef<LayerPrimitive | null>(null)
  const gapMarkersRef = useRef<Marker[]>([])
  const rangeRef = useRef<{ from: number; to: number } | null>(null)
  const lastRef = useRef<SeriesCandle | null>(null)
  const [info, setInfo] = useState<{ count: number; gaps: number; loading: boolean }>({ count: 0, gaps: 0, loading: true })
  const [loaded, setLoaded] = useState(0)
  const [layerText, setLayerText] = useState('')

  // Chart instance per decimals (price format).
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: '#111418' },
        textColor: '#7a838e',
        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
        fontSize: 11,
        attributionLogo: false
      },
      grid: { vertLines: { color: '#171b20' }, horzLines: { color: '#171b20' } },
      rightPriceScale: { borderColor: '#1e232a' },
      timeScale: {
        borderColor: '#1e232a',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 4,
        tickMarkFormatter: (time: Time, type: TickMarkType) => {
          const t = time as number
          if (type === TickMarkType.Time || type === TickMarkType.TimeWithSeconds) {
            const p = nyParts(t)
            return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`
          }
          if (type === TickMarkType.Year) return nyParts(t).date.slice(0, 4)
          return nyLabel(t, false)
        }
      },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: '#4f5862', labelBackgroundColor: '#2b323b' }, horzLine: { color: '#4f5862', labelBackgroundColor: '#2b323b' } },
      localization: {
        locale: 'pl-PL',
        timeFormatter: (time: Time) => `${nyLabel(time as number, true)} NY`,
        priceFormatter: (p: number) => p.toFixed(decimals)
      }
    })
    const series = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
      borderVisible: false,
      priceFormat: { type: 'price', precision: decimals, minMove: 10 ** -decimals }
    })
    const primitive = new LayerPrimitive()
    series.attachPrimitive(primitive)
    chartRef.current = chart
    seriesRef.current = series
    markersRef.current = createSeriesMarkers(series, [])
    primitiveRef.current = primitive
    return () => {
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
      markersRef.current = null
      primitiveRef.current = null
    }
  }, [decimals])

  // Data per symbol / interval.
  useEffect(() => {
    const series = seriesRef.current
    if (!series) return
    let cancelled = false
    setInfo((i) => ({ ...i, loading: true }))
    const to = Math.floor(Date.now() / 1000) + 60
    const from = to - LOOKBACK_DAYS[interval] * 86400
    void Promise.all([api.scanner.series(symbol, interval, from, to), api.scanner.gaps(symbol, from, to)]).then(([candles, gaps]) => {
      if (cancelled || seriesRef.current !== series) return
      series.setData(candles.map(toData))
      lastRef.current = candles.at(-1) ?? null
      const markers = gapMarkers(candles, gaps)
      gapMarkersRef.current = markers
      markersRef.current?.setMarkers(markers)
      rangeRef.current = candles.length ? { from: candles[0]!.t, to: candles[candles.length - 1]!.end } : null
      setInfo({ count: candles.length, gaps: markers.length, loading: false })
      setLoaded((n) => n + 1)
      chartRef.current?.timeScale().scrollToRealTime()
    })
    return () => {
      cancelled = true
    }
  }, [symbol, interval, decimals, dataVersion])

  // ICT layers: recomputed when the snapshot, the toggles or the loaded candles change.
  useEffect(() => {
    const primitive = primitiveRef.current
    const range = rangeRef.current
    if (!primitive) return
    if (!snapshot || !layers || !params || !range) {
      primitive.setData(EMPTY_LAYERS)
      markersRef.current?.setMarkers(gapMarkersRef.current)
      setLayerText('')
      return
    }
    const built = buildLayers(snapshot, interval, layers, params, range.from, range.to, INTERVAL_SECONDS[interval])
    primitive.setData(built)
    const all: Marker[] = [...gapMarkersRef.current, ...built.markers.map((m) => ({ time: m.time as UTCTimestamp, position: m.position, shape: m.shape, color: m.color, text: m.text || undefined }))]
    all.sort((a, b) => (a.time as number) - (b.time as number))
    markersRef.current?.setMarkers(all)
    setLayerText(countsText(built.counts))
  }, [snapshot, layers, params, interval, loaded])

  // Live updates of the last candle.
  useEffect(() => {
    return onScannerLive((updates) => {
      const series = seriesRef.current
      if (!series) return
      for (const u of updates) {
        if (u.symbol !== symbol) continue
        for (const bar of [...u.closed, ...(u.forming ? [u.forming] : [])]) {
          const start = bucketStart(bar.t, interval)
          const last = lastRef.current
          if (last && start < last.t) continue
          let next: SeriesCandle
          if (last && start === last.t) next = { ...last, h: Math.max(last.h, bar.h), l: Math.min(last.l, bar.l), c: bar.c }
          else next = { t: start, o: bar.o, h: bar.h, l: bar.l, c: bar.c, end: bucketEnd(start, interval) }
          lastRef.current = next
          series.update(toData(next))
        }
      }
    })
  }, [symbol, interval])

  return (
    <div className="relative h-full min-h-[240px]">
      <div ref={ref} className="absolute inset-0" data-testid="scanner-chart" />
      <div className="num pointer-events-none absolute top-1.5 left-2 text-[10.5px] text-dim" data-testid="scanner-chart-info">
        {info.loading ? 'wczytywanie…' : info.count ? `${info.count} świec${info.gaps ? ` · luki: ${info.gaps}` : ''}` : 'brak danych'}
      </div>
      {layerText && (
        <div className="num pointer-events-none absolute top-5 left-2 text-[10.5px] text-dim" data-testid="scanner-layers-info">
          {layerText}
        </div>
      )}
    </div>
  )
}

/** A marker on the first candle after each data gap (time without data inside market hours). */
function gapMarkers(candles: readonly SeriesCandle[], gaps: readonly Range[]): Marker[] {
  const out: Marker[] = []
  let i = 0
  for (const g of gaps) {
    while (i < candles.length && candles[i]!.t < g.to) i++
    const c = candles[i]
    if (!c) break
    if (g.to - g.from < 120) continue
    out.push({ time: c.t as UTCTimestamp, position: 'aboveBar', shape: 'arrowDown', color: '#e8a33d', text: `luka ${durationText(g.to - g.from)}` })
  }
  return out
}
