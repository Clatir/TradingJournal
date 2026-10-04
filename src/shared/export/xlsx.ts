/**
 * Minimal XLSX (SpreadsheetML) generator: the XML parts of a workbook, to be zipped by the main process
 * with yazl (no extra dependency). Texts are inline strings; numbers keep full precision with a display format.
 */

export type XlsxKind = 'text' | 'int' | 'money' | 'pct' | 'number'
export type XlsxCell = string | number | null

export interface XlsxColumn {
  header: string
  kind: XlsxKind
  /** Width in characters. */
  width?: number
}

export interface XlsxSheet {
  /** At most 31 characters, without : \ / ? * [ ]. */
  name: string
  columns: XlsxColumn[]
  rows: XlsxCell[][]
  /** Bold header row frozen at the top. */
  freezeHeader?: boolean
}

export interface XlsxPart {
  path: string
  content: string
}

/** Style ids in styles.xml: 0 default, 1 bold header, 2 money, 3 return in percent (4 places), 4 whole number, 5 number. */
const STYLE: Record<XlsxKind, number> = { text: 0, money: 2, pct: 3, int: 4, number: 5 }

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'

export function escapeXml(s: string): string {
  // Characters not allowed in XML 1.0 are dropped.
  return s
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Column letters: 0 → A, 25 → Z, 26 → AA. */
export function columnName(index: number): string {
  let n = index + 1
  let out = ''
  while (n > 0) {
    const r = (n - 1) % 26
    out = String.fromCharCode(65 + r) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

export function safeSheetName(name: string, taken: Set<string>): string {
  const base = (name.replace(/[:\\/?*[\]]/g, ' ').trim() || 'Arkusz').slice(0, 31)
  let candidate = base
  for (let i = 2; taken.has(candidate.toLowerCase()); i++) candidate = `${base.slice(0, 31 - String(i).length - 1)} ${i}`
  taken.add(candidate.toLowerCase())
  return candidate
}

function cellXml(ref: string, v: XlsxCell, style: number): string {
  if (v == null || v === '') return ''
  if (typeof v === 'number') return Number.isFinite(v) ? `<c r="${ref}" s="${style}"><v>${v}</v></c>` : ''
  return `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${escapeXml(v)}</t></is></c>`
}

function sheetXml(sheet: XlsxSheet): string {
  const cols = sheet.columns
    .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? Math.max(10, Math.min(40, c.header.length + 2))}" customWidth="1"/>`)
    .join('')
  const header = `<row r="1">${sheet.columns.map((c, i) => cellXml(`${columnName(i)}1`, c.header, 1)).join('')}</row>`
  const rows = sheet.rows
    .map((r, ri) => `<row r="${ri + 2}">${r.map((v, ci) => cellXml(`${columnName(ci)}${ri + 2}`, v, STYLE[sheet.columns[ci]?.kind ?? 'text'])).join('')}</row>`)
    .join('')
  const views = sheet.freezeHeader
    ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>'
    : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>'
  return (
    `${XML_HEADER}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `${views}<sheetFormatPr defaultRowHeight="15"/>${cols ? `<cols>${cols}</cols>` : ''}<sheetData>${header}${rows}</sheetData></worksheet>`
  )
}

const STYLES =
  `${XML_HEADER}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  '<numFmts count="1"><numFmt numFmtId="164" formatCode="0.0000"/></numFmts>' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="6">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'

/** All parts of the workbook (paths inside the ZIP). */
export function xlsxParts(sheets: XlsxSheet[]): XlsxPart[] {
  const taken = new Set<string>()
  const named = sheets.map((s) => ({ ...s, name: safeSheetName(s.name, taken) }))
  const sheetEntries = named.map((s, i) => `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
  return [
    {
      path: '[Content_Types].xml',
      content:
        `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        named.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
        '</Types>'
    },
    {
      path: '_rels/.rels',
      content:
        `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
    },
    {
      path: 'xl/workbook.xml',
      content:
        `${XML_HEADER}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets>${sheetEntries}</sheets></workbook>`
    },
    {
      path: 'xl/_rels/workbook.xml.rels',
      content:
        `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        named.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
        `<Relationship Id="rId${named.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
    },
    { path: 'xl/styles.xml', content: STYLES },
    ...named.map((s, i) => ({ path: `xl/worksheets/sheet${i + 1}.xml`, content: sheetXml(s) }))
  ]
}
