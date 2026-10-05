/**
 * Turning broker export files into rows of cells: text decoding (UTF-8, UTF-16 with BOM, Windows-1250), CSV / TSV,
 * HTML tables (MT4 / MT5 reports) and XLSX worksheets (XTB). Pure; the main process only reads and unzips the file.
 */

export type Rows = string[][]

/** Bytes of a text file → string: BOM (UTF-8 / UTF-16 LE / BE), else UTF-8, else Windows-1250 (Polish Excel). */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3))
  // UTF-16 without BOM (rare): every other byte of ASCII text is 0.
  if (bytes.length >= 4 && bytes[1] === 0 && bytes[3] === 0 && bytes[0] !== 0) return new TextDecoder('utf-16le').decode(bytes)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    try {
      return new TextDecoder('windows-1250').decode(bytes)
    } catch {
      return new TextDecoder('latin1').decode(bytes)
    }
  }
}

export function looksLikeHtml(text: string): boolean {
  return /<\s*(table|tr|html)\b/i.test(text.slice(0, 200_000))
}

/** CSV / TSV with the separator guessed from the lines (tab, semicolon, comma); quotes as in RFC 4180. */
export function parseCsv(text: string): Rows {
  const body = text.replace(/^﻿/, '')
  const sample = body.split(/\r?\n/).slice(0, 50)
  const count = (ch: string) => sample.reduce((n, l) => n + (l.split(ch).length - 1), 0)
  const sep = ['\t', ';', ','].map((ch) => [ch, count(ch)] as const).sort((a, b) => b[1] - a[1])[0]![0]
  const rows: Rows = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!
    if (quoted) {
      if (ch === '"') {
        if (body[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += ch
      continue
    }
    if (ch === '"' && cell.trim() === '') {
      quoted = true
      cell = ''
    } else if (ch === sep) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && body[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.map((r) => r.map((c) => c.trim()))
}

const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

/**
 * Rows of every table row (<tr>) in an HTML document, in order: cell text without tags, entities decoded, whitespace
 * collapsed; a cell with colspan="n" is followed by n − 1 empty cells so the columns stay aligned; hidden cells
 * (class "hidden") are left out.
 */
export function htmlRows(html: string): Rows {
  const clean = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '')
  const rows: Rows = []
  for (const tr of clean.matchAll(/<tr\b[^>]*>([\s\S]*?)(?=<tr\b|<\/table|$)/gi)) {
    const cells: string[] = []
    for (const td of tr[1]!.matchAll(/<(td|th)\b([^>]*)>([\s\S]*?)(?=<td\b|<th\b|<\/tr|$)/gi)) {
      const attrs = td[2]!
      // Cells hidden by the report's stylesheet (MT5) are not shown, so they do not take a column either.
      if (/class\s*=\s*["']?[^"'>]*\bhidden\b/i.test(attrs)) continue
      const text = decodeEntities(td[3]!.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ''))
        .replace(/\s+/g, ' ')
        .trim()
      cells.push(text)
      const span = Number(/colspan\s*=\s*["']?(\d+)/i.exec(attrs)?.[1] ?? 1)
      for (let k = 1; k < Math.min(span, 50); k++) cells.push('')
    }
    if (cells.length) rows.push(cells)
  }
  return rows
}

/** Text of a file that is either an HTML report or a CSV / TSV. */
export function textRows(text: string): Rows {
  return looksLikeHtml(text) ? htmlRows(text) : parseCsv(text)
}

// ------------------------------------------------------------------ XLSX (SpreadsheetML)

const xmlText = (s: string) => decodeEntities(s.replace(/<[^>]*>/g, ''))

/** xl/sharedStrings.xml → strings (rich text runs joined). */
export function xlsxSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) =>
    [...m[1]!.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => xmlText(t[1]!)).join('')
  )
}

/** Column letters of a cell reference ("AB12") → 0-based index. */
function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A'
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

/** Number formats (built-in ids and custom codes) that show dates; styles.xml → indexes of date cell styles. */
export function xlsxDateStyles(stylesXml: string): Set<number> {
  const custom = new Map<number, string>()
  for (const m of stylesXml.matchAll(/<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) custom.set(Number(m[1]), decodeEntities(m[2]!))
  const isDate = (id: number) => {
    if ((id >= 14 && id <= 22) || (id >= 45 && id <= 47)) return true
    const code = custom.get(id)
    // y, d or h outside quotes / brackets (not "General", not a currency).
    return !!code && /[ydh]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]/g, ''))
  }
  const out = new Set<number>()
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] ?? ''
  let i = 0
  for (const m of xfs.matchAll(/<xf\b([^>]*)\/?>/g)) {
    const id = Number(/numFmtId="(\d+)"/.exec(m[1]!)?.[1] ?? 0)
    if (isDate(id)) out.add(i)
    i++
  }
  return out
}

/** Excel serial date (days since 1899-12-30, fraction = time) → "YYYY-MM-DD HH:mm:ss". */
export function excelSerialToText(serial: number): string {
  const ms = Math.round((serial - 25569) * 86_400_000)
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ')
}

/** A worksheet → rows; shared strings resolved, date-styled numbers written as "YYYY-MM-DD HH:mm:ss". */
export function xlsxSheetRows(sheetXml: string, shared: readonly string[], dateStyles: ReadonlySet<number> = new Set()): Rows {
  const rows: Rows = []
  for (const r of sheetXml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    // Excel leaves empty rows out; keep the numbering (row N = rows[N − 1]).
    const rowNo = Number(/\br="(\d+)"/.exec(r[1]!)?.[1] ?? 0)
    while (rowNo > 0 && rows.length < Math.min(rowNo - 1, 1_000_000)) rows.push([])
    const cells: string[] = []
    for (const c of r[2]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1]!
      const inner = c[2] ?? ''
      const ref = /\br="([A-Z]+)\d*"/.exec(attrs)?.[1]
      const idx = ref ? columnIndex(ref) : cells.length
      const type = /\bt="(\w+)"/.exec(attrs)?.[1]
      const style = Number(/\bs="(\d+)"/.exec(attrs)?.[1] ?? -1)
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1]
      let text = ''
      if (type === 's') text = shared[Number(v)] ?? ''
      else if (type === 'inlineStr') text = [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => xmlText(t[1]!)).join('')
      else if (v != null) {
        const raw = xmlText(v)
        text = type !== 'str' && dateStyles.has(style) && Number.isFinite(Number(raw)) ? excelSerialToText(Number(raw)) : raw
      }
      while (cells.length < idx) cells.push('')
      cells[idx] = text.trim()
    }
    rows.push(cells)
  }
  return rows
}

/** xl/workbook.xml + its rels → sheet names with their part paths (in workbook order). */
export function xlsxSheets(workbookXml: string, relsXml: string): Array<{ name: string; path: string }> {
  const targets = new Map<string, string>()
  for (const m of relsXml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[1]!)?.[1]
    const target = /\bTarget="([^"]+)"/.exec(m[1]!)?.[1]
    if (id && target) targets.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`)
  }
  const out: Array<{ name: string; path: string }> = []
  for (const m of workbookXml.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = decodeEntities(/\bname="([^"]*)"/.exec(m[1]!)?.[1] ?? '')
    const rid = /\br:id="([^"]+)"/.exec(m[1]!)?.[1]
    const path = rid ? targets.get(rid) : undefined
    if (path) out.push({ name, path })
  }
  return out
}
