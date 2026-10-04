import yauzl from 'yauzl'
import { describe, expect, it } from 'vitest'
import { xlsxBuffer } from '../../src/main/export/xlsx'
import { simulateForecast } from '@shared/calc/forecast'
import { createForecast } from '@shared/defaults'
import { forecastCsv, forecastTable, forecastWorkbook } from '@shared/export/forecast'
import { columnName, escapeXml, safeSheetName, xlsxParts } from '@shared/export/xlsx'
import { forecastInputFrom } from '@shared/forecast-input'
import { newId } from '@shared/ids'
import { settingsSchema } from '@shared/schema'

/** Unzip a buffer with yauzl: path → text. */
function unzip(buf: Buffer): Promise<Map<string, string>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buf, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err)
      const out = new Map<string, string>()
      zip.on('entry', (entry: yauzl.Entry) => {
        zip.openReadStream(entry, (e, stream) => {
          if (e || !stream) return reject(e)
          const chunks: Buffer[] = []
          stream.on('data', (c: Buffer) => chunks.push(c))
          stream.on('end', () => {
            out.set(entry.fileName, Buffer.concat(chunks).toString('utf8'))
            zip.readEntry()
          })
        })
      })
      zip.on('end', () => resolve(out))
      zip.on('error', reject)
      zip.readEntry()
    })
  })
}

function scenario() {
  const f = createForecast({ accountCurrency: 'PLN', accountBalance: 10000 }, [], '2026-11-02T09:00:00.000Z')
  return {
    ...f,
    name: 'Plan <A&B>',
    payoutPercent: 10,
    monthlyDeposit: 2000,
    firstMonth: '2026-11',
    keep: 'cash' as const,
    pct: { mode: 'fixed' as const, fixed: 11, lo: 7, hi: 10 },
    goals: [
      { id: newId(), name: 'Auto "nowe"', month: 6, amount: 2000, enabled: true, flexible: false },
      { id: newId(), name: 'Cel 2', month: 12, amount: null, enabled: true, flexible: false }
    ]
  }
}

describe('XLSX (generator i plik ZIP)', () => {
  it('części skoroszytu, arkusze, nagłówek pogrubiony i zamrożony, formaty liczb, teksty inline', async () => {
    const f = scenario()
    const out = forecastInputFrom(f, settingsSchema.parse({}))
    if (!out.ok) throw new Error('no input')
    const sim = simulateForecast(out.input)
    const sheets = forecastWorkbook({ sim, scenario: f, input: out.input, settings: [['Scenariusz', f.name]] })
    const files = await unzip(await xlsxBuffer(sheets))
    expect([...files.keys()].sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
      'xl/worksheets/sheet2.xml',
      'xl/worksheets/sheet3.xml',
      'xl/worksheets/sheet4.xml'
    ])
    const workbook = files.get('xl/workbook.xml')!
    expect([...workbook.matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1])).toEqual(['Prognoza', 'Lata', 'Cele', 'Ustawienia'])
    expect(files.get('[Content_Types].xml')).toContain('/xl/worksheets/sheet4.xml')
    expect(files.get('xl/_rels/workbook.xml.rels')).toContain('Target="styles.xml"')
    expect(files.get('xl/styles.xml')).toContain('<numFmt numFmtId="164" formatCode="0.0000"/>')
    expect(files.get('xl/styles.xml')).toContain('<xf numFmtId="4"') // #,##0.00

    const months = files.get('xl/worksheets/sheet1.xml')!
    expect(months).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>')
    expect(months).toContain('<c r="A1" t="inlineStr" s="1"><is><t xml:space="preserve">Nr miesiąca</t></is></c>')
    expect(months).toContain('<c r="C1" t="inlineStr" s="1"><is><t xml:space="preserve">Zwrot [%]</t></is></c>')
    // row 2 = month 1: number of the month, label, return in percent (format 0.0000), amounts (#,##0.00)
    expect(months).toContain('<c r="A2" s="4"><v>1</v></c>')
    expect(months).toContain('<c r="B2" t="inlineStr"><is><t xml:space="preserve">11-2026</t></is></c>')
    expect(months).toContain('<c r="C2" s="3"><v>11</v></c>')
    expect(months).toContain('<c r="E2" s="2"><v>10000</v></c>')
    expect((months.match(/<row /g) ?? []).length).toBe(51)

    const goals = files.get('xl/worksheets/sheet3.xml')!
    expect(goals).toContain('Auto &quot;nowe&quot;')
    expect(goals).toContain('kupiony, 2 mies. po planie')
    const params = files.get('xl/worksheets/sheet4.xml')!
    expect(params).toContain('Plan &lt;A&amp;B&gt;')
    const years = files.get('xl/worksheets/sheet2.xml')!
    expect(years).toContain('<c r="A2" s="4"><v>2026</v></c>')
  })

  it('pomocnicze: litery kolumn, nazwy arkuszy, znaki specjalne', () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(columnName)).toEqual(['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA'])
    const taken = new Set<string>()
    expect(safeSheetName('Lata', taken)).toBe('Lata')
    expect(safeSheetName('lata', taken)).toBe('lata 2')
    expect(safeSheetName('a/b:c*?[x]', taken)).toBe('a b c   x')
    expect(safeSheetName('x'.repeat(40), taken)).toHaveLength(31)
    expect(escapeXml('a<b>&"c"\u0001')).toBe('a&lt;b&gt;&amp;&quot;c&quot;')
    const parts = xlsxParts([{ name: 'A', columns: [{ header: 'x', kind: 'money' }], rows: [[null], [Number.NaN], [1.5]] }])
    const sheet = parts.find((p) => p.path === 'xl/worksheets/sheet1.xml')!.content
    expect(sheet).toContain('<row r="2"></row><row r="3"></row><row r="4"><c r="A4" s="2"><v>1.5</v></c></row>')
  })

  it('CSV: średnik, BOM, CRLF, przecinek dziesiętny, teksty zabezpieczone', () => {
    const f = scenario()
    const out = forecastInputFrom(f, settingsSchema.parse({}))
    if (!out.ok) throw new Error('no input')
    const csv = forecastCsv(forecastTable(simulateForecast(out.input), f, out.input))
    expect(csv.startsWith('﻿Nr miesiąca;Miesiąc;Zwrot [%];Wpłata;Kapitał na początku;Zysk;Wypłata (10%);Odłożona gotówka;Cel zakupowy;Kwota na cel;Kapitał na koniec\r\n')).toBe(true)
    const lines = csv.split('\r\n')
    expect(lines[1]).toBe('1;11-2026;11,0000;0,00;10000,00;1100,00;110,00;110,00;;;10990,00')
    expect(lines[8]).toMatch(/^8;6-2027;11,0000;2000,00;.*;"Auto ""nowe""";2000,00;/)
    expect(csv.endsWith('\r\n')).toBe(true)
    expect(lines).toHaveLength(52)
  })
})
