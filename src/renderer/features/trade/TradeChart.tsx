import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  CrosshairMode,
  LineStyle,
  TickMarkType,
  type IChartApi,
  type IPriceLine,
  type IPrimitivePaneRenderer,
  type IPrimitivePaneView,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type ISeriesPrimitive,
  type Logical,
  type SeriesAttachedParameter,
  type SeriesMarker,
  type Time,
  type UTCTimestamp
} from 'lightweight-charts'
import { DateTime } from 'luxon'
import { tradeLevels } from '@shared/calc/excursions'
import { sessionSpans } from '@shared/calc/sessionSpans'
import { ZONE_NY } from '@shared/calc/time'
import { resampleBars, type Bar, type MarketBarsResult } from '@shared/market'
import type { Settings, Trade, TradeMarket } from '@shared/schema'
import { api, errorMessage } from '../../lib/api'
import { marketBars, marketOnline, marketSummary, tradeTicker, useMarket } from '../../store/market'
import { navigate, toast } from '../../store/ui'
import { Segmented } from '../../components/ui'

const UP = '#2ebd85'
const DOWN = '#f6465d'
const ACCENT = '#e8a33d'
const MIN = 60_000
type Interval = '1' | '5' | '15' | '60'
const INTERVALS: Array<{ value: Interval; label: string }> = [
  { value: '1', label: 'M1' },
  { value: '5', label: 'M5' },
  { value: '15', label: 'M15' },
  { value: '60', label: 'H1' }
]

/** The chart's time window: before the entry, the trade, after the exit (open trade: until now). */
export function chartWindow(t: Trade, settings: Settings, nowMs: number): { fromMs: number; toMs: number } | null {
  const entry = Date.parse(t.entryTime)
  if (!Number.isFinite(entry)) return null
  const lv = tradeLevels(t)
  const lastExit = t.exits.map((x) => x.time).filter((x): x is string => !!x).sort().at(-1)
  const end = t.status === 'closed' ? Date.parse(lv.exitTime ?? lastExit ?? t.entryTime) : t.status === 'missed' ? entry + 4 * 3_600_000 : nowMs
  const from = Math.floor((entry - settings.market.chartBeforeMinutes * MIN) / MIN) * MIN
  const to = Math.min(nowMs, Math.ceil((Math.max(end, entry) + settings.market.chartAfterMinutes * MIN + MIN) / MIN) * MIN)
  return to > from ? { fromMs: from, toMs: to } : null
}

type DrawTarget = Parameters<IPrimitivePaneRenderer['draw']>[0]

/** Session background (killzones) behind the candles: spans snapped to the bars on the chart. */
class SessionBands implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null
  private request: (() => void) | null = null
  private bands: Array<{ from: UTCTimestamp; to: UTCTimestamp; color: string }> = []
  private readonly view: IPrimitivePaneView = { zOrder: () => 'bottom', renderer: () => this.renderer }
  private readonly renderer: IPrimitivePaneRenderer = { draw: () => undefined, drawBackground: (target) => this.paint(target) }

  attached(p: SeriesAttachedParameter<Time>): void {
    this.chart = p.chart as IChartApi
    this.request = p.requestUpdate
  }
  detached(): void {
    this.chart = null
    this.request = null
  }
  paneViews(): readonly IPrimitivePaneView[] {
    return [this.view]
  }
  set(bands: Array<{ from: UTCTimestamp; to: UTCTimestamp; color: string }>): void {
    this.bands = bands
    this.request?.()
  }
  private paint(target: DrawTarget): void {
    const ts = this.chart?.timeScale()
    if (!ts) return
    const step = Math.abs((ts.logicalToCoordinate(1 as Logical) ?? 0) - (ts.logicalToCoordinate(0 as Logical) ?? 0))
    target.useBitmapCoordinateSpace(({ context, horizontalPixelRatio: hr, bitmapSize }) => {
      for (const b of this.bands) {
        const x1 = ts.timeToCoordinate(b.from)
        const x2 = ts.timeToCoordinate(b.to)
        if (x1 == null || x2 == null) continue
        context.fillStyle = b.color
        context.fillRect(Math.round((x1 - step / 2) * hr), 0, Math.max(1, Math.round((x2 - x1 + step) * hr)), bitmapSize.height)
      }
    })
  }
}

