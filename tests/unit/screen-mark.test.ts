import { describe, expect, it } from 'vitest'
import { MARK_SIZES, markGeometry, markPositionAt } from '@shared/screenMark'
import { settingsSchema } from '@shared/schema'

describe('timeframe mark geometry', () => {
  it('keeps the 1.7.0 look by default: top left corner, ~62 px text on a 1920 × 1080 chart', () => {
    const g = markGeometry(1920, 1080, 'H1')
    expect(g.font).toBeCloseTo(61.44, 2)
    expect(g.x).toBeCloseTo(11.52, 2)
    expect(g.y).toBeCloseTo(8.64, 2)
    expect(g.width).toBeCloseTo(2 * g.font * 0.66 + g.pad * 2, 6)
    expect(g.height).toBeCloseTo(g.font + g.pad * 1.6, 6)
  })

  it('places the mark in the free room: 1 = against the right / bottom edge, always inside', () => {
    for (const size of MARK_SIZES.map((s) => s.value)) {
      const g = markGeometry(1920, 1080, 'M15?', { x: 1, y: 1 }, size)
      expect(g.x + g.width).toBeCloseTo(1920 - 11.52, 6)
      expect(g.y + g.height).toBeCloseTo(1080 - 8.64, 6)
      const mid = markGeometry(1920, 1080, 'M15?', { x: 0.5, y: 0.5 }, size)
      expect(mid.x + mid.width / 2).toBeCloseTo(960, 6)
      expect(mid.y + mid.height / 2).toBeCloseTo(540, 6)
    }
    // Out-of-range values (a hand-edited file) are clamped.
    expect(markGeometry(1920, 1080, 'H1', { x: 7, y: -2 }).x).toBeCloseTo(markGeometry(1920, 1080, 'H1', { x: 1, y: 0 }).x, 6)
  })

  it('scales with the chosen size and shrinks a mark too large for a small picture', () => {
    const m = markGeometry(1920, 1080, 'H4')
    expect(markGeometry(1920, 1080, 'H4', undefined, 2).font).toBeCloseTo(m.font * 2, 6)
    expect(markGeometry(1920, 1080, 'H4', undefined, 0.6).font).toBeCloseTo(m.font * 0.6, 6)
    const tiny = markGeometry(120, 40, 'MN12?', { x: 1, y: 1 }, 2)
    expect(tiny.x).toBeGreaterThanOrEqual(4 - 1e-9)
    expect(tiny.x + tiny.width).toBeLessThanOrEqual(116 + 1e-9)
    expect(tiny.y + tiny.height).toBeLessThanOrEqual(36 + 1e-9)
  })

  it('turns a click on the mock chart into the position that centres the mark there', () => {
    expect(markPositionAt(1920, 1080, 'H1', 1, 960, 540)).toEqual({ x: 0.5, y: 0.5 })
    expect(markPositionAt(1920, 1080, 'H1', 1, 0, 0)).toEqual({ x: 0, y: 0 })
    expect(markPositionAt(1920, 1080, 'H1', 1, 1920, 1080)).toEqual({ x: 1, y: 1 })
    const p = markPositionAt(1920, 1080, 'H1', 1.4, 1500, 300)
    const g = markGeometry(1920, 1080, 'H1', p, 1.4)
    expect(Math.abs(g.x + g.width / 2 - 1500)).toBeLessThan(2)
    expect(Math.abs(g.y + g.height / 2 - 300)).toBeLessThan(2)
  })

  it('settings: defaults for older journals, invalid values fall back instead of failing the file', () => {
    const sc = settingsSchema.parse({}).screens
    expect(sc.timeframeMarkPos).toEqual({ x: 0, y: 0 })
    expect(sc.timeframeMarkSize).toBe(1)
    const bad = settingsSchema.parse({ screens: { timeframeMarkPos: { x: 3, y: 'a' }, timeframeMarkSize: -1 } }).screens
    expect(bad.timeframeMarkPos).toEqual({ x: 0, y: 0 })
    expect(bad.timeframeMarkSize).toBe(1)
    const set = settingsSchema.parse({ screens: { timeframeMarkPos: { x: 1, y: 0.25 }, timeframeMarkSize: 1.4 } }).screens
    expect(set.timeframeMarkPos).toEqual({ x: 1, y: 0.25 })
    expect(set.timeframeMarkSize).toBe(1.4)
  })
})
