import { promises as fs, watch, type FSWatcher } from 'node:fs'
import { join, relative } from 'node:path'
import { isIgnoredPath, toPosix } from '@shared/paths'

export interface WatcherOptions {
  debounceMs?: number
  /** Safety-net full rescan interval (sync tools and network drives may not emit events). */
  pollMs?: number
  onError?: (e: unknown) => void
  /**
   * 'native' = fs.watch({recursive}) (Windows ReadDirectoryChangesW, macOS FSEvents).
   * 'per-directory' = one non-recursive watcher per directory. Used on Linux, where Node's emulated
   * recursive watcher tracks file inodes and misses edits after an atomic rename replaced the file.
   */
  mode?: 'native' | 'per-directory'
}

/**
 * Watches the data folder recursively. Calls `onChange(paths)` with relative paths after a debounce,
 * or `onChange(null)` when a full rescan is needed (periodic poll, watcher error, unknown event).
 */
export class FolderWatcher {
  private native: FSWatcher | null = null
  private dirWatchers = new Map<string, FSWatcher>()
  private pending = new Set<string>()
  private full = false
  private stopped = false
  private timer: NodeJS.Timeout | null = null
  private poll: NodeJS.Timeout | null = null
  private restart: NodeJS.Timeout | null = null
  private readonly debounceMs: number
  private readonly pollMs: number
  private readonly onError?: (e: unknown) => void
  readonly mode: 'native' | 'per-directory'

  constructor(
    private readonly root: string,
    private readonly onChange: (paths: string[] | null) => void,
    opts: WatcherOptions = {}
  ) {
    this.debounceMs = opts.debounceMs ?? 300
    this.pollMs = opts.pollMs ?? 30_000
    this.onError = opts.onError
    this.mode = opts.mode ?? (process.platform === 'win32' || process.platform === 'darwin' ? 'native' : 'per-directory')
  }

  start(): void {
    this.stopped = false
    if (this.mode === 'native') this.attachNative()
    else void this.watchTree(this.root)
    this.poll = setInterval(() => this.onChange(null), this.pollMs)
  }

  /** Resolves once per-directory watchers for the existing tree are attached (tests). */
  async ready(): Promise<void> {
    if (this.mode === 'per-directory') await this.watchTree(this.root)
  }

  private record(rel: string): void {
    if (isIgnoredPath(rel)) return
    this.pending.add(rel)
    this.schedule()
  }

  private attachNative(): void {
    try {
      this.native = watch(this.root, { recursive: true }, (_event, filename) => {
        if (!filename) {
          this.full = true
          this.schedule()
        } else this.record(toPosix(filename.toString()))
      })
      this.native.on('error', (e) => this.failed(e))
    } catch (e) {
      this.failed(e)
    }
  }

  private async watchTree(dir: string): Promise<void> {
    if (this.stopped) return
    const rel = toPosix(relative(this.root, dir))
    if (rel && isIgnoredPath(rel)) return
    if (!this.dirWatchers.has(dir)) {
      try {
        const w = watch(dir, (_event, filename) => {
          if (!filename) {
            this.full = true
            this.schedule()
            return
          }
          const childAbs = join(dir, filename.toString())
          const childRel = toPosix(relative(this.root, childAbs))
          this.record(childRel)
          // A new subdirectory needs its own watcher.
          void fs
            .stat(childAbs)
            .then((st) => (st.isDirectory() ? this.watchTree(childAbs) : undefined))
            .catch(() => this.unwatch(childAbs))
        })
        w.on('error', () => this.unwatch(dir))
        this.dirWatchers.set(dir, w)
      } catch (e) {
        if (dir === this.root) this.failed(e)
        return
      }
    }
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    await Promise.all(entries.filter((e) => e.isDirectory()).map((e) => this.watchTree(join(dir, e.name))))
  }

  private unwatch(dir: string): void {
    for (const [d, w] of this.dirWatchers) {
      if (d === dir || d.startsWith(`${dir}/`) || d.startsWith(`${dir}\\`)) {
        w.close()
        this.dirWatchers.delete(d)
      }
    }
    if (dir === this.root) this.failed(new Error('root watcher closed'))
  }

  private failed(e: unknown): void {
    this.onError?.(e)
    this.native?.close()
    this.native = null
    for (const w of this.dirWatchers.values()) w.close()
    this.dirWatchers.clear()
    this.full = true
    this.schedule()
    if (this.restart || this.stopped) return
    this.restart = setTimeout(() => {
      this.restart = null
      if (this.stopped) return
      if (this.mode === 'native') this.attachNative()
      else void this.watchTree(this.root)
    }, 5000)
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      const paths = this.full ? null : [...this.pending]
      this.pending.clear()
      this.full = false
      if (paths && paths.length === 0) return
      this.onChange(paths)
    }, this.debounceMs)
  }

  stop(): void {
    this.stopped = true
    this.native?.close()
    this.native = null
    for (const w of this.dirWatchers.values()) w.close()
    this.dirWatchers.clear()
    for (const t of [this.timer, this.restart]) if (t) clearTimeout(t)
    if (this.poll) clearInterval(this.poll)
    this.timer = this.restart = this.poll = null
  }
}
