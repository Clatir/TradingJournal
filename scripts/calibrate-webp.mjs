#!/usr/bin/env node
/**
 * WebP quality calibration for TradingView-style screenshots.
 *
 *   node scripts/calibrate-webp.mjs                 # synthetic 1920x1080 charts (dark + light)
 *   node scripts/calibrate-webp.mjs moj-screen.png  # your own screenshots
 *
 * Uses the exact compression code of the app (src/renderer/lib/image.ts) inside Chromium,
 * prints size + error metrics per quality and writes zoomed comparison sheets to scripts/output/.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from '@playwright/test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'scripts', 'output')
mkdirSync(outDir, { recursive: true })

const QUALITIES = [70, 75, 80, 85, 90, 95, 'lossless']

const lib = await build({
  entryPoints: [join(root, 'src/renderer/lib/image.ts')],
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'ImageLib',
  platform: 'browser'
})
const libCode = lib.outputFiles[0].text
const lwcPath = join(root, 'node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js')

function chartHtml(theme) {
  const dark = theme === 'dark'
  const bg = dark ? '#131722' : '#ffffff'
  const fg = dark ? '#d1d4dc' : '#131722'
  const grid = dark ? '#1f2433' : '#f0f3fa'
  const bar = dark ? '#1e222d' : '#f8f9fd'
  const border = dark ? '#2a2e39' : '#e0e3eb'
  return `<!doctype html><html><head><style>
  * { box-sizing: border-box; }
  body { margin:0; width:1920px; height:1080px; background:${bg}; color:${fg}; font-family:'Liberation Sans', Arial, sans-serif; overflow:hidden; }
  #top { position:absolute; left:0; top:0; right:0; height:38px; background:${bar}; border-bottom:1px solid ${border}; display:flex; align-items:center; gap:18px; padding:0 14px; font-size:14px; }
  #left { position:absolute; left:0; top:38px; bottom:0; width:52px; background:${bar}; border-right:1px solid ${border}; }
  #left div { width:26px; height:26px; margin:12px auto; border:2px solid ${dark ? '#787b86' : '#50535e'}; border-radius:4px; }
  #chart { position:absolute; left:53px; top:39px; right:0; bottom:0; }
  #legend { position:absolute; left:66px; top:48px; font-size:13px; z-index:5; display:flex; gap:8px; }
  .up { color:#089981 } .down { color:#f23645 }
  #fvg { position:absolute; z-index:4; background:rgba(41,98,255,0.18); border:1px solid rgba(41,98,255,0.6); }
  #fvg span { position:absolute; right:4px; top:2px; font-size:11px; color:#2962ff; }
  .note { position:absolute; z-index:4; font-size:12px; background:${dark ? '#2a2e39' : '#e0e3eb'}; padding:2px 5px; border-radius:3px; }
  </style></head><body>
  <div id="top"><b>EURUSD</b><span>15</span><span>Wskaźniki</span><span>Alert</span><span>Powtórka</span><span style="margin-left:auto">Zapisz</span></div>
  <div id="left">${'<div></div>'.repeat(14)}</div>
  <div id="chart"></div>
  <div id="legend"><b>Euro / U.S. Dollar · 15 · FX</b><span>O<span class="up">1.08512</span></span><span>H<span class="up">1.08540</span></span><span>L<span class="up">1.08490</span></span><span>C<span class="up">1.08530</span></span><span class="up">+0.00018 (+0.02%)</span></div>
  <div id="fvg" style="left:1180px; top:420px; width:420px; height:46px"><span>H1 FVG</span></div>
  <div class="note" style="left:980px; top:610px">MSS</div>
  <div class="note" style="left:760px; top:260px">PDH sweep</div>
  </body></html>`
}

async function renderSynthetic(browser, theme) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
  await page.setContent(chartHtml(theme === 'light' ? 'light' : 'dark'))
  await page.addScriptTag({ path: lwcPath })
  await page.evaluate((variant) => {
    const busy = variant === 'dark-busy'
    const dark = variant !== 'light'
    const el = document.getElementById('chart')
    const chart = LightweightCharts.createChart(el, {
      width: el.clientWidth,
      height: el.clientHeight,
      layout: { background: { color: dark ? '#131722' : '#ffffff' }, textColor: dark ? '#b2b5be' : '#131722', fontSize: 12, fontFamily: "'Liberation Sans', Arial, sans-serif" },
      grid: { vertLines: { color: dark ? '#1f2433' : '#f0f3fa' }, horzLines: { color: dark ? '#1f2433' : '#f0f3fa' } },
      rightPriceScale: { borderColor: dark ? '#2a2e39' : '#e0e3eb' },
      timeScale: { borderColor: dark ? '#2a2e39' : '#e0e3eb', timeVisible: true },
      crosshair: { mode: 0 }
    })
    const series = chart.addSeries(LightweightCharts.CandlestickSeries, {
      upColor: '#089981', downColor: '#f23645', borderUpColor: '#089981', borderDownColor: '#f23645', wickUpColor: '#089981', wickDownColor: '#f23645',
      priceFormat: { type: 'price', precision: 5, minMove: 0.00001 }
    })
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    let p = 1.0832
    const data = []
    const t0 = Date.UTC(2026, 2, 16, 4, 0) / 1000
    for (let i = 0; i < (busy ? 520 : 180); i++) {
      const o = p
      const drift = Math.sin(i / 18) * 0.00012
      const c = o + (rnd() - 0.48) * 0.0011 + drift
      const h = Math.max(o, c) + rnd() * 0.00045
      const l = Math.min(o, c) - rnd() * 0.00045
      data.push({ time: t0 + i * 900, open: o, high: h, low: l, close: c })
      p = c
    }
    series.setData(data)
    if (busy) {
      const ema = (n) => { let e = data[0].close; return data.map((d) => ({ time: d.time, value: (e = e + (2 / (n + 1)) * (d.close - e)) })) }
      chart.addSeries(LightweightCharts.LineSeries, { color: '#f7a600', lineWidth: 2, priceLineVisible: false }).setData(ema(20))
      chart.addSeries(LightweightCharts.LineSeries, { color: '#2962ff', lineWidth: 2, priceLineVisible: false }).setData(ema(50))
      const vol = chart.addSeries(LightweightCharts.HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' } })
      chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })
      vol.setData(data.map((d) => ({ time: d.time, value: 500 + rnd() * 3000, color: d.close >= d.open ? 'rgba(8,153,129,0.5)' : 'rgba(242,54,69,0.5)' })))
    }
    series.createPriceLine({ price: 1.0874, color: '#2962ff', lineWidth: 1, lineStyle: 0, axisLabelVisible: true, title: 'PDH' })
    series.createPriceLine({ price: 1.0801, color: '#ff9800', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'PDL' })
    series.createPriceLine({ price: 1.0846, color: '#9c27b0', lineWidth: 1, lineStyle: 1, axisLabelVisible: true, title: 'EQH' })
    chart.timeScale().fitContent()
  }, theme)
  await page.mouse.move(1100, 520)
  await page.waitForTimeout(250)
  const png = await page.screenshot({ type: 'png' })
  await page.close()
  return png
}

async function analyze(browser, name, png) {
  const page = await browser.newPage({ viewport: { width: 400, height: 300 } })
  await page.setContent('<html><body></body></html>')
  await page.addScriptTag({ content: libCode })
  const res = await page.evaluate(
    async ({ b64, qualities, name }) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      const blob = new Blob([bin], { type: 'image/png' })
      const orig = await createImageBitmap(blob)
      const W = orig.width
      const H = orig.height
      const toData = (bmp) => {
        const c = new OffscreenCanvas(W, H)
        const x = c.getContext('2d')
        x.drawImage(bmp, 0, 0)
        return x.getImageData(0, 0, W, H).data
      }
      const od = toData(orig)
      const regions = {
        axis: { x: W - 90, y: 40, w: 90, h: H - 80 },
        legend: { x: 60, y: 42, w: 700, h: 26 },
        full: { x: 0, y: 0, w: W, h: H }
      }
      const yuv = (d, i) => {
        const r = d[i], g = d[i + 1], b = d[i + 2]
        return [0.299 * r + 0.587 * g + 0.114 * b, 128 - 0.168736 * r - 0.331264 * g + 0.5 * b, 128 + 0.5 * r - 0.418688 * g - 0.081312 * b]
      }
      function metrics(dd, reg) {
        let seY = 0, seC = 0, n = 0, maxY = 0
        for (let y = reg.y; y < reg.y + reg.h; y++)
          for (let x = reg.x; x < reg.x + reg.w; x++) {
            const i = (y * W + x) * 4
            const a = yuv(od, i), b = yuv(dd, i)
            const dy = a[0] - b[0]
            seY += dy * dy
            seC += ((a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2) / 2
            maxY = Math.max(maxY, Math.abs(dy))
            n++
          }
        const psnr = (se) => (se === 0 ? Infinity : 10 * Math.log10((255 * 255) / (se / n)))
        // Block SSIM on luma (8x8 windows)
        let ssim = 0, blocks = 0
        const C1 = (0.01 * 255) ** 2, C2 = (0.03 * 255) ** 2
        for (let by = reg.y; by + 8 <= reg.y + reg.h; by += 8)
          for (let bx = reg.x; bx + 8 <= reg.x + reg.w; bx += 8) {
            let ma = 0, mb = 0
            const A = [], B = []
            for (let y = by; y < by + 8; y++)
              for (let x = bx; x < bx + 8; x++) {
                const i = (y * W + x) * 4
                const a = yuv(od, i)[0], b = yuv(dd, i)[0]
                A.push(a); B.push(b); ma += a; mb += b
              }
            ma /= 64; mb /= 64
            let va = 0, vb = 0, cov = 0
            for (let k = 0; k < 64; k++) { va += (A[k] - ma) ** 2; vb += (B[k] - mb) ** 2; cov += (A[k] - ma) * (B[k] - mb) }
            va /= 63; vb /= 63; cov /= 63
            ssim += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2))
            blocks++
          }
        return { psnrY: psnr(seY), psnrC: psnr(seC), maxErrY: Math.round(maxY), ssimY: ssim / blocks }
      }
      const rows = []
      const decoded = []
      for (const q of qualities) {
        const lossless = q === 'lossless'
        const out = await ImageLib.compressImage(blob, { mode: lossless ? 'lossless' : 'lossy', quality: lossless ? 90 : q, maxWidth: 2560, thumbWidth: 480 })
        const bmp = await createImageBitmap(new Blob([out.image], { type: 'image/webp' }))
        const dd = toData(bmp)
        decoded.push({ q, bmp })
        rows.push({
          q,
          bytes: out.image.length,
          thumbBytes: out.thumb.length,
          losslessFlag: out.lossless,
          axis: metrics(dd, regions.axis),
          legend: metrics(dd, regions.legend),
          full: metrics(dd, regions.full)
        })
      }
      // Comparison sheet: zoomed crops (x4, nearest neighbour) of price axis and legend.
      // Axis crop around the coloured price labels (the hardest case for 4:2:0 chroma subsampling).
      const axisCrop = { x: W - 120, y: Math.round(H * 0.585), w: 120, h: 180 }
      const legCrop = { x: 60, y: 42, w: 330, h: 26 }
      const Z = 4
      const colW = axisCrop.w * Z
      const shown = new Set(['PNG oryginał', 85, 90, 'lossless'])
      const sheet = new OffscreenCanvas(shown.size * (colW + 12), 30 + axisCrop.h * Z + 12 + legCrop.h * Z * 2 + 20)
      const sx = sheet.getContext('2d')
      sx.fillStyle = '#000'
      sx.fillRect(0, 0, sheet.width, sheet.height)
      sx.imageSmoothingEnabled = false
      const variants = [{ q: 'PNG oryginał', bmp: orig }, ...decoded].filter((v) => shown.has(v.q))
      variants.forEach((v, i) => {
        const x0 = i * (colW + 12)
        sx.fillStyle = '#fff'
        sx.font = '16px sans-serif'
        const row = rows.find((r) => r.q === v.q)
        sx.fillText(`${v.q === 'lossless' ? 'bezstratnie' : typeof v.q === 'number' ? 'q' + v.q : v.q}${row ? '  ' + (row.bytes / 1024).toFixed(0) + ' KB' : '  ' + (bin.length / 1024).toFixed(0) + ' KB'}`, x0 + 4, 20)
        sx.drawImage(v.bmp, axisCrop.x, axisCrop.y, axisCrop.w, axisCrop.h, x0, 30, colW, axisCrop.h * Z)
        sx.drawImage(v.bmp, legCrop.x, legCrop.y, legCrop.w / 2, legCrop.h, x0, 42 + axisCrop.h * Z, colW, legCrop.h * Z)
        sx.drawImage(v.bmp, legCrop.x + legCrop.w / 2, legCrop.y, legCrop.w / 2, legCrop.h, x0, 46 + axisCrop.h * Z + legCrop.h * Z, colW, legCrop.h * Z)
      })
      const sheetBlob = await sheet.convertToBlob({ type: 'image/png' })
      const sheetB64 = await new Promise((resolve) => {
        const fr = new FileReader()
        fr.onload = () => resolve(String(fr.result).split(',')[1])
        fr.readAsDataURL(sheetBlob)
      })
      return { name, width: W, height: H, pngBytes: bin.length, rows, sheetB64 }
    },
    { b64: png.toString('base64'), qualities: QUALITIES, name }
  )
  await page.close()
  writeFileSync(join(outDir, `${name}-porownanie.png`), Buffer.from(res.sheetB64, 'base64'))
  return res
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const inputs = process.argv.slice(2)
const sources = []
if (inputs.length) for (const f of inputs) sources.push([basename(f).replace(/\.\w+$/, ''), readFileSync(f)])
else {
  for (const theme of ['dark', 'light', 'dark-busy']) {
    const png = await renderSynthetic(browser, theme)
    writeFileSync(join(outDir, `syntetyczny-${theme}.png`), png)
    sources.push([`syntetyczny-${theme}`, png])
  }
}

const fmt = (v) => (v === Infinity ? '  ∞  ' : v.toFixed(1).padStart(5))
for (const [name, png] of sources) {
  const r = await analyze(browser, name, png)
  console.log(`\n${r.name}  ${r.width}x${r.height}  PNG ${(r.pngBytes / 1024).toFixed(0)} KB`)
  console.log('jakość      rozmiar  miniatura | oś: PSNR-Y PSNR-C maxErr SSIM  | legenda: PSNR-Y PSNR-C SSIM | całość PSNR-Y')
  for (const row of r.rows) {
    const label = row.q === 'lossless' ? 'bezstratnie' : `q${row.q}`
    console.log(
      `${label.padEnd(11)} ${(row.bytes / 1024).toFixed(0).padStart(5)} KB ${(row.thumbBytes / 1024).toFixed(0).padStart(5)} KB | ` +
        `${fmt(row.axis.psnrY)} ${fmt(row.axis.psnrC)} ${String(row.axis.maxErrY).padStart(5)}  ${row.axis.ssimY.toFixed(4)} | ` +
        `${fmt(row.legend.psnrY)} ${fmt(row.legend.psnrC)} ${row.legend.ssimY.toFixed(4)} | ${fmt(row.full.psnrY)}` +
        (row.q === 'lossless' ? `  (VP8L: ${row.losslessFlag})` : '')
    )
  }
  writeFileSync(join(outDir, `${r.name}-wyniki.json`), JSON.stringify(r.rows, null, 2))
}
await browser.close()
console.log(`\nArkusze porównawcze: ${outDir}`)
