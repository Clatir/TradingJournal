import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'

let file: string | null = null

/** Minimal append-only log in the per-machine user data folder (logs/main.log, rotated at 1 MB). */
export function initLog(userDataDir: string): void {
  const dir = join(userDataDir, 'logs')
  mkdirSync(dir, { recursive: true })
  file = join(dir, 'main.log')
  try {
    if (statSync(file).size > 1024 * 1024) renameSync(file, join(dir, 'main.old.log'))
  } catch {
    /* no log yet */
  }
}

function describe(detail: unknown): string {
  if (detail instanceof Error) return detail.stack ?? detail.message
  try {
    return JSON.stringify(detail)
  } catch {
    return String(detail)
  }
}

export function log(level: 'info' | 'warn' | 'error', message: string, detail?: unknown): void {
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${message}${detail ? ` ${describe(detail)}` : ''}\n`
  if (level !== 'info') process.stderr.write(line)
  if (!file) return
  try {
    appendFileSync(file, line)
  } catch {
    /* logging must never break the app */
  }
}
