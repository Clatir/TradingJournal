import yazl from 'yazl'
import { xlsxParts, type XlsxSheet } from '@shared/export/xlsx'
import { writeFileAtomic } from '../datastore/atomic'

/** The workbook as a ZIP (XLSX) in memory. */
export async function xlsxBuffer(sheets: XlsxSheet[]): Promise<Buffer> {
  const zip = new yazl.ZipFile()
  const mtime = new Date()
  for (const part of xlsxParts(sheets)) zip.addBuffer(Buffer.from(part.content, 'utf8'), part.path, { mtime })
  zip.end()
  const chunks: Buffer[] = []
  for await (const chunk of zip.outputStream) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

/** Write an XLSX file atomically. */
export async function writeXlsx(file: string, sheets: XlsxSheet[]): Promise<void> {
  await writeFileAtomic(file, await xlsxBuffer(sheets))
}
