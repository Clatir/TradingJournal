import type { ScreenSpec } from '@shared/sample/generate'

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Synthetic TradingView-like candle chart for demo screenshots (entry / SL / TP lines). */
export async function drawSampleChart(spec: ScreenSpec, width = 1600, height = 900): Promise<Blob> {
  const rnd = mulberry32(spec.seed)
  const c = new OffscreenCanvas(width, height)
  const x = c.getContext('2d')!
  const axisW = 86
  const top = 34
  const bottom = 26
  x.fillStyle = '#131722'
  x.fillRect(0, 0, width, height)

  // Price path: approach the entry (sweep beyond it towards the stop), then move to the exit/target.
  const n = 90
  const sign = spec.direction === 'long' ? 1 : -1
  const risk = Math.abs(spec.entry - spec.stop)
  const end = spec.exit ?? spec.target1
  const closes: number[] = []
  let p = spec.entry + sign * risk * 2.5
  for (let i = 0; i < n; i++) {
    const phase = i / n
    const goal = phase < 0.45 ? spec.entry - sign * risk * 0.6 : spec.exit != null ? end : spec.entry + sign * risk * 0.4
    p += (goal - p) * 0.08 + (rnd() - 0.5) * risk * 0.35
    closes.push(p)
  }
  const candles = closes.map((cl, i) => {
    const o = i ? (closes[i - 1] as number) : cl + (rnd() - 0.5) * risk * 0.3
    const h = Math.max(o, cl) + rnd() * risk * 0.25
    const l = Math.min(o, cl) - rnd() * risk * 0.25
    return { o, h, l, c: cl }
  })
  const levels = [spec.entry, spec.stop, spec.target1]
  const hi = Math.max(...candles.map((k) => k.h), ...levels) + risk * 0.4
  const lo = Math.min(...candles.map((k) => k.l), ...levels) - risk * 0.4
  const y = (v: number) => top + ((hi - v) / (hi - lo)) * (height - top - bottom)
  const plotW = width - axisW
  const step = plotW / (n + 6)

  // grid + axis labels
  x.strokeStyle = '#1f2433'
  x.lineWidth = 1
  x.font = '12px "JetBrains Mono", monospace'
  x.fillStyle = '#b2b5be'
  const decimals = 5
  for (let i = 0; i <= 8; i++) {
    const v = lo + ((hi - lo) * i) / 8
    const yy = Math.round(y(v)) + 0.5
    x.beginPath()
    x.moveTo(0, yy)
    x.lineTo(plotW, yy)
    x.stroke()
    x.fillText(v.toFixed(decimals), plotW + 8, yy + 4)
  }
  for (let i = 0; i < n; i += 12) {
    const xx = Math.round(i * step + step) + 0.5
    x.beginPath()
    x.moveTo(xx, top)
    x.lineTo(xx, height - bottom)
    x.stroke()
  }
  x.strokeStyle = '#2a2e39'
  x.beginPath()
  x.moveTo(plotW + 0.5, 0)
  x.lineTo(plotW + 0.5, height)
  x.stroke()

  // FVG zone around the entry
  const fvgTop = y(spec.entry + sign * risk * 0.35)
  const fvgBot = y(spec.entry - sign * risk * 0.1)
  x.fillStyle = 'rgba(41,98,255,0.16)'
  x.fillRect(step * 38, Math.min(fvgTop, fvgBot), plotW - step * 38, Math.abs(fvgBot - fvgTop))

  // candles
  candles.forEach((k, i) => {
    const up = k.c >= k.o
    const col = up ? '#089981' : '#f23645'
    const cx = i * step + step
    x.strokeStyle = col
    x.fillStyle = col
    x.beginPath()
    x.moveTo(Math.round(cx) + 0.5, y(k.h))
    x.lineTo(Math.round(cx) + 0.5, y(k.l))
    x.stroke()
    const bodyTop = y(Math.max(k.o, k.c))
    x.fillRect(Math.round(cx - step * 0.33), bodyTop, Math.max(1, Math.round(step * 0.66)), Math.max(1, y(Math.min(k.o, k.c)) - bodyTop))
  })

  // levels with axis labels
  const level = (v: number, color: string, label: string, dash: number[]) => {
    const yy = Math.round(y(v)) + 0.5
    x.setLineDash(dash)
    x.strokeStyle = color
    x.beginPath()
    x.moveTo(0, yy)
    x.lineTo(plotW, yy)
    x.stroke()
    x.setLineDash([])
    x.fillStyle = color
    x.fillRect(plotW + 1, yy - 9, axisW - 1, 18)
    x.fillStyle = '#ffffff'
    x.fillText(v.toFixed(decimals), plotW + 8, yy + 4)
    x.font = '11px Inter, sans-serif'
    const w = x.measureText(label).width + 10
    x.fillStyle = color
    x.fillRect(plotW - w - 4, yy - 9, w, 18)
    x.fillStyle = '#ffffff'
    x.fillText(label, plotW - w + 1, yy + 4)
    x.font = '12px "JetBrains Mono", monospace'
  }
  level(spec.target1, '#089981', 'TP1', [])
  level(spec.entry, '#787b86', 'Entry', [6, 4])
  level(spec.stop, '#f23645', 'SL', [])

  // header
  x.fillStyle = '#d1d4dc'
  x.font = '600 14px Inter, sans-serif'
  x.fillText(`${spec.pair} · ${spec.timeframe} · dane przykładowe`, 12, 22)
  return c.convertToBlob({ type: 'image/png' })
}
