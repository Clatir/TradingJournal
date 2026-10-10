/**
 * Geometry of the timeframe mark drawn over screens (SVG overlay and flattened copies). Everything is in image pixels,
 * so the mark scales with the picture; position and size come from the settings (Ustawienia → Screeny).
 */

/** The mark's place as fractions of the free room (0 = left / top edge, 1 = right / bottom edge): always fully inside. */
export interface MarkPosition {
  x: number
  y: number
}

export const DEFAULT_MARK_POSITION: MarkPosition = { x: 0, y: 0 }

/** Sizes to choose from (× the default text height, ~62 px on a 1920 px chart). */
export const MARK_SIZES = [
  { value: 0.6, label: 'S' },
  { value: 1, label: 'M' },
  { value: 1.4, label: 'L' },
  { value: 2, label: 'XL' }
] as const

export interface MarkGeometry {
  font: number
  pad: number
  x: number
  y: number
  width: number
  height: number
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0)

/** Distance kept from the picture's edges. */
function margins(w: number, h: number) {
  return { mx: Math.max(4, w * 0.006), my: Math.max(4, h * 0.008) }
}

function box(w: number, h: number, text: string, size: number) {
  const { mx, my } = margins(w, h)
  let font = Math.max(16, Math.min(w * 0.032, h * 0.06)) * (Number.isFinite(size) && size > 0 ? size : 1)
  const widthOf = (f: number) => text.length * f * 0.66 + f * 0.56
  const heightOf = (f: number) => f * 1.448
  // A large mark on a small picture: shrunk to fit inside it.
  const fit = Math.min((w - 2 * mx) / widthOf(1), (h - 2 * my) / heightOf(1))
  if (fit > 0) font = Math.min(font, fit)
  return { font, pad: font * 0.28, width: widthOf(font), height: heightOf(font), mx, my }
}

/** The mark's box and text size on a w × h picture. */
export function markGeometry(w: number, h: number, text: string, position: MarkPosition = DEFAULT_MARK_POSITION, size = 1): MarkGeometry {
  const b = box(w, h, text, size)
  const x = b.mx + clamp01(position.x) * Math.max(0, w - b.width - 2 * b.mx)
  const y = b.my + clamp01(position.y) * Math.max(0, h - b.height - 2 * b.my)
  return { font: b.font, pad: b.pad, x, y, width: b.width, height: b.height }
}

/**
 * The position that puts the mark's centre at (px, py) on a w × h picture (a click or drag on the settings' mock
 * chart), kept inside the picture. Rounded to 0.1% so the settings file stays readable.
 */
export function markPositionAt(w: number, h: number, text: string, size: number, px: number, py: number): MarkPosition {
  const b = box(w, h, text, size)
  const roomX = w - b.width - 2 * b.mx
  const roomY = h - b.height - 2 * b.my
  const fx = roomX > 0 ? (px - b.width / 2 - b.mx) / roomX : 0
  const fy = roomY > 0 ? (py - b.height / 2 - b.my) / roomY : 0
  const r = (v: number) => Math.round(clamp01(v) * 1000) / 1000
  return { x: r(fx), y: r(fy) }
}
