#!/usr/bin/env node
/**
 * Synthetic TradingView "after" screenshots with known candles, for the MAE / MFE reader (src/shared/import/tvChart.ts).
 *
 *   node scripts/tv-screens.mjs [outDir] [count] [seed]      (CHROMIUM_PATH=... when Playwright has no browser)
 *
 * Draws charts like the user's (dark #151a24, candles #089981 / #f23645, the Long / Short Position tool in the
 * red / green or blue / grey scheme, FVG zones, solid and dotted lines, labels) with lightweight-charts in Chromium,
 * and writes for every case `<name>.png` + `<name>.json`: the trade (direction, entry, SL, TP, exit) and the expected
 * MAE / MFE computed from the candles with the same rules as the reader (the entry candle counts; the level that
 * closed the trade caps its side; the target closes only when the trade ended there).
 * Deterministic (seeded); the fixtures in tests/fixtures/tv/ are cases of `node scripts/tv-screens.mjs <dir> 50 9191`
 * (names ending in -webp: compressed to lossy WebP and back, as a screen saved by the app may be).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = process.argv[2] ?? join(root, 'scripts', 'output', 'tv')
const count = Number(process.argv[3] ?? 12)
const seedBase = Number(process.argv[4] ?? 1000)
mkdirSync(outDir, { recursive: true })
const lwcPath = join(root, 'node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js')

function rng(seed) {
  let s = seed
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

const INSTRUMENTS = [
  { symbol: 'EURUSD', title: 'Euro / U.S. Dollar · 1h · OANDA', price: 1.1214, decimals: 5, pip: 0.0001, vol: 0.0011 },
  { symbol: 'AUDUSD', title: 'Australian Dollar / U.S. Dollar · 1h · OANDA', price: 0.6948, decimals: 5, pip: 0.0001, vol: 0.0008 },
  { symbol: 'USDCHF', title: 'U.S. Dollar / Swiss Franc · 1h · OANDA', price: 0.8031, decimals: 5, pip: 0.0001, vol: 0.0007 },
  { symbol: 'WTI', title: 'CFDs on WTI Crude Oil · 1h · TVC', price: 90.59, decimals: 2, pip: 0.01, vol: 0.45 },
  { symbol: 'USDJPY', title: 'U.S. Dollar / Japanese Yen · 1h · OANDA', price: 148.62, decimals: 3, pip: 0.01, vol: 0.16 }
]

/** One case: candles, the trade and how it ends. */
function makeCase(i) {
  const r = rng(seedBase + i * 7919)
  const inst = INSTRUMENTS[i % INSTRUMENTS.length]
  const long = i % 4 === 0 || i % 4 === 3
  const scheme = i % 2 ? 'blue' : 'red'
  const outcome = ['stop', 'target', 'end'][i % 3]
  const n = 150
  const bars = []
  let p = inst.price
  const t0 = Date.UTC(2026, 8, 7, 0) / 1000
  const iEntry = 70 + Math.floor(r() * 25)
  const risk = inst.vol * (1.4 + r() * 1.6)
  // Mostly the whole tool in view; every fifth case a far target (cut by the plot's edge).
  const rr = i % 5 === 4 ? 6 + r() * 3 : 1.8 + r() * 1.6
  // The entry price is the close of the bar before the entry bar's open, roughly.
  let entry = 0
  let stop = 0
  let target = 0
  let iEnd = iEntry + 18 + Math.floor(r() * 20)
  const sign = long ? 1 : -1
  for (let k = 0; k < n; k++) {
    const o = p
    let drift = (r() - 0.5) * inst.vol * 0.9
    if (k === iEntry) {
      entry = Number(o.toFixed(inst.decimals))
      stop = Number((entry - sign * risk).toFixed(inst.decimals))
      target = Number((entry + sign * risk * rr).toFixed(inst.decimals))
    }
    if (k >= iEntry && k < iEnd) {
      // Push towards the planned outcome.
      const goal = outcome === 'stop' ? stop : outcome === 'target' ? target : entry + sign * risk * 0.6
      drift += (goal - o) * (0.09 + r() * 0.05)
    }
    const c = o + drift
    let h = Math.max(o, c) + r() * inst.vol * 0.5
    let l = Math.min(o, c) - r() * inst.vol * 0.5
    bars.push({ time: t0 + k * 3600, open: o, high: h, low: l, close: c })
    p = c
  }
  for (const b of bars) for (const key of ['open', 'high', 'low', 'close']) b[key] = Number(b[key].toFixed(inst.decimals))
  // The tool ends where the user dragged it: a few bars after the planned exit.
  const iRight = Math.min(n - 5, iEnd + 2 + Math.floor(r() * 6))
  const truth = expected(bars, iEntry, iRight, { long, entry, stop, target })
  const exitPrice = truth.exit === 'stop' ? stop : truth.exit === 'target' ? target : bars[truth.exitIndex].close
  return { i, inst, long, scheme, bars, iEntry, iRight, entry, stop, target, exitPrice, truth, r }
}

