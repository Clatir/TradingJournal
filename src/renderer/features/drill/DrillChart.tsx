import { useEffect, useMemo, useRef, useState } from 'react'
import { LineStyle, type IPriceLine, type Logical, type SeriesMarker, type Time, type UTCTimestamp } from 'lightweight-charts'
import { DateTime } from 'luxon'
import { drillReplayWindow } from '@shared/calc/drills'
import { dayLevels, levelSessions, sessionDateOf } from '@shared/calc/marketLevels'
import { ZONE_NY } from '@shared/calc/time'
import { resampleBars, type Bar } from '@shared/market'
import type { Settings, Trade } from '@shared/schema'
import { marketBars, tradeTicker } from '../../store/market'
import { Segmented } from '../../components/ui'
import { ACCENT, DOWN, INTERVALS, UP, createMarketChart, levelPriceLine, setChartBars, type Interval, type MarketChartHandle } from '../trade/TradeChart'

const MIN = 60_000
/** Candles before the entry kept on the chart per interval (older fetched bars only make the levels). */
const CONTEXT_MIN: Record<Interval, number> = { '1': 8 * 60, '5': 3 * 1440, '15': 6 * 1440, '60': 14 * 1440 }
/** Candles in view before the entry. */
const VIEW_BEFORE = 100
/** The replay takes about this many steps whatever its length (≈ 4 s). */
const REPLAY_STEPS = 100
const TICK_MS = 40
const NO_BARS: Bar[] = []
const nyClock = (ms: number) => DateTime.fromMillis(ms, { zone: ZONE_NY }).toFormat('HH:mm')

/**
 * A drill card on market bars: the candles up to the entry's minute (the future hidden), the levels of the day known
 * by then, a click picks the SL guess; after the answer the rest of the trading day is replayed with the trade's
 * levels, entry and exits.
 */
