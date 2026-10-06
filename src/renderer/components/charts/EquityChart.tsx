import { useEffect, useRef } from 'react'
import { BaselineSeries, ColorType, createChart, CrosshairMode, HistogramSeries, LineStyle, type IChartApi, type UTCTimestamp } from 'lightweight-charts'
import type { EquityPointSec } from '@shared/calc/analytics'

const UP = '#2ebd85'
const DOWN = '#f6465d'

const formatR = (p: number) => `${p >= 0 ? '+' : '−'}${Math.abs(p).toFixed(2)}R`

/** Cumulative result (baseline at 0: green above, red below) with a drawdown pane underneath; in R unless `format`. */
export function EquityChart({
  points,
  height = 300,
  format = formatR,
  testId = 'equity-chart'
}: {
  points: ReadonlyArray<Pick<EquityPointSec, 'time' | 'equity' | 'drawdown'>>
  height?: number
  format?: (value: number) => string
  testId?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)

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
        attributionLogo: false,
        panes: { separatorColor: '#1e232a', separatorHoverColor: '#2b323b' }
      },
      grid: { vertLines: { color: '#171b20' }, horzLines: { color: '#171b20' } },
      rightPriceScale: { borderColor: '#1e232a' },
      timeScale: { borderColor: '#1e232a', timeVisible: false },
      crosshair: { mode: CrosshairMode.Magnet, vertLine: { color: '#4f5862', labelBackgroundColor: '#2b323b' }, horzLine: { color: '#4f5862', labelBackgroundColor: '#2b323b' } },
      localization: { locale: 'pl-PL', priceFormatter: format }
    })
    chartRef.current = chart
    const equity = chart.addSeries(BaselineSeries, {
      baseValue: { type: 'price', price: 0 },
      topLineColor: UP,
      topFillColor1: 'rgba(46,189,133,0.18)',
      topFillColor2: 'rgba(46,189,133,0.02)',
      bottomLineColor: DOWN,
      bottomFillColor1: 'rgba(246,70,93,0.02)',
      bottomFillColor2: 'rgba(246,70,93,0.18)',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true
    })
    equity.createPriceLine({ price: 0, color: '#2b323b', lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false })
    const dd = chart.addSeries(HistogramSeries, { color: 'rgba(246,70,93,0.55)', priceLineVisible: false, lastValueVisible: false }, 1)
    equity.setData(points.map((p) => ({ time: p.time as UTCTimestamp, value: p.equity })))
    dd.setData(points.map((p) => ({ time: p.time as UTCTimestamp, value: p.drawdown })))
    chart.panes()[1]?.setHeight(Math.round(height * 0.24))
    chart.timeScale().fitContent()
    return () => {
      chart.remove()
      chartRef.current = null
    }
  }, [points, height, format])

  return <div ref={ref} style={{ height }} className="w-full" data-testid={testId} />
}