/** MAE / MFE from the bars with the reader's rules (the trade's exit decides whether the target closes it). */
function expected(bars, iEntry, iRight, { long, entry, stop, target }) {
  let adverse = 0
  let favourable = 0
  let exit = 'end'
  let exitIndex = iRight
  let maeIndex = iEntry
  let mfeIndex = iEntry
  for (let k = iEntry; k <= iRight; k++) {
    const b = bars[k]
    const a = long ? entry - b.low : b.high - entry
    const f = long ? b.high - entry : entry - b.low
    if (a > adverse) [adverse, maeIndex] = [a, k]
    if (f > favourable) [favourable, mfeIndex] = [f, k]
    const stopHit = long ? b.low <= stop : b.high >= stop
    const targetHit = long ? b.high >= target : b.low <= target
    if (stopHit || targetHit) {
      exit = stopHit ? 'stop' : 'target'
      exitIndex = k
      break
    }
  }
  if (exit === 'stop') adverse = Math.min(adverse, Math.abs(entry - stop))
  if (exit === 'target') favourable = Math.min(favourable, Math.abs(target - entry))
  return { adverse, favourable, exit, exitIndex, maeIndex, mfeIndex }
}

function pageHtml(c, frame) {
  const { width, height, header } = frame
  return `<!doctype html><html><head><style>
  * { box-sizing: border-box; }
  body { margin:0; width:${width}px; height:${height}px; background:#151a24; color:#d1d4dc; font-family:'Liberation Sans', Arial, sans-serif; overflow:hidden; position:relative; }
  #head { position:absolute; left:0; top:0; right:0; height:${header ? 24 : 0}px; background:#1c1f26; font-size:11px; padding:5px 8px; color:#d1d4dc; overflow:hidden; }
  #foot { position:absolute; left:0; bottom:0; right:0; height:${header ? 52 : 0}px; background:#1c1f26; font-size:20px; font-weight:bold; padding:14px 10px; color:#e6e6e6; overflow:hidden; }
  #chart { position:absolute; left:${header ? 8 : 0}px; top:${header ? 24 : 0}px; right:0; bottom:${header ? 52 : 0}px; }
  #legend { position:absolute; left:${header ? 16 : 8}px; top:${header ? 32 : 8}px; font-size:11px; z-index:5; color:#b2b5be; }
  .ov { position:absolute; z-index:4; pointer-events:none; }
  .lab { position:absolute; z-index:6; color:#e6e6e6; font-size:11px; white-space:nowrap; }
  </style></head><body>
  <div id="head">Szy_Monk created with TradingView.com, Oct 08, 2026 17:39 UTC-4</div>
  <div id="chart"></div>
  <div id="legend">${c.inst.title}<br>Fair Value Gap SpaceManBTC (D, Current TF, 10, 20)</div>
  <div id="foot">TradingView</div>
  </body></html>`
}

