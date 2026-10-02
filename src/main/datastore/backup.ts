import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { DateTime } from 'luxon'
import { COLLECTIONS, JOURNAL_FILE, isIgnoredPath } from '@shared/paths'
import { zipFolder } from './zip'

export const DAILY_KEEP = 14
export const WEEKLY_KEEP = 4
export const MANUAL_KEEP = 5
const WEEK_MS = 7 * 24 * 3600 * 1000

export interface BackupFile {
  name: string
  path: string
  kind: 'daily' | 'weekly' | 'manual' | 'pre-migration'
  bytes: number
  mtimeMs: number
}

/** JSON records only (small, kept daily). */
export function isJsonRecord(rel: string): boolean {
  if (isIgnoredPath(rel)) return false
  if (rel === JOURNAL_FILE) return true
  return rel.endsWith('.json') && COLLECTIONS.some((c) => rel.startsWith(`${c}/`))
}

/** Everything that belongs to the journal (records + screens), without backups, presence and temp files. */
export function isJournalFile(rel: string): boolean {
  return !isIgnoredPath(rel)
}

async function list(dir: string): Promise<Array<{ name: string; path: string; mtimeMs: number; bytes: number }>> {
  let names: string[]
  try {
    names = await fs.readdir(dir)
  } catch {
    return []
  }
  const out = []
  for (const name of names.filter((n) => n.endsWith('.zip') && !n.startsWith('.'))) {
    try {
      const st = await fs.stat(join(dir, name))
      out.push({ name, path: join(dir, name), mtimeMs: st.mtimeMs, bytes: st.size })
    } catch {
      /* removed meanwhile */
    }
  }
  return out.sort((a, b) => (a.name < b.name ? 1 : -1))
}

async function rotate(dir: string, keep: number): Promise<void> {
  for (const old of (await list(dir)).slice(keep)) await fs.rm(old.path, { force: true })
}

/**
 * Startup backups: a daily ZIP of the JSON records (last 14 kept) and, when the newest full
 * backup is at least 7 days old, a full ZIP including screenshots (last 4 kept).
 */
export async function runBackups(root: string, backupsDir: string, now = new Date()): Promise<{ daily: string | null; weekly: string | null }> {
  const today = DateTime.fromJSDate(now).toISODate() as string
  const dailyDir = join(backupsDir, 'daily')
  const weeklyDir = join(backupsDir, 'weekly')
  let daily: string | null = null
  let weekly: string | null = null

  const dailyPath = join(dailyDir, `${today}_json.zip`)
  const existingDaily = await list(dailyDir)
  if (!existingDaily.some((f) => f.name === `${today}_json.zip`)) {
    await zipFolder(root, dailyPath, isJsonRecord)
    daily = dailyPath
    await rotate(dailyDir, DAILY_KEEP)
  }

  const weeklies = await list(weeklyDir)
  const newest = weeklies.reduce((m, f) => Math.max(m, f.mtimeMs), 0)
  if (!weeklies.length || now.getTime() - newest >= WEEK_MS) {
    const dt = DateTime.fromJSDate(now)
    const name = `${dt.weekYear}-W${String(dt.weekNumber).padStart(2, '0')}_full.zip`
    if (!weeklies.some((f) => f.name === name)) {
      weekly = join(weeklyDir, name)
      await zipFolder(root, weekly, isJournalFile)
      await rotate(weeklyDir, WEEKLY_KEEP)
    }
  }
  return { daily, weekly }
}

/** Full backup on demand (backups/manual, last 5 kept). */
export async function manualBackup(root: string, backupsDir: string, now = new Date()): Promise<string> {
  const dir = join(backupsDir, 'manual')
  const file = join(dir, `${DateTime.fromJSDate(now).toFormat("yyyy-LL-dd_HHmmss")}_full.zip`)
  await zipFolder(root, file, isJournalFile)
  await rotate(dir, MANUAL_KEEP)
  return file
}

export async function listBackups(backupsDir: string): Promise<BackupFile[]> {
  const out: BackupFile[] = []
  for (const kind of ['daily', 'weekly', 'manual', 'pre-migration'] as const) {
    for (const f of await list(join(backupsDir, kind))) out.push({ ...f, kind })
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs)
}
