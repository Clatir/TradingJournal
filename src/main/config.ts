import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { MachineConfig } from '@shared/api'
import { writeFileAtomic } from './datastore/atomic'

/** Per-machine settings (never synced): stored in %APPDATA%/ICT Trade Journal/config.json. */
const DEFAULTS: MachineConfig = {
  dataDir: null,
  lastRealDir: null,
  recentDirs: [],
  sampleMode: false,
  backupDirOverride: null,
  window: null
}

export class ConfigStore {
  private config: MachineConfig = { ...DEFAULTS }
  constructor(private readonly userDataDir: string) {}

  get file(): string {
    return join(this.userDataDir, 'config.json')
  }

  async load(): Promise<MachineConfig> {
    try {
      const raw = JSON.parse(await fs.readFile(this.file, 'utf8')) as Partial<MachineConfig>
      this.config = { ...DEFAULTS, ...raw, recentDirs: Array.isArray(raw.recentDirs) ? raw.recentDirs.slice(0, 8) : [] }
    } catch {
      this.config = { ...DEFAULTS }
    }
    return this.config
  }

  get(): MachineConfig {
    return this.config
  }

  async update(patch: Partial<MachineConfig>): Promise<MachineConfig> {
    this.config = { ...this.config, ...patch }
    await fs.mkdir(this.userDataDir, { recursive: true })
    await writeFileAtomic(this.file, `${JSON.stringify(this.config, null, 2)}\n`)
    return this.config
  }

  async rememberDir(dir: string, isSample = false): Promise<void> {
    if (isSample) {
      await this.update({ dataDir: dir })
      return
    }
    const recentDirs = [dir, ...this.config.recentDirs.filter((d) => d !== dir)].slice(0, 8)
    await this.update({ dataDir: dir, lastRealDir: dir, recentDirs })
  }
}
