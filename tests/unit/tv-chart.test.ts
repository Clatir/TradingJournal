import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createTrade } from '@shared/defaults'
import { excursionsFromBars, tradeLevels } from '@shared/calc/excursions'
import type { Bar } from '@shared/calc/ohlc'
import { AXIS_OCR, analyzeTvScreenshot, axisLabels, fitPriceScale, labelColumn, priceAt, readAxisWords, type AxisLabel } from '@shared/import/tvChart'
import type { OcrWord } from '@shared/import/xtbScreen'
import { loadPng, ocrGray } from './helpers/tvScreens'

const word = (text: string, top: number, left = 1800): OcrWord => ({ text, left, top, width: 50, height: 10, conf: 90, line: '1.1.1' })

describe('price axis', () => {
  it('reads labels, puts back a lost point and rescales by the expected price', () => {
    const labels = axisLabels([word('1.12500', 95), word('112400', 136), word('1.1230', 177)], { decimals: 5, near: 1.124 })
    expect(labels.map((l) => l.value)).toEqual([1.125, 1.124, 1.123])
  })

  it('keeps labels that lost their leading digits as suffixes, found again from the fit', () => {
    // "1.12800" read as "12800" and ".12500": the digits at the end are right, the value comes from the height.
    const read: AxisLabel[] = axisLabels(
      [word('12800', 10), word('.12500', 133), word('12400', 174), word('.12000', 338), word('11900', 379), word('11800', 420)],
      { decimals: 5, near: 1.12071 }
    )
    expect(read.every((l) => l.suffix)).toBe(true)
    const scale = fitPriceScale(read, { near: 1.12071, height: 900, decimals: 5 })!
    expect(scale.n).toBe(6)
    expect(priceAt(scale, 15)).toBeCloseTo(1.128, 4)
    expect(priceAt(scale, 425)).toBeCloseTo(1.118, 4)
  })

  it('fits through most labels and ignores a misread one', () => {
    const ys = [100, 141, 182, 223, 264, 305]
    const values = [1.13, 1.129, 1.128, 1.127, 1.126, 1.125]
    const read = ys.map((y, i) => ({ value: i === 3 ? 1.147 : values[i]!, y, x: 1800, conf: 90 }))
    const scale = fitPriceScale(read)!
    expect(scale.n).toBe(5)
    expect(scale.maxResidualPx).toBeLessThan(0.5)
    expect(priceAt(scale, 223)).toBeCloseTo(1.127, 5)
  })

  it('drops numbers outside the labels column (a "60 FVG" on the chart)', () => {
    const read = [
      ...[100, 141, 182, 223].map((y, i) => ({ value: 1.13 - i * 0.001, y, x: 1800, conf: 90 })),
      { value: 1.06, y: 150, x: 900, conf: 90 }
    ]
    expect(fitPriceScale(read)!.n).toBe(4)
  })

  it('finds the labels column', () => {
    expect(labelColumn([word('1.12500', 10, 1801), word('1.12400', 50, 1803), word('60', 80, 1700)])).toBe(1800)
    expect(labelColumn([word('1.12500', 10)])).toBeNull()
  })
})

describe('MAE / MFE from synthetic TradingView screenshots', () => {
  const dir = join(__dirname, '../fixtures/tv')
  const files = readdirSync(dir).filter((f) => f.endsWith('.png'))
  it('has fixtures', () => expect(files.length).toBeGreaterThanOrEqual(5))

  for (const f of files)
    it(f, { timeout: 60_000 }, async () => {
      const { trade, truth } = JSON.parse(readFileSync(join(dir, f.replace('.png', '.json')), 'utf8'))
      const img = loadPng(join(dir, f))
      const words = await readAxisWords(img, (g) => ocrGray(g, AXIS_OCR.psm, AXIS_OCR.whitelist))
      const r = analyzeTvScreenshot(img, words, trade)
      if (!r.ok) throw new Error(r.error)
      // One and a half pixels or 0.3 pip, whichever is more.
      const tol = Math.max(0.3, (1.5 * Math.abs(r.scale.b)) / trade.pipSize) + 0.05
      expect(Math.abs(r.maePips - truth.maePips)).toBeLessThanOrEqual(tol)
      expect(Math.abs(r.mfePips - truth.mfePips)).toBeLessThanOrEqual(tol)
      expect(r.exit).toBe(truth.exit)
      expect(r.tool.entry).toBeCloseTo(trade.entry, trade.decimals - 1)
    })
})

