import { createHash, randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, dirname, join } from 'node:path'

const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY', 'EMFILE'])

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Retry an fs operation that may transiently fail on Windows when OneDrive, an antivirus
 * or the indexer briefly locks a file.
 */
export async function withRetry<T>(op: () => Promise<T>, attempts = 8): Promise<T> {
  let delay = 15
  for (let i = 0; ; i++) {
    try {
      return await op()
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (i >= attempts - 1 || !code || !RETRYABLE.has(code)) throw e
      await sleep(delay)
      delay = Math.min(delay * 2, 500)
    }
  }
}

export function sha1(data: string | Uint8Array): string {
  return createHash('sha1').update(data).digest('hex')
}

/** Temp files are hidden (leading dot) and contain ".tmp-", so scanners and the watcher ignore them. */
export function tempPathFor(target: string): string {
  return join(dirname(target), `.${basename(target)}.tmp-${randomBytes(4).toString('hex')}`)
}

/**
 * Atomic write: write to a temp file in the same directory, fsync, then rename over the target.
 * A crash leaves either the old or the new file, never a truncated one.
 */
export async function writeFileAtomic(target: string, data: string | Uint8Array): Promise<void> {
  await fs.mkdir(dirname(target), { recursive: true })
  const tmp = tempPathFor(target)
  const handle = await fs.open(tmp, 'w')
  try {
    try {
      await handle.writeFile(data)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await withRetry(() => fs.rename(tmp, target))
  } catch (e) {
    // e.g. disk full or the target locked for too long: never leave a half-written temp file behind.
    await fs.rm(tmp, { force: true }).catch(() => undefined)
    throw e
  }
}

export async function removeFile(target: string): Promise<void> {
  await withRetry(() => fs.rm(target, { force: true }))
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}