const NO_BARS: Bar[] = []
const nyTime = (sec: number, fmt: string) => DateTime.fromSeconds(sec, { zone: ZONE_NY }).toFormat(fmt)
const touchText = (v: TradeMarket['reached1R']) => (v === 'yes' ? 'tak' : v === 'near' ? 'niepewne' : v === 'no' ? 'nie' : '—')

/** Editor panel: the trade on market bars (EODHD), with levels, entry, exits, MAE / MFE and killzones. */
export function TradeChart({ trade, settings }: { trade: Trade; settings: Settings }) {
  const status = useMarket((s) => s.status)
  const ticker = tradeTicker(trade, settings)
  const [interval, setInterval] = useState<Interval>(settings.market.chartInterval)
  // "Now" for open trades, fixed per opening of the editor (no refetch on every render).
  const [now] = useState(() => Math.floor(Date.now() / (5 * MIN)) * 5 * MIN)
  const win = chartWindow(trade, settings, now)
  const [res, setRes] = useState<MarketBarsResult | null>(null)
  const [loading, setLoading] = useState(false)
  const online = marketOnline(status)

  useEffect(() => {
    if (!ticker || !win) return
    let alive = true
    setLoading(true)
    void marketBars(ticker, win.fromMs, win.toMs).then((r) => {
      if (!alive) return
      setRes(r)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [ticker, win?.fromMs, win?.toMs, online])

  const m1 = res?.bars ?? NO_BARS
  const bars = useMemo(() => resampleBars(m1, Number(interval)), [m1, interval])
  const summary = useMemo(() => (ticker && trade.status === 'closed' && m1.length ? marketSummary(trade, m1, settings, ticker) : null), [trade, m1, settings, ticker])

  if (!ticker)
    return (
      <div className="text-[12px] text-muted">
        Para {trade.pair} nie ma symbolu w danych rynkowych.{' '}
        <button className="underline hover:text-fg-strong" onClick={() => navigate({ page: 'settings', tab: 'market' })}>
          Ustawienia → Dane rynkowe
        </button>
      </div>
    )
  if (!win) return <div className="text-[12px] text-muted">Brak czasu wejścia.</div>
  const empty = !loading && res && !bars.length
  return (
    <div className="flex flex-col gap-1.5" data-testid="trade-chart">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented size="sm" value={interval} onChange={setInterval} options={INTERVALS} aria-label="Interwał wykresu" />
        <span className="num text-[11px] text-muted">{ticker} · czas NY</span>
        {loading && <span className="text-[11px] text-muted">wczytuję…</span>}
        <CopyChartButton disabled={!bars.length} />
      </div>
      {empty ? (
        <div className="flex h-[120px] items-center justify-center border border-line text-center text-[12px] text-muted" data-testid="trade-chart-empty">
          {res && !res.ok
            ? `Nie udało się pobrać świec: ${res.message}.`
            : online
              ? 'Brak świec z tego czasu w danych rynkowych.'
              : 'Brak pobranych świec z tego czasu – wpisz klucz EODHD w Ustawienia → Dane rynkowe (albo pobierz je na drugim komputerze).'}
        </div>
      ) : (
        <ChartCanvas trade={trade} settings={settings} bars={bars} interval={Number(interval)} summary={summary} />
      )}
      {summary && summary.maePips != null && (
        <div className="num flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-muted" data-testid="trade-chart-summary">
          <span>
            MAE <span className="text-down">{summary.maePips.toFixed(1)}</span>
            {summary.maeR != null ? ` (${summary.maeR.toFixed(2)}R)` : ''}
            {summary.maeMinutes != null ? ` po ${summary.maeMinutes} min` : ''}
          </span>
          <span>
            MFE <span className="text-up">{summary.mfePips!.toFixed(1)}</span>
            {summary.mfeR != null ? ` (${summary.mfeR.toFixed(2)}R)` : ''}
            {summary.mfeMinutes != null ? ` po ${summary.mfeMinutes} min` : ''}
          </span>
          <span>1R: {touchText(summary.reached1R)}</span>
          <span>2R: {touchText(summary.reached2R)}</span>
          {trade.prices.takeProfit1 != null && <span>TP1: {touchText(summary.reachedTp1)}</span>}
          {trade.prices.takeProfit2 != null && <span>TP2: {touchText(summary.reachedTp2)}</span>}
          <span title="Dotknięcie poziomu SL według cen EODHD (inne źródło niż broker; „niepewne” = w marginesie)">SL dotknięty: {touchText(summary.stopTouched)}</span>
        </div>
      )}
      {summary?.warnings.map((w) => (
        <div key={w} className="text-[11px] text-accent">
          {w}
        </div>
      ))}
    </div>
  )
}

let lastChart: IChartApi | null = null

function CopyChartButton({ disabled }: { disabled: boolean }) {
  const copy = async () => {
    try {
      const canvas = lastChart?.takeScreenshot()
      if (!canvas) return
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
      if (!blob) throw new Error('Nie udało się utworzyć obrazu.')
      await api.copyImage(new Uint8Array(await blob.arrayBuffer()))
      toast('Wykres skopiowany do schowka.', 'success')
    } catch (e) {
      toast(`Nie udało się skopiować wykresu: ${errorMessage(e)}`, 'error')
    }
  }
  return (
    <button className="btn ml-auto h-[22px] px-1.5 text-[11px]" disabled={disabled} onClick={() => void copy()} data-testid="trade-chart-copy">
      Kopiuj jako obraz
    </button>
  )
}

function ChartCanvas({ trade, settings, bars, interval, summary }: { trade: Trade; settings: Settings; bars: Bar[]; interval: number; summary: TradeMarket | null }) {
  const ref = useRef<HTMLDivElement>(null)
  const chart = useRef<{ chart: IChartApi; series: ISeriesApi<'Candlestick'>; markers: ISeriesMarkersPluginApi<Time>; bands: SessionBands; lines: IPriceLine[] } | null>(null)
  const pair = settings.pairs.find((p) => p.symbol === trade.pair)
  const decimals = pair?.priceDecimals ?? 5

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const c = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: '#111418' }, textColor: '#7a838e', fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: '#171b20' }, horzLines: { color: '#171b20' } },
      rightPriceScale: { borderColor: '#1e232a' },
      timeScale: {
        borderColor: '#1e232a',
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (time: Time, type: TickMarkType) => nyTime(time as number, type <= TickMarkType.DayOfMonth ? 'dd.MM' : 'HH:mm')
      },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: '#4f5862', labelBackgroundColor: '#2b323b' }, horzLine: { color: '#4f5862', labelBackgroundColor: '#2b323b' } },
      localization: { locale: 'pl-PL', timeFormatter: (time: Time) => nyTime(time as number, 'yyyy-MM-dd HH:mm') }
    })
    const series = c.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      borderVisible: false,
      wickUpColor: UP,
      wickDownColor: DOWN,
      priceLineVisible: false,
      // The last price's label would look like a level of the trade.
      lastValueVisible: false,
      priceFormat: { type: 'price', precision: decimals, minMove: 10 ** -decimals }
    })
    const bands = new SessionBands()
    series.attachPrimitive(bands)
    chart.current = { chart: c, series, markers: createSeriesMarkers(series, []), bands, lines: [] }
    lastChart = c
    return () => {
      c.remove()
      if (lastChart === c) lastChart = null
      chart.current = null
    }
  }, [decimals])

  // Bars and sessions: fit the view only when they change (not on every price edit).
  useEffect(() => {
    const h = chart.current
    if (!h) return
    h.series.setData(bars.map((b) => ({ time: (b.t / 1000) as UTCTimestamp, open: b.open, high: b.high, low: b.low, close: b.close })))
    const times = bars.map((b) => b.t)
    const snapFrom = (ms: number) => times.find((t) => t >= ms)
    const snapTo = (ms: number) => [...times].reverse().find((t) => t < ms)
    const spans = bars.length ? sessionSpans(bars[0]!.t, bars[bars.length - 1]!.t + interval * MIN, settings.killzones) : []
    h.bands.set(
      spans.flatMap((s) => {
        const a = snapFrom(s.from)
        const b = snapTo(s.to)
        return a != null && b != null && b >= a
          ? [{ from: (a / 1000) as UTCTimestamp, to: (b / 1000) as UTCTimestamp, color: s.kind === 'silverBullet' ? 'rgba(120,140,255,0.07)' : 'rgba(232,163,61,0.06)' }]
          : []
      })
    )
    h.chart.timeScale().fitContent()
  }, [bars, interval, settings.killzones])

  // Levels and markers follow the trade's prices and exits.
  useEffect(() => {
    const h = chart.current
    if (!h) return
    for (const l of h.lines) h.series.removePriceLine(l)
    const line = (price: number | null, color: string, title: string, style: LineStyle) =>
      price == null ? null : h.series.createPriceLine({ price, color, title, lineStyle: style, lineWidth: 1, axisLabelVisible: true })
    h.lines = [
      line(trade.prices.entry, ACCENT, 'Wejście', LineStyle.Solid),
      line(trade.prices.stopLoss, DOWN, 'SL', LineStyle.Dashed),
      line(trade.prices.takeProfit1, UP, 'TP1', LineStyle.Dashed),
      line(trade.prices.takeProfit2, UP, 'TP2', LineStyle.Dotted)
    ].filter((l): l is IPriceLine => !!l)
    const step = interval * MIN
    const first = bars[0]?.t ?? 0
    const last = bars[bars.length - 1]?.t ?? 0
    const at = (iso: string | null) => {
      const ms = iso ? Date.parse(iso) : NaN
      if (!Number.isFinite(ms) || ms < first || ms >= last + step) return null
      return (Math.floor(ms / step) * step) / 1000
    }
    const long = trade.direction === 'long'
    const markers: SeriesMarker<Time>[] = []
    const entryAt = at(trade.entryTime)
    if (entryAt != null)
      markers.push({ time: entryAt as UTCTimestamp, position: long ? 'belowBar' : 'aboveBar', shape: long ? 'arrowUp' : 'arrowDown', color: ACCENT, text: 'wejście' })
    for (const x of trade.exits) {
      const t = at(x.time)
      if (t == null || x.price == null || trade.prices.entry == null) continue
      const win = (x.price - trade.prices.entry) * (long ? 1 : -1) >= 0
      markers.push({ time: t as UTCTimestamp, position: long ? 'aboveBar' : 'belowBar', shape: long ? 'arrowDown' : 'arrowUp', color: win ? UP : DOWN, text: x.percent < 100 ? `wyjście ${x.percent}%` : 'wyjście' })
    }
    if (summary?.maePips != null && summary.maeAt) {
      const t = at(summary.maeAt)
      if (t != null) markers.push({ time: t as UTCTimestamp, position: long ? 'belowBar' : 'aboveBar', shape: 'circle', color: DOWN, text: `MAE ${summary.maePips.toFixed(1)}` })
    }
    if (summary?.mfePips != null && summary.mfeAt) {
      const t = at(summary.mfeAt)
      if (t != null) markers.push({ time: t as UTCTimestamp, position: long ? 'aboveBar' : 'belowBar', shape: 'circle', color: UP, text: `MFE ${summary.mfePips.toFixed(1)}` })
    }
    h.markers.setMarkers(markers.sort((a, b) => (a.time as number) - (b.time as number)))
  }, [trade.prices, trade.exits, trade.entryTime, trade.direction, summary, bars, interval])

  return <div ref={ref} className="h-[300px] w-full" data-testid="trade-chart-canvas" />
}
