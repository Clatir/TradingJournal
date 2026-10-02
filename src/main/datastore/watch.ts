import { watch, type FSWatcher } from 'node:fs'
import { isIgnoredPath, toPosix } from '@shared/paths'

export interface WatcherOptions {
  debounceMs?: number
  /** Safety-net full rescan interval (sync tools and network drives may not emit events). */
  pollMs?: number
  onError?: (e: unknown) => void
}

/**
 * Watches the data folder recursively. Calls `onChange(paths)` with relative paths after a debounce,
 * or `onChange(null)` when a full rescan is needed (overflow, periodic poll, watcher error).
 */
export class FolderWatcher {
  private watcher: FSWatcher | null = null
  private pending = new Set<string>()
  private full = false
  private timer: NodeJS.Timeout | null = null
  private poll: NodeJS.Timeout | null = null
  private restart: NodeJS.Timeout | null = null
  private readonly debounceMs: number
  private readonly pollMs: number
  private readonly onError?: (e: unknown) => void

  constructor(
    private readonly root: string,
    private readonly onChange: (paths: string[] | null) => void,
    opts: WatcherOptions = {}
  ) {
    this.debounceMs = opts.debounceMs ?? 300
    this.pollMs = opts.pollMs ?? 30_000
    this.onError = opts.onError
  }

  start(): void {
    this.attach()
    this.poll = setInterval(() => this.onChange(null), this.pollMs)
  }

  private attach(): void {
    try {
      this.watcher = watch(this.root, { recursive: true }, (_event, filename) => {
        if (!filename) {
          this.full = true
        } else {
          const rel = toPosix(filename.toString())
          if (isIgnoredPath(rel)) return
          this.pending.add(rel)
        }
        this.schedule()
      })
      this.watcher.on('error', (e) => {
        this.onError?.(e)
        this.reattachLater()
      })
    } catch (e) {
      this.onError?.(e)
      this.reattachLater()
    }
  }

  private reattachLater(): void {
    this.watcher?.close()
    this.watcher = null
    this.full = true
    this.schedule()
    if (this.restart) return
    this.restart = setTimeout(() => {
      this.restart = null
      this.attach()
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
    this.watcher?.close()
    this.watcher = null
    for (const t of [this.timer, this.restart]) if (t) clearTimeout(t)
    if (this.poll) clearInterval(this.poll)
    this.timer = this.restart = this.poll = null
  }
}
