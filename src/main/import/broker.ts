import { promises as fs } from 'node:fs'
import { basename, extname } from 'node:path'
import yauzl from 'yauzl'
import type { BrokerFile } from '@shared/api'
import { xlsxDateStyles, xlsxSharedStrings, xlsxSheetRows, xlsxSheets } from '@shared/import/tables'

const MAX_FILE = 50 * 1024 * 1024
/** Uncompressed limit of one XLSX part (a damaged or hostile file must not fill the memory). */
const MAX_PART = 64 * 1024 * 1024

/** Text parts of a ZIP held in memory, by name; only the names `want` accepts. */
export function zipTextParts(buf: Buffer, want: (name: string) => boolean): Promise<Map<string, string>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buf, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(new Error(`Uszkodzony plik XLSX: ${String(err?.message ?? err)}`))
      const out = new Map<string, string>()
      let failed = false
      const fail = (e: unknown) => {
        if (failed) return
        failed = true
        try {
          if (zip.isOpen) zip.close()
        } catch {
          /* already closed */
        }
        reject(e instanceof Error ? e : new Error(String(e)))
      }
      zip.on('error', fail)
      zip.on('end', () => !failed && resolve(out))
      zip.on('entry', (entry: yauzl.Entry) => {
        if (!want(entry.fileName)) return zip.readEntry()
        if (entry.uncompressedSize > MAX_PART) return fail(new Error(`Część pliku XLSX jest za duża: ${entry.fileName}`))
        zip.openReadStream(entry, (e, stream) => {
          if (e || !stream) return fail(e ?? new Error('Błąd odczytu XLSX'))
          const chunks: Buffer[] = []
          let size = 0
          stream.on('data', (c: Buffer) => {
            size += c.length
            if (size > MAX_PART) {
              stream.destroy()
              fail(new Error(`Część pliku XLSX jest za duża: ${entry.fileName}`))
            } else chunks.push(c)
          })
          stream.on('error', fail)
          stream.on('end', () => {
            if (failed) return
            out.set(entry.fileName, Buffer.concat(chunks).toString('utf8'))
            zip.readEntry()
          })
        })
      })
      zip.readEntry()
    })
  })
}

/** Worksheets of an XLSX workbook as rows of text (dates as "YYYY-MM-DD HH:mm:ss"). */
export async function readXlsxSheets(buf: Buffer): Promise<Array<{ name: string; rows: string[][] }>> {
  const parts = await zipTextParts(buf, (n) => (n.startsWith('xl/') && n.endsWith('.xml')) || n === 'xl/_rels/workbook.xml.rels')
  const workbook = parts.get('xl/workbook.xml')
  const rels = parts.get('xl/_rels/workbook.xml.rels')
  if (!workbook || !rels) throw new Error('To nie jest skoroszyt XLSX (brak xl/workbook.xml).')
  const shared = xlsxSharedStrings(parts.get('xl/sharedStrings.xml') ?? '')
  const dates = xlsxDateStyles(parts.get('xl/styles.xml') ?? '')
  return xlsxSheets(workbook, rels).map((s) => ({ name: s.name, rows: xlsxSheetRows(parts.get(s.path) ?? '', shared, dates) }))
}

/** A broker's history file: XLSX → worksheets; anything else → bytes (decoded and parsed in the renderer). */
export async function readBrokerFile(file: string): Promise<BrokerFile> {
  const st = await fs.stat(file)
  if (st.size > MAX_FILE) throw new Error('Plik jest za duży (limit 50 MB).')
  const buf = await fs.readFile(file)
  const name = basename(file)
  const isZip = buf[0] === 0x50 && buf[1] === 0x4b
  if (isZip || extname(file).toLowerCase() === '.xlsx') return { name, sheets: await readXlsxSheets(buf), bytes: null }
  return { name, sheets: null, bytes: new Uint8Array(buf) }
}