export function DrillChart({
  trade,
  settings,
  revealed,
  slPrice,
  onPick
}: {
  trade: Trade
  settings: Settings
  revealed: boolean
  /** The SL guess as a price (drawn as a line). */
  slPrice: number | null
  onPick: (price: number) => void
}) {
  const ticker = tradeTicker(trade, settings)
  const win = useMemo(() => drillReplayWindow(trade), [trade])
  const [interval, setInterval_] = useState<Interval>(settings.market.chartInterval)
  const [m1, setM1] = useState<Bar[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [until, setUntil] = useState(() => (win ? (revealed ? win.toMs : win.entryMs) : 0))
  const [playing, setPlaying] = useState(false)
  const wasRevealed = useRef(revealed)

  useEffect(() => {
    if (!ticker || !win) return
    let alive = true
    setM1(null)
    setError(null)
    void marketBars(ticker, win.fromMs, win.toMs).then((r) => {
      if (!alive) return
      if (!r.ok) setError(r.message)
      setM1(r.bars)
    })
    return () => {
      alive = false
    }
  }, [ticker, win?.fromMs, win?.toMs])

  // The answer starts the replay from the entry.
  useEffect(() => {
    if (!win) return
    if (revealed && !wasRevealed.current) {
      setUntil(win.entryMs)
      setPlaying(true)
    }
    if (!revealed) {
      setUntil(win.entryMs)
      setPlaying(false)
    }
    wasRevealed.current = revealed
  }, [revealed, win])

  useEffect(() => {
    if (!playing || !win) return
    const step = Math.max(MIN, Math.ceil((win.toMs - win.entryMs) / REPLAY_STEPS / MIN) * MIN)
    const id = window.setInterval(() => setUntil((u) => Math.min(win.toMs, u + step)), TICK_MS)
    return () => window.clearInterval(id)
  }, [playing, win])
  useEffect(() => {
    if (win && until >= win.toMs) setPlaying(false)
  }, [until, win])

  const all = m1 ?? NO_BARS
  const entryMs = win?.entryMs ?? 0
  const contextFrom = entryMs - CONTEXT_MIN[interval] * MIN
  const levels = useMemo(
    () => (all.length && win ? dayLevels(sessionDateOf(trade.entryTime), all, levelSessions(settings.market.asia, settings.killzones)).filter((l) => l.knownFrom <= win.entryMs) : []),
    [all, win, trade.entryTime, settings.market.asia, settings.killzones]
  )
  const step = Number(interval)
  const counts = useMemo(() => {
    const inView = all.filter((b) => b.t >= contextFrom)
    return { entry: resampleBars(inView.filter((b) => b.t < entryMs), step).length, end: resampleBars(inView, step).length }
  }, [all, contextFrom, entryMs, step])
  const shown = useMemo(() => resampleBars(all.filter((b) => b.t >= contextFrom && b.t < until), step), [all, contextFrom, until, step])

  const ref = useRef<HTMLDivElement>(null)
  const chart = useRef<MarketChartHandle | null>(null)
  // Bumped when the chart is (re)created, so the data effects draw on the new one.
  const [gen, setGen] = useState(0)
  const props = useRef({ revealed, onPick })
  props.current = { revealed, onPick }
  const pair = settings.pairs.find((p) => p.symbol === trade.pair)
  const decimals = pair?.priceDecimals ?? 5

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const h = createMarketChart(el, decimals)
    h.chart.applyOptions({ timeScale: { shiftVisibleRangeOnNewBar: false } })
    h.chart.subscribeClick((p) => {
      if (props.current.revealed || !p.point) return
      const price = h.series.coordinateToPrice(p.point.y)
      if (price != null && Number.isFinite(price)) props.current.onPick(price)
    })
    chart.current = h
    setGen((g) => g + 1)
    return () => {
      h.chart.remove()
      chart.current = null
    }
  }, [decimals, m1 != null])

  // Candles so far; the view: before the answer up to the entry with room on the right, after it the whole replay.
  useEffect(() => {
    const h = chart.current
    if (!h) return
    setChartBars(h, shown, step, settings.killzones)
    const from = Math.max(0, counts.entry - (revealed ? VIEW_BEFORE / 2 : VIEW_BEFORE))
    const to = revealed ? Math.max(counts.end, counts.entry + 20) + 3 : counts.entry + 25
    h.chart.timeScale().setVisibleLogicalRange({ from: from as Logical, to: to as Logical })
  }, [shown, step, settings.killzones, counts, revealed, gen])

  useEffect(() => {
    const h = chart.current
    if (!h) return
    for (const l of h.lines) h.series.removePriceLine(l)
    const line = (price: number | null, color: string, title: string, style: LineStyle) =>
      price == null ? null : h.series.createPriceLine({ price, color, title, lineStyle: style, lineWidth: 1, axisLabelVisible: true })
    h.lines = [
      ...levels.map((l) => levelPriceLine(h, l)),
      line(trade.prices.entry, ACCENT, 'Wejście', LineStyle.Solid),
      line(slPrice, '#9aa3ad', 'Twój SL', LineStyle.Dashed),
      ...(revealed
        ? [
            line(trade.prices.stopLoss, DOWN, 'SL', LineStyle.Dashed),
            line(trade.prices.takeProfit1, UP, 'TP1', LineStyle.Dashed),
            line(trade.prices.takeProfit2, UP, 'TP2', LineStyle.Dotted)
          ]
        : [])
    ].filter((l): l is IPriceLine => !!l)
    const markers: SeriesMarker<Time>[] = []
    const bucket = (ms: number) => ((Math.floor(ms / (step * MIN)) * step * MIN) / 1000) as UTCTimestamp
    const long = trade.direction === 'long'
    if (revealed && until > entryMs) {
      markers.push({ time: bucket(entryMs), position: long ? 'belowBar' : 'aboveBar', shape: long ? 'arrowUp' : 'arrowDown', color: ACCENT, text: trade.status === 'missed' ? 'wejście (missed)' : 'wejście' })
      for (const x of trade.exits) {
        const ms = x.time ? Date.parse(x.time) : NaN
        if (!Number.isFinite(ms) || ms >= until || x.price == null || trade.prices.entry == null) continue
        const won = (x.price - trade.prices.entry) * (long ? 1 : -1) >= 0
        markers.push({ time: bucket(ms), position: long ? 'aboveBar' : 'belowBar', shape: long ? 'arrowDown' : 'arrowUp', color: won ? UP : DOWN, text: x.percent < 100 ? `wyjście ${x.percent}%` : 'wyjście' })
      }
    }
    h.markers.setMarkers(markers.sort((a, b) => (a.time as number) - (b.time as number)))
  }, [levels, trade, slPrice, revealed, until, entryMs, step, shown, gen])

  if (!ticker || !win) return <div className="m-auto text-[12px] text-dim">Brak danych rynkowych dla tej transakcji.</div>
  const empty = m1 != null && !all.some((b) => b.t < entryMs && b.t >= contextFrom)
  const done = until >= win.toMs
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="drill-chart">
      <div className="flex h-[30px] shrink-0 items-center gap-2 border-b border-line px-2.5 text-[11.5px]">
        <Segmented size="sm" value={interval} onChange={setInterval_} options={INTERVALS} aria-label="Interwał wykresu treningu" />
        <span className="num text-muted">{ticker} · czas NY</span>
        {!revealed ? (
          <span className="text-muted">
            Do wejścia <span className="num text-fg-strong">{nyClock(entryMs)}</span> NY · kliknij na wykresie, by ustawić SL
          </span>
        ) : (
          <>
            <button className="btn h-[22px] px-1.5 text-[11px]" onClick={() => (done ? (setUntil(entryMs), setPlaying(true)) : setPlaying(!playing))} data-testid="drill-replay-play">
              {playing ? 'Pauza' : done ? 'Od wejścia' : 'Odtwórz'}
            </button>
            <button
              className="btn h-[22px] px-1.5 text-[11px]"
              disabled={done}
              onClick={() => {
                setPlaying(false)
                setUntil(win.toMs)
              }}
              data-testid="drill-replay-end"
            >
              Do końca
            </button>
            <span className="num text-muted" data-testid="drill-replay-time">
              {done ? `do ${nyClock(win.toMs)} NY` : `${nyClock(until)} NY`}
            </span>
          </>
        )}
        {m1 == null && <span className="text-muted">wczytuję…</span>}
      </div>
      {empty ? (
        <div className="m-auto max-w-[420px] text-center text-[12px] text-dim" data-testid="drill-chart-empty">
          {error ? `Nie udało się pobrać świec: ${error}.` : 'Brak świec sprzed wejścia w danych rynkowych (offline, a tych dni nie ma w folderze).'}
        </div>
      ) : (
        <div ref={ref} className="min-h-0 flex-1" data-testid="drill-chart-canvas" data-last={shown.length ? new Date(shown[shown.length - 1]!.t).toISOString() : ''} />
      )}
    </div>
  )
}
