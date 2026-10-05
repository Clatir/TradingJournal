import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import yazl from 'yazl'
import { describe, expect, it } from 'vitest'
import { readBrokerFile, readXlsxSheets } from '../../src/main/import/broker'
import { xlsxBuffer } from '../../src/main/export/xlsx'
import { parseBrokerSheets } from '../../src/shared/import/broker'

/** A workbook laid out like Excel writes it: shared strings, a date number format, two sheets. */
async function excelLikeXlsx(): Promise<Buffer> {
  const strings = ['ID', 'Type', 'Position', 'Symbol', 'Volume', 'Open time', 'Open price', 'Close time', 'Close price', 'Gross P/L', 'Currency', 'PLN', 'BUY', 'EURUSD', 'Commission', 'Rollover']
  const s = (text: string) => strings.indexOf(text)
  const str = (ref: string, text: string) => `<c r="${ref}" t="s"><v>${s(text)}</v></c>`
  const num = (ref: string, v: number, style = 0) => `<c r="${ref}"${style ? ` s="${style}"` : ''}><v>${v}</v></c>`
  const files: Record<string, string> = {
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    'xl/workbook.xml':
      '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="CASH OPERATION HISTORY" sheetId="1" r:id="rId1"/><sheet name="CLOSED POSITION HISTORY" sheetId="2" r:id="rId2"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="x" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="x" Target="sharedStrings.xml"/></Relationships>',
    'xl/sharedStrings.xml': `<?xml version="1.0"?><sst>${strings.map((t) => `<si><t>${t}</t></si>`).join('')}</sst>`,
    'xl/styles.xml':
      '<?xml version="1.0"?><styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="dd.mm.yyyy hh:mm:ss"/></numFmts><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164" applyNumberFormat="1"/></cellXfs></styleSheet>',
    'xl/worksheets/sheet1.xml': `<?xml version="1.0"?><worksheet><sheetData><row r="1">${str('A1', 'ID')}${str('B1', 'Type')}</row></sheetData></worksheet>`,
    'xl/worksheets/sheet2.xml':
      `<?xml version="1.0"?><worksheet><sheetData>` +
      `<row r="1">${str('A1', 'Currency')}${str('B1', 'PLN')}</row>` +
      `<row r="3">${['Position', 'Symbol', 'Type', 'Volume', 'Open time', 'Open price', 'Close time', 'Close price', 'Commission', 'Rollover', 'Gross P/L'].map((h, i) => str(`${String.fromCharCode(65 + i)}3`, h)).join('')}</row>` +
      `<row r="4">${num('A4', 900001)}${str('B4', 'EURUSD')}${str('C4', 'BUY')}${num('D4', 0.5)}${num('E4', 46300.5625, 1)}${num('F4', 1.085)}${num('G4', 46300.666666667, 1)}${num('H4', 1.087)}${num('I4', 0)}${num('J4', -0.5)}${num('K4', 385.4)}</row>` +
      `</sheetData></worksheet>`
  }
  const zip = new yazl.ZipFile()
  for (const [name, content] of Object.entries(files)) zip.addBuffer(Buffer.from(content, 'utf8'), name)
  zip.end()
  const chunks: Buffer[] = []
  for await (const c of zip.outputStream) chunks.push(c as Buffer)
  return Buffer.concat(chunks)
}

describe('historia od brokera: odczyt pliku (proces główny)', () => {
  it('XLSX jak z Excela: arkusze, wspólne teksty, daty ze stylu → pozycje XTB', async () => {
    const sheets = await readXlsxSheets(await excelLikeXlsx())
    expect(sheets.map((s) => s.name)).toEqual(['CASH OPERATION HISTORY', 'CLOSED POSITION HISTORY'])
    expect(sheets[1]!.rows[3]!.slice(0, 7)).toEqual(['900001', 'EURUSD', 'BUY', '0.5', '2026-10-05 13:30:00', '1.085', '2026-10-05 16:00:00'])
    const t = parseBrokerSheets(sheets)!
    expect(t).toMatchObject({ sheet: 'CLOSED POSITION HISTORY', format: 'xtb', currency: 'PLN' })
    expect(t.trades[0]).toMatchObject({ tickets: ['900001'], openTime: '2026-10-05T13:30:00', closeTime: '2026-10-05T16:00:00', net: 384.9 })
  })

  it('XLSX z wbudowanego eksportu (tekst w komórkach) i plik tekstowy jako bajty', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'ictj-broker-'))
    const xlsx = join(dir, 'historia.xlsx')
    await fs.writeFile(
      xlsx,
      await xlsxBuffer([
        {
          name: 'Pozycje',
          columns: ['Symbol', 'Typ', 'Wolumen', 'Czas otwarcia', 'Cena otwarcia', 'Czas zamknięcia', 'Cena zamknięcia', 'Zysk'].map((header) => ({ header, kind: 'text' as const })),
          rows: [['EURUSD', 'buy', '0.1', '2026.10.05 15:30', '1.085', '2026.10.05 16:00', '1.086', '10']]
        }
      ])
    )
    const file = await readBrokerFile(xlsx)
    expect(file.name).toBe('historia.xlsx')
    expect(file.bytes).toBeNull()
    expect(parseBrokerSheets(file.sheets!)!.trades[0]).toMatchObject({ symbol: 'EURUSD', net: 10 })

    const csv = join(dir, 'historia.csv')
    await fs.writeFile(csv, 'a;b\n')
    const text = await readBrokerFile(csv)
    expect(text.sheets).toBeNull()
    expect(new TextDecoder().decode(text.bytes!)).toBe('a;b\n')
  })

  it('uszkodzony XLSX: czytelny błąd', async () => {
    await expect(readXlsxSheets(Buffer.from('PK\u0003\u0004 to nie jest zip'))).rejects.toThrow(/Uszkodzony plik XLSX/)
    const zip = new yazl.ZipFile()
    zip.addBuffer(Buffer.from('x'), 'readme.txt')
    zip.end()
    const chunks: Buffer[] = []
    for await (const c of zip.outputStream) chunks.push(c as Buffer)
    await expect(readXlsxSheets(Buffer.concat(chunks))).rejects.toThrow(/brak xl\/workbook.xml/)
  })
})
