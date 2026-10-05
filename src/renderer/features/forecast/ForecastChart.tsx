import { useEffect, useRef } from 'react'
import {
  ColorType,
  createChart,
  createSeriesMarkers,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  PriceScaleMode,
  type UTCTimestamp
} from 'lightweight-charts'
import type { ForecastResult } from '@shared/calc/forecast'
import type { MonteCarloSummary } from '@shared/calc/montecarlo'
import { goalName } from '@shared/export/forecast'
import { firstMonthParts } from '@shared/forecast-input'
import type { Forecast } from '@shared/schema'
import { fmtAmount } from '../../lib/format'
import { Panel, Segmented, Toggle } from '../../components/ui'
import { useForecastSession } from './session'

const ACCENT = '#e8a33d'
const FG_STRONG = '#e8edf2'
const DIM = '#4f5862'
const MUTED = '#7a838e'

/** First day of forecast month k (UTC seconds), the time axis of the chart. */
export function monthTime(k: number, firstMonth: string): UTCTimestamp {
  const { m0, y0 } = firstMonthParts(firstMonth)
  const idx = m0 + k - 1
  return (Date.UTC(y0 + Math.floor(idx / 12), idx % 12, 1) / 1000) as UTCTimestamp
}

/** "Wykres" (chapter 10): capital / mass and set aside / fund, purchases, monthly payout, spread and the compared scenario. */
export function ForecastChart({
  scenario,
  result,
  spread,
  compare
}: {
  scenario: Forecast
  result: ForecastResult
  spread: MonteCarloSummary | null
  compare: { scenario: Forecast; result: ForecastResult } | null
}) {
  const ref = useRef<HTMLDivElement>(null)
  const scale = useForecastSession((s) => s.chartScale)
  const showSpread = useForecastSession((s) => s.showSpread)
  const fund = scenario.keep === 'fund'
  const capitalName = fund ? 'Masa obrotowa' : 'Kapitał'
  const potName = fund ? 'Fundusz celowy' : 'Odłożona gotówka'
  const spreadOn = !!spread && showSpread
  // Logarithmic scale needs positive values of the capital lines (the set-aside line has gaps at zero instead).
  const capitalValues = [
    ...result.rows.map((r) => r.end),
    ...(compare?.result.rows.map((r) => r.end) ?? []),
    ...(spreadOn ? spread!.monthly.flatMap((m) => [m.p5, m.p50, m.p95]) : [])
  ]
  const logAllowed = capitalValues.every((v) => v > 0)
  const log = scale === 'log' && logAllowed

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: '#111418' },
        textColor: MUTED,
        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
        fontSize: 11,
        attributionLogo: false,
        panes: { separatorColor: '#1e232a', separatorHoverColor: '#2b323b' }
      },
      grid: { vertLines: { color: '#171b20' }, horzLines: { color: '#171b20' } },
      rightPriceScale: { borderColor: '#1e232a' },
      timeScale: { borderColor: '#1e232a', timeVisible: false },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: DIM, labelBackgroundColor: '#2b323b' }, horzLine: { color: DIM, labelBackgroundColor: '#2b323b' } },
      localization: { locale: 'pl-PL', priceFormatter: (p: number) => fmtAmount(p, undefined, 0) }
    })
    const time = (k: number) => monthTime(k, scenario.firstMonth)
    if (spreadOn) {
      const line = (key: 'p5' | 'p50' | 'p95', style: LineStyle) => {
        const s = chart.addSeries(LineSeries, { color: DIM, lineWidth: 1, lineStyle: style, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false })
        s.setData(spread!.monthly.map((m) => ({ time: time(m.k), value: m[key] })))
      }
      line('p5', LineStyle.Dashed)
      line('p95', LineStyle.Dashed)
      line('p50', LineStyle.Solid)
    }
    if (compare) {
      const other = chart.addSeries(LineSeries, { color: MUTED, lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false, title: compare.scenario.name })
      other.setData(compare.result.rows.map((r) => ({ time: monthTime(r.k, compare.scenario.firstMonth), value: r.end })))
    }
    const pot = chart.addSeries(LineSeries, { color: FG_STRONG, lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
    pot.setData(result.rows.map((r) => (log && !(r.pot > 0) ? { time: time(r.k) } : { time: time(r.k), value: r.pot })))
    const capital = chart.addSeries(LineSeries, { color: ACCENT, lineWidth: 2, priceLineVisible: false, lastValueVisible: true })
    capital.setData(result.rows.map((r) => ({ time: time(r.k), value: r.end })))
    // Only the capital pane: the payout histogram (second pane) keeps a linear scale, its bars can be 0.
    capital.priceScale().applyOptions({ mode: log ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal })
    createSeriesMarkers(
      capital,
      result.rows
        .filter((r) => r.buys.length)
        .map((r) => ({ time: time(r.k), position: 'aboveBar' as const, color: ACCENT, shape: 'arrowDown' as const, text: r.buys.map((b) => goalName(b.name)).join(' + ') }))
    )
    const payout = chart.addSeries(HistogramSeries, { color: 'rgba(232,163,61,0.45)', priceLineVisible: false, lastValueVisible: false }, 1)
    payout.setData(result.rows.map((r) => ({ time: time(r.k), value: r.payout })))
    chart.panes()[1]?.setHeight(70)
    chart.timeScale().fitContent()
    return () => chart.remove()
  }, [result, scenario.firstMonth, spread, spreadOn, compare, log])

  const legendItem = (color: string, label: string, dashed = false, testId?: string) => (
    <span className="flex items-center gap-1.5" data-testid={testId}>
      <span className="inline-block w-[18px]" style={{ borderTop: `${dashed ? '1px dashed' : '2px solid'} ${color}` }} />
      {label}
    </span>
  )

  return (
    <Panel
      title="Wykres"
      actions={
        <div className="flex items-center gap-3">
          {spread && (
            <span data-testid="fc-chart-spread">
              <Toggle checked={showSpread} onChange={(v) => useForecastSession.setState({ showSpread: v })} label="Pokaż rozrzut" />
            </span>
          )}
          <span className="text-[11px] text-muted">Skala</span>
          <Segmented
            value={log ? 'log' : 'linear'}
            options={[
              { value: 'linear', label: 'Liniowa' },
              {
                value: 'log',
                label: 'Logarytmiczna',
                disabled: !logAllowed,
                title: logAllowed ? undefined : 'Skala logarytmiczna wymaga, żeby kapitał we wszystkich miesiącach był większy od zera.'
              }
            ]}
            onChange={(v) => useForecastSession.setState({ chartScale: v })}
            size="sm"
            aria-label="Skala"
          />
        </div>
      }
    >
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-muted" data-testid="fc-chart-legend">
          {legendItem(ACCENT, capitalName)}
          {legendItem(FG_STRONG, potName)}
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-[8px] w-[8px]" style={{ background: 'rgba(232,163,61,0.45)' }} />
            {fund ? 'Odkładana wypłata (miesięcznie)' : 'Wypłata (miesięcznie)'}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="text-accent">▼</span> zakup celu
          </span>
          {spreadOn && legendItem(DIM, `rozrzut 5% / 95% (${spread!.runs} przebiegów)`, true, 'fc-legend-spread')}
          {spreadOn && legendItem(DIM, 'mediana', false, 'fc-legend-median')}
          {compare && legendItem(MUTED, compare.scenario.name, true, 'fc-legend-compare')}
        </div>
        <div ref={ref} style={{ height: 320 }} className="w-full" data-testid="fc-chart" />
      </div>
    </Panel>
  )
}