async function render(browser, c, frame) {
  const page = await browser.newPage({ viewport: { width: frame.width, height: frame.height }, deviceScaleFactor: 1 })
  await page.setContent(pageHtml(c, frame))
  await page.addScriptTag({ path: lwcPath })
  const info = await page.evaluate(
    ({ bars, decimals, iEntry, iRight, entry, stop, target, long, scheme, exitIndex, extras }) => {
      const el = document.getElementById('chart')
      const chart = LightweightCharts.createChart(el, {
        width: el.clientWidth,
        height: el.clientHeight,
        layout: { background: { color: '#151a24' }, textColor: '#b2b5be', fontSize: 11, fontFamily: "'Liberation Sans', Arial, sans-serif", attributionLogo: false },
        grid: { vertLines: { color: '#1c212c' }, horzLines: { color: '#1c212c' } },
        rightPriceScale: { borderColor: '#2a2e39' },
        timeScale: { borderColor: '#2a2e39', timeVisible: true, barSpacing: extras.barSpacing, rightOffset: 8 },
        crosshair: { mode: 2 }
      })
      const series = chart.addSeries(LightweightCharts.CandlestickSeries, {
        upColor: '#089981', downColor: '#f23645', borderUpColor: '#089981', borderDownColor: '#f23645', wickUpColor: '#089981', wickDownColor: '#f23645',
        priceFormat: { type: 'price', precision: decimals, minMove: 10 ** -decimals },
        lastValueVisible: true,
        priceLineVisible: true
      })
      series.setData(bars)
      chart.timeScale().scrollToPosition(extras.scroll, false)
      // Horizontal lines: solid and dotted, some through the tool.
      for (const l of extras.lines) series.createPriceLine({ price: l.price, color: l.color, lineWidth: l.width, lineStyle: l.style, axisLabelVisible: true, title: '' })
      return new Promise((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const box = el.getBoundingClientRect()
            const x = (k) => chart.timeScale().timeToCoordinate(bars[k].time) + box.left
            const y = (p) => series.priceToCoordinate(p) + box.top
            const plotRight = box.left + chart.timeScale().width()
            const plotBottom = box.top + chart.paneSize().height
            // Drawings are clipped to the plot like in TradingView.
            const add = (cls, left, top, w, h, bg, extra = '') => {
              if (cls === 'ov') {
                const l = Math.max(left, box.left)
                const t = Math.max(top, box.top)
                const r = Math.min(left + w, plotRight)
                const b = Math.min(top + h, plotBottom)
                if (r <= l || b <= t) return null
                ;[left, top, w, h] = [l, t, r - l, b - t]
              }
              const d = document.createElement('div')
              d.className = cls
              d.style.cssText = `left:${left}px;top:${top}px;width:${w}px;height:${h}px;background:${bg};${extra}`
              document.body.appendChild(d)
              return d
            }
            // FVG zones (indicator boxes running to the right edge), drawn before the tool.
            for (const z of extras.zones) {
              const top = y(z.hi)
              add('ov', x(z.from), top, plotRight - x(z.from), y(z.lo) - top, z.color)
              const ly = top + (y(z.lo) - top) / 2 - 7
              if (ly > box.top && ly < plotBottom - 14) add('lab', x(z.from) + 40, ly, 0, 0, 'transparent').textContent = z.label
            }
            // The position tool: stop part and target part, with the thin entry line and the closed part shaded.
            const left = x(iEntry)
            const right = x(iRight)
            const yE = y(entry)
            const yS = y(stop)
            const yT = y(target)
            const stopColor = scheme === 'red' ? 'rgba(242,54,69,0.2)' : 'rgba(120,123,134,0.35)'
            const targetColor = scheme === 'red' ? 'rgba(8,153,129,0.2)' : 'rgba(41,98,255,0.35)'
            add('ov', left, Math.min(yE, yS), right - left, Math.abs(yS - yE), stopColor)
            add('ov', left, Math.min(yE, yT), right - left, Math.abs(yT - yE), targetColor)
            add('ov', left, yE - 0.5, right - left, 1, 'rgba(160,160,170,0.55)')
            const closeY = y(bars[exitIndex].close)
            add('ov', left, Math.min(yE, closeY), x(exitIndex) - left, Math.abs(closeY - yE), 'rgba(255,255,255,0.05)')
            for (const t of extras.texts) {
              if (y(t.price) < box.top + 4 || y(t.price) > plotBottom - t.size - 4) continue
              add('lab', x(t.at), y(t.price), 0, 0, 'transparent', `font-size:${t.size}px`).textContent = t.text
            }
            // The last bar fully on the picture (a tool may run on past the plot's right edge).
            let lastVisible = bars.length - 1
            while (lastVisible > 0 && !(x(lastVisible) <= plotRight - 4)) lastVisible--
            resolve({ left, right, lastVisible, maeX: x(extras.maeIndex), mfeX: x(extras.mfeIndex), exitX: x(exitIndex) })
          })
        )
      )
    },
    {
      bars: c.bars,
      decimals: c.inst.decimals,
      iEntry: c.iEntry,
      iRight: c.drawRight ?? c.iRight,
      entry: c.entry,
      stop: c.stop,
      target: c.target,
      long: c.long,
      scheme: c.scheme,
      exitIndex: c.truth.exitIndex,
      extras: frame.extras
    }
  )
  await page.mouse.move(5, frame.height - 5)
  await page.waitForTimeout(100)
  let png = await page.screenshot({ type: 'png' })
  if (frame.lossy) {
    // A screenshot saved as lossy WebP (like a pasted / uploaded one): encode and decode in Chromium, keep as PNG.
    const b64 = await page.evaluate(async (src) => {
      const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${src}`)).blob())
      const c = new OffscreenCanvas(bmp.width, bmp.height)
      c.getContext('2d').drawImage(bmp, 0, 0)
      const webp = await c.convertToBlob({ type: 'image/webp', quality: 0.78 })
      const back = await createImageBitmap(webp)
      const d = new OffscreenCanvas(back.width, back.height)
      d.getContext('2d').drawImage(back, 0, 0)
      const out = new Uint8Array(await (await d.convertToBlob({ type: 'image/png' })).arrayBuffer())
      let s = ''
      for (const x of out) s += String.fromCharCode(x)
      return btoa(s)
    }, png.toString('base64'))
    png = Buffer.from(b64, 'base64')
  }
  await page.close()
  return { png, info }
}

function extrasFor(c) {
  const r = c.r
  const span = Math.abs(c.target - c.stop)
  const around = (k) => c.entry + (r() - 0.5) * span * k
  const dec = c.inst.decimals
  const fix = (v) => Number(v.toFixed(dec))
  const zones = []
  for (let z = 0; z < 4; z++) {
    const mid = around(2.2)
    const h = span * (0.03 + r() * 0.08)
    zones.push({ from: Math.max(0, c.iEntry - 30 + Math.floor(r() * 50)), hi: fix(mid + h / 2), lo: fix(mid - h / 2), color: r() < 0.5 ? 'rgba(242,54,69,0.12)' : 'rgba(8,153,129,0.12)', label: '60 FVG' })
  }
  const lines = [
    { price: fix(around(1.4)), color: '#e040fb', width: 1, style: 0 },
    { price: fix(around(1.6)), color: '#f23645', width: 1, style: 1 },
    { price: fix(around(2.4)), color: '#ffffff', width: 1, style: 0 }
  ]
  const texts = [
    { at: c.iEntry + 3, price: fix(around(0.6)), text: '60 FVG', size: 11 },
    { at: Math.max(0, c.iEntry - 20), price: fix(around(1.8)), text: '[H4] FVG', size: 22 }
  ]
  return { zones, lines, texts, barSpacing: 6 + Math.floor(r() * 9), scroll: -Math.floor(r() * 30) - 5 }
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const cases = []
for (let i = 0; i < count; i++) {
  const c = makeCase(i)
  const frame = i % 4 === 3 ? { width: 1828, height: 882, header: false } : { width: 2000, height: 1234, header: true }
  frame.extras = { ...extrasFor(c), maeIndex: c.truth.maeIndex, mfeIndex: c.truth.mfeIndex }
  frame.lossy = i % 3 === 1
  let { png, info } = await render(browser, c, frame)
  if (info.lastVisible < c.iRight) {
    // Only what the picture shows can be measured: the truth up to the last visible bar, drawn again.
    c.drawRight = c.iRight
    c.iRight = info.lastVisible
    c.truth = expected(c.bars, c.iEntry, c.iRight, { long: c.long, entry: c.entry, stop: c.stop, target: c.target })
    c.exitPrice = c.truth.exit === 'stop' ? c.stop : c.truth.exit === 'target' ? c.target : c.bars[c.truth.exitIndex].close
    frame.extras.maeIndex = c.truth.maeIndex
    frame.extras.mfeIndex = c.truth.mfeIndex
    ;({ png, info } = await render(browser, c, frame))
  }
  const name = `tv-${String(i).padStart(2, '0')}-${c.inst.symbol}-${c.long ? 'long' : 'short'}-${c.scheme}-${c.truth.exit}${frame.lossy ? '-webp' : ''}`
  writeFileSync(join(outDir, `${name}.png`), png)
  const trade = { direction: c.long ? 'long' : 'short', entry: c.entry, stopLoss: c.stop, takeProfit: c.target, exitPrice: c.exitPrice, pipSize: c.inst.pip, decimals: c.inst.decimals }
  const truth = { maePips: -Number((c.truth.adverse / c.inst.pip).toFixed(1)), mfePips: Number((c.truth.favourable / c.inst.pip).toFixed(1)), exit: c.truth.exit }
  const at = { toolLeft: Math.round(info.left), toolRight: Math.round(info.right), maeX: Math.round(info.maeX), mfeX: Math.round(info.mfeX), exitX: Math.round(info.exitX) }
  writeFileSync(join(outDir, `${name}.json`), `${JSON.stringify({ trade, truth, at }, null, 2)}\n`)
  cases.push(name)
  console.log(name, truth)
}
await browser.close()
