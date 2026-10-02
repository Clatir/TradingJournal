import { createWriteStream, promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import yazl from 'yazl'
import { withRetry, tempPathFor } from './atomic'
import { walkFiles } from './fsutil'

export interface ZipResult {
  files: number
  bytes: number
}

/**
 * Zip files under `root` (relative paths accepted by `include`) into `outFile`, atomically.
 * Already-compressed images are stored without recompression.
 */
export async function zipFolder(root: string, outFile: string, include: (rel: string) => boolean): Promise<ZipResult> {
  const rels = (await walkFiles(root, root)).filter(include).sort()
  await fs.mkdir(dirname(outFile), { recursive: true })
  const tmp = tempPathFor(outFile)
  const zip = new yazl.ZipFile()
  for (const rel of rels) {
    const compress = !/\.(webp|png|jpe?g|zip)$/i.test(rel)
    zip.addFile(join(root, rel), rel, { compress })
  }
  zip.end()
  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(tmp)
    zip.outputStream.pipe(out)
    out.on('close', () => resolve())
    out.on('error', reject)
    zip.outputStream.on('error', reject)
  })
  await withRetry(() => fs.rename(tmp, outFile))
  const st = await fs.stat(outFile)
  return { files: rels.length, bytes: st.size }
}