describe('MAE / MFE from OHLC bars', () => {
  const t0 = Date.parse('2026-10-05T13:00:00Z')
  const bar = (min: number, o: number, h: number, l: number, c: number): Bar => ({ t: t0 + min * 60_000, open: o, high: h, low: l, close: c })
  // 5-minute bars of a long from 1.1000 (entry 13:07, inside the second bar).
  const bars = [
    bar(0, 1.1, 1.103, 1.098, 1.1),
    bar(5, 1.1, 1.1015, 1.0985, 1.1005),
    bar(10, 1.1005, 1.102, 1.0992, 1.101),
    bar(15, 1.101, 1.1035, 1.1, 1.103),
    bar(20, 1.103, 1.1045, 1.102, 1.104)
  ]
  const base = {
    direction: 'long' as const,
    entry: 1.1,
    stopLoss: 1.098,
    takeProfit: 1.104,
    exitPrice: 1.104,
    entryTime: '2026-10-05T13:07:00Z',
    exitTime: '2026-10-05T13:22:00Z',
    pipSize: 0.0001
  }

  it('measures from the entry bar to the exit bar, the target capping the favourable side', () => {
    const r = excursionsFromBars(bars, base)
    if ('error' in r) throw new Error(r.error)
    expect(r.maePips).toBe(-15)
    expect(r.mfePips).toBe(40)
    expect(r.exit).toBe('target')
    expect(r.bars).toBe(4)
    expect(r.barMinutes).toBe(5)
    expect(r.warnings.some((w) => w.includes('świecy wejścia'))).toBe(true)
  })

  it('leaves out the entry bar on request', () => {
    const r = excursionsFromBars(bars, { ...base, skipEntryCandle: true })
    if ('error' in r) throw new Error(r.error)
    expect(r.maePips).toBe(-8)
    expect(r.bars).toBe(3)
  })

  it('ignores the side of the entry bar beyond a level that did not close the trade', () => {
    const r = excursionsFromBars(bars, { ...base, stopLoss: 1.0988 })
    if ('error' in r) throw new Error(r.error)
    // 1.0985 in the entry bar is beyond the stop, yet the trade closed at the target: before the entry.
    expect(r.maePips).toBe(-8)
    expect(r.warnings.some((w) => w.includes('przed wejściem i nie jest liczona'))).toBe(true)
  })

  it('caps the adverse side at the stop that closed the trade', () => {
    const r = excursionsFromBars(bars, { ...base, stopLoss: 1.099, exitPrice: 1.099, exitTime: '2026-10-05T13:08:00Z' })
    if ('error' in r) throw new Error(r.error)
    expect(r.maePips).toBe(-10)
    expect(r.exit).toBe('stop')
  })

  it('refuses a file without the entry', () => {
    expect(excursionsFromBars(bars, { ...base, entryTime: '2026-10-06T13:07:00Z' })).toHaveProperty('error')
  })
})

describe('tradeLevels', () => {
  it('takes the first target and the latest exit of a closed trade', () => {
    const t = createTrade({ pair: 'EURUSD', direction: 'short', entryTime: '2026-10-05T13:00:00Z' })
    const trade = {
      ...t,
      status: 'closed' as const,
      prices: { entry: 1.1, stopLoss: 1.102, takeProfit1: null, takeProfit2: 1.095 },
      exits: [
        { id: '01J00000000000000000000001', time: '2026-10-05T15:00:00Z', price: 1.096, percent: 50, note: '' },
        { id: '01J00000000000000000000002', time: '2026-10-05T14:00:00Z', price: 1.098, percent: 50, note: '' }
      ]
    }
    expect(tradeLevels(trade)).toEqual({
      direction: 'short',
      entry: 1.1,
      stopLoss: 1.102,
      takeProfit: 1.095,
      exitPrice: 1.096,
      exitTime: '2026-10-05T15:00:00Z'
    })
    expect(tradeLevels({ ...trade, status: 'open' }).exitPrice).toBeNull()
  })
})
