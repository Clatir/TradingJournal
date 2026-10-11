/**
 * Series primitive of lightweight-charts drawing the scanner layers: zones (time range × price range with a
 * label), horizontal level segments with a label at their right end, and vertical time bands (killzones) behind
 * the candles. Times are Unix seconds; a `to` of null extends to the right edge of the chart. Times outside the
 * loaded candles are extrapolated with the bar length, so an old level still starts at the left edge.
 */
import type { IChartApi, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, Logical, SeriesAttachedParameter, Time } from 'lightweight-charts'
import type { CanvasRenderingTarget2D } from 'fancy-canvas'
import { EMPTY_LAYERS, type LayerData } from './layers'

const FONT = "10px 'JetBrains Mono', ui-monospace, monospace"

class LayerRenderer implements IPrimitivePaneRenderer {
  constructor(
    private readonly data: LayerData,
    private readonly chart: IChartApi,
    private readonly series: ISeriesApi<'Candlestick'>,
    private readonly background: boolean
  ) {}

  private x(t: number): number | null {
    const ts = this.chart.timeScale()
    const bars = this.data.bars
    if (bars) {
      if (t < bars.first) {
        const i0 = ts.timeToIndex(bars.first as Time, true)
        return i0 === null ? null : ts.logicalToCoordinate((i0 + (t - bars.first) / bars.seconds) as Logical)
      }
      if (t > bars.last) {
        const i1 = ts.timeToIndex(bars.last as Time, true)
        return i1 === null ? null : ts.logicalToCoordinate((i1 + (t - bars.last) / bars.seconds) as Logical)
      }
    }
    const idx = ts.timeToIndex(t as Time, true)
    return idx === null ? null : ts.logicalToCoordinate(idx as number as Logical)
  }

  draw(target: CanvasRenderingTarget2D): void {
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      ctx.save()
      ctx.font = FONT
      if (this.background) this.drawBands(ctx, mediaSize.height)
      else {
        this.drawZones(ctx, mediaSize.width)
        this.drawLevels(ctx, mediaSize.width)
      }
      ctx.restore()
    })
  }

  private drawBands(ctx: CanvasRenderingContext2D, height: number): void {
    ctx.textBaseline = 'top'
    for (const b of this.data.bands) {
      const x1 = this.x(b.from)
      const x2 = this.x(b.to)
      if (x1 === null || x2 === null || x2 <= x1) continue
      ctx.fillStyle = b.fill
      ctx.fillRect(x1, 0, x2 - x1, height)
      if (b.label && x2 - x1 > 30) {
        ctx.fillStyle = 'rgba(122,131,142,0.8)'
        ctx.fillText(b.label, x1 + 3, 2)
      }
    }
  }

  private drawZones(ctx: CanvasRenderingContext2D, width: number): void {
    ctx.textBaseline = 'top'
    ctx.lineWidth = 1
    for (const z of this.data.zones) {
      const x1 = this.x(z.from)
      const y1 = this.series.priceToCoordinate(z.top)
      const y2 = this.series.priceToCoordinate(z.bottom)
      if (x1 === null || y1 === null || y2 === null) continue
      const x2 = z.to === null ? width : (this.x(z.to) ?? width)
      if (x2 <= x1 || x1 > width || x2 < 0) continue
      const w = Math.max(2, x2 - x1)
      const h = Math.max(1, y2 - y1)
      ctx.fillStyle = z.fill
      ctx.fillRect(x1, y1, w, h)
      ctx.strokeStyle = z.stroke
      ctx.setLineDash(z.dashed ? [3, 3] : [])
      ctx.strokeRect(x1 + 0.5, y1 + 0.5, w - 1, h - 1)
      if (z.label && h >= 11 && w >= 24) {
        ctx.fillStyle = z.stroke
        ctx.fillText(z.label, Math.max(x1, 0) + 3, y1 + 2, w - 6)
      }
    }
  }

  private drawLevels(ctx: CanvasRenderingContext2D, width: number): void {
    ctx.textBaseline = 'bottom'
    for (const l of this.data.levels) {
      const x1 = this.x(l.from)
      const y = this.series.priceToCoordinate(l.price)
      if (x1 === null || y === null) continue
      const x2 = l.to === null ? width : (this.x(l.to) ?? width)
      if (x2 <= x1 || x1 > width || x2 < 0) continue
      ctx.strokeStyle = l.color
      ctx.lineWidth = l.width ?? 1
      ctx.setLineDash(l.dashed ? [4, 3] : [])
      ctx.beginPath()
      ctx.moveTo(x1, y + 0.5)
      ctx.lineTo(x2, y + 0.5)
      ctx.stroke()
      if (l.label) {
        ctx.fillStyle = l.color
        ctx.textAlign = 'right'
        ctx.fillText(l.label, Math.min(x2, width) - 3, y - 1)
        ctx.textAlign = 'left'
      }
    }
  }
}

class LayerView implements IPrimitivePaneView {
  constructor(
    private readonly owner: LayerPrimitive,
    private readonly background: boolean
  ) {}

  zOrder(): 'bottom' | 'normal' {
    return this.background ? 'bottom' : 'normal'
  }

  renderer(): IPrimitivePaneRenderer | null {
    const { chart, series } = this.owner
    if (!chart || !series) return null
    return new LayerRenderer(this.owner.data, chart, series, this.background)
  }
}

export class LayerPrimitive implements ISeriesPrimitive<Time> {
  data: LayerData = EMPTY_LAYERS
  chart: IChartApi | null = null
  series: ISeriesApi<'Candlestick'> | null = null
  private requestUpdate: (() => void) | null = null
  private readonly views = [new LayerView(this, true), new LayerView(this, false)]

  attached(param: SeriesAttachedParameter<Time, 'Candlestick'>): void {
    this.chart = param.chart
    this.series = param.series
    this.requestUpdate = param.requestUpdate
  }

  detached(): void {
    this.chart = null
    this.series = null
    this.requestUpdate = null
  }

  setData(data: LayerData): void {
    this.data = data
    this.requestUpdate?.()
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views
  }
}
