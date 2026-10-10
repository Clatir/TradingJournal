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

/** The note under a mark whose timeframe was read from the chart's legend (not set by hand). */
export const OCR_NOTE = 'rozpoznano przy pomocy OCR'

export interface MarkGeometry {
  font: number
  pad: number
  /** The timeframe's box. */
  x: number
  y: number
  width: number
  height: number
  /** The note's strip under the box (null without a note): text size and box, the text's baseline. */
  note: { font: number; x: number; y: number; width: number; height: number; baseline: number } | null
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0)

/** Distance kept from the picture's edges. */
function margins(w: number, h: number) {
  return { mx: Math.max(4, w * 0.006), my: Math.max(4, h * 0.008) }
}

/**
 * Sizes of the box and the note, all proportional to the text size (monospaced font: 0.6 em per character for the
 * note, the timeframe's bold glyphs ~0.66 em). The whole (box + note) is what has to fit in the picture.
 */
function box(w: number, h: number, text: string, size: number, note: string | null) {
  const { mx, my } = margins(w, h)
  let font = Math.max(16, Math.min(w * 0.032, h * 0.06)) * (Number.isFinite(size) && size > 0 ? size : 1)
  const NOTE = 0.27
  const widthOf = (f: number) => text.length * f * 0.66 + f * 0.56
  const heightOf = (f: number) => f * 1.448
  const noteWidthOf = (f: number) => (note ? note.length * f * NOTE * 0.6 + f * NOTE * 0.9 : 0)
  const noteHeightOf = (f: number) => (note ? f * NOTE * 1.55 : 0)
  const totalW = (f: number) => Math.max(widthOf(f), noteWidthOf(f))
  const totalH = (f: number) => heightOf(f) + noteHeightOf(f)
  // A large mark on a small picture: shrunk to fit inside it.
  const fit = Math.min((w - 2 * mx) / totalW(1), (h - 2 * my) / totalH(1))
  if (fit > 0) font = Math.min(font, fit)
  return {
    font,
    pad: font * 0.28,
    width: widthOf(font),
    height: heightOf(font),
    noteFont: font * NOTE,
    noteWidth: noteWidthOf(font),
    noteHeight: noteHeightOf(font),
    totalW: totalW(font),
    totalH: totalH(font),
    mx,
    my
  }
}

/** The mark's box and text size on a w × h picture; `note` adds a line under the box (kept inside with it). */
export function markGeometry(
  w: number,
  h: number,
  text: string,
  position: MarkPosition = DEFAULT_MARK_POSITION,
  size = 1,
  note: string | null = null
): MarkGeometry {
  const b = box(w, h, text, size, note)
  const left = b.mx + clamp01(position.x) * Math.max(0, w - b.totalW - 2 * b.mx)
  const y = b.my + clamp01(position.y) * Math.max(0, h - b.totalH - 2 * b.my)
  // Against the right edge the box and its note line up on the right, elsewhere on the left.
  const right = clamp01(position.x) > 0.5
  const x = right ? left + b.totalW - b.width : left
  const noteX = right ? left + b.totalW - b.noteWidth : left
  return {
    font: b.font,
    pad: b.pad,
    x,
    y,
    width: b.width,
    height: b.height,
    note: note
      ? { font: b.noteFont, x: noteX, y: y + b.height, width: b.noteWidth, height: b.noteHeight, baseline: y + b.height + b.noteHeight * 0.7 }
      : null
  }
}

/**
 * The position that puts the mark's centre at (px, py) on a w × h picture (a click or drag on the settings' mock
 * chart), kept inside the picture. Rounded to 0.1% so the settings file stays readable.
 */
export function markPositionAt(w: number, h: number, text: string, size: number, px: number, py: number, note: string | null = null): MarkPosition {
  const b = box(w, h, text, size, note)
  const roomX = w - b.totalW - 2 * b.mx
  const roomY = h - b.totalH - 2 * b.my
  const fx = roomX > 0 ? (px - b.totalW / 2 - b.mx) / roomX : 0
  const fy = roomY > 0 ? (py - b.totalH / 2 - b.my) / roomY : 0
  const r = (v: number) => Math.round(clamp01(v) * 1000) / 1000
  return { x: r(fx), y: r(fy) }
}
