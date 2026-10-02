import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { PRESENCE_DIR } from '@shared/paths'
import { writeFileAtomic } from './atomic'

/** A machine counts as "active" if it refreshed its heartbeat within this window. */
export const PRESENCE_WINDOW_MS = 3 * 60 * 1000

export function safeMachineName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'KOMPUTER'
}

export async function writePresence(root: string, machine: string, appVersion: string): Promise<void> {
  const file = join(root, PRESENCE_DIR, `${safeMachineName(machine)}.json`)
  await writeFileAtomic(file, `${JSON.stringify({ machine, lastSeen: new Date().toISOString(), appVersion }, null, 2)}\n`)
}

export async function clearPresence(root: string, machine: string): Promise<void> {
  await fs.rm(join(root, PRESENCE_DIR, `${safeMachineName(machine)}.json`), { force: true })
}

export async function readOtherMachines(root: string, machine: string, now = Date.now()): Promise<Array<{ machine: string; lastSeen: string }>> {
  const dir = join(root, PRESENCE_DIR)
  let names: string[]
  try {
    names = await fs.readdir(dir)
  } catch {
    return []
  }
  const self = `${safeMachineName(machine)}.json`
  const out: Array<{ machine: string; lastSeen: string }> = []
  for (const name of names) {
    if (!name.endsWith('.json') || name === self || name.includes('.tmp-')) continue
    try {
      const data = JSON.parse(await fs.readFile(join(dir, name), 'utf8')) as { machine?: string; lastSeen?: string }
      if (!data.lastSeen) continue
      const age = now - Date.parse(data.lastSeen)
      if (age >= 0 && age < PRESENCE_WINDOW_MS) out.push({ machine: data.machine ?? name.replace(/\.json$/, ''), lastSeen: data.lastSeen })
    } catch {
      /* partially synced file */
    }
  }
  return out
}
