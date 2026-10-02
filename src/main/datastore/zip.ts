import { createWriteStream, promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import yazl from 'yazl'
import { withRetry, tempPathFor } from './atomic'
import { walkFiles } from './fsutil'

export interface ZipResult {
  files: number
  bytes: number
}

async function writeZip(root: string, rels: string[], tmp: string): Promise<void> {
  const zip = new yazl.ZipFile()
  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(tmp)
    let failed = false
    const fail = (e: unknown) => {
      if (failed) return
      failed = true
      // Release the file handle before the caller removes the temp file (Windows would refuse).
      if (out.closed) reject(e)
      else {
        out.once('close', () => reject(e))
        out.destroy()
      }
    }
    // yazl reports unreadable / vanished source files on the ZipFile itself, not on its output stream.
    zip.on('error', fail)
    zip.outputStream.on('error', fail)
    out.on('error', fail)
    out.on('close', () => {
      if (!failed) resolve()
    })
    zip.outputStream.pipe(out)
    for (const rel of rels) {
      const compress = !/\.(webp|png|jpe?g|zip)$/i.test(rel)
      zip.addFile(join(root, ...rel.split('/')), rel, { compress })
    }
    zip.end()
  })
}

/**
 * Zip files under `root` (relative paths accepted by `include`) into `outFile`, atomically.
 * Already-compressed images are stored without recompression. A file that disappears or is locked
 * while zipping (sync tools, the app renaming a record) fails the attempt; it is retried once with a
 * fresh listing before giving up.
 */
export async function zipFolder(root: string, outFile: string, include: (rel: string) => boolean): Promise<ZipResult> {
  await fs.mkdir(dirname(outFile), { recursive: true })
  for (let attempt = 1; ; attempt++) {
    const rels = (await walkFiles(root, root)).filter(include).sort()
    const tmp = tempPathFor(outFile)
    try {
      await writeZip(root, rels, tmp)
      await withRetry(() => fs.rename(tmp, outFile))
      const st = await fs.stat(outFile)
      return { files: rels.length, bytes: st.size }
    } catch (e) {
      await fs.rm(tmp, { force: true }).catch(() => undefined)
      if (attempt >= 2) throw e
    }
  }
}
