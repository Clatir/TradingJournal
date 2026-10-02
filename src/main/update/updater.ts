import { existsSync, promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  CHECKSUMS_ASSET,
  RELEASES_PAGE,
  UPDATE_REPO,
  expectedSha256,
  isNewerVersion,
  parseChecksums,
  parseRelease,
  pickAsset,
  type InstallMode,
  type PendingUpdate,
  type ReleaseInfo,
  type UpdatePrefs,
  type UpdateState
} from '@shared/update'
import type { PortableSwapParams } from './apply'
import { HttpError, downloadVerified, fetchJson, fetchText, sha256File, type FetchLike } from './download'

export interface UpdaterDeps {
  currentVersion: string
  mode: InstallMode
  modeNote: string | null
  /** Portable exe being updated (portable mode). */
  portableFile: string | null
  userDataDir: string
  fetch: FetchLike
  /** GitHub API base; a test server in E2E runs. */
  apiBase: string
  /** Allow plain http (only with an explicit test server). */
  allowInsecure: boolean
  prefs: () => UpdatePrefs
  savePrefs: (prefs: UpdatePrefs) => Promise<void>
  pending: () => PendingUpdate | null
  savePending: (pending: PendingUpdate | null) => Promise<void>
  /** Version that ran on this machine last time (to say "updated to …"). */
  lastRunVersion: () => string | null
  saveLastRunVersion: (version: string) => Promise<void>
  applyPortable: (p: PortableSwapParams) => void
  applyInstaller: (setupPath: string, restart: boolean) => void
  /** The app and (portable) its launcher: the swap waits for both to exit. */
  waitPids: number[]
  log: (level: 'info' | 'warn' | 'error', message: string, detail?: unknown) => void
  onState: (state: UpdateState) => void
  now?: () => Date
}

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

const NETWORK_ERROR =
  /net::ERR_|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|fetch failed|failed to fetch|terminated|other side closed|socket hang up|aborted/i

function describeError(e: unknown, during: 'check' | 'download' = 'check'): string {
  if (e instanceof HttpError) {
    if (e.status === 403 || e.status === 429) return 'GitHub chwilowo ogranicza liczbę zapytań – spróbuj ponownie za godzinę.'
    return `GitHub odpowiedział błędem ${e.status}.`
  }
  const err = e instanceof Error ? e : new Error(String(e))
  const text = `${err.message} ${(err.cause as { code?: string; message?: string } | undefined)?.code ?? ''} ${(err.cause as Error | undefined)?.message ?? ''}`
  if (NETWORK_ERROR.test(text))
    return during === 'download'
      ? 'Pobieranie przerwane – połączenie z GitHubem zostało zerwane. Spróbuję ponownie później.'
      : 'Brak połączenia z GitHubem (praca offline?). Spróbuję ponownie później.'
  return err.message
}

export class Updater {
  private state: UpdateState
  private latest: ReleaseInfo | null = null
  private restartAfterQuit = false
  private installPostponed = false
  private timers: Array<ReturnType<typeof setTimeout>> = []
  private lastProgressEmit = 0
  private downloading: Promise<void> | null = null

  constructor(private readonly deps: UpdaterDeps) {
    this.state = {
      phase: 'idle',
      currentVersion: deps.currentVersion,
      mode: deps.mode,
      modeNote: deps.modeNote,
      release: null,
      progress: null,
      error: null,
      lastCheckAt: null,
      justUpdated: null,
      prefs: deps.prefs()
    }
  }

  getState(): UpdateState {
    return { ...this.state, prefs: this.deps.prefs() }
  }

  private set(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch }
    this.deps.onState(this.getState())
  }

  private get updatesDir(): string {
    return join(this.deps.userDataDir, 'updates')
  }

  private stagedPathFor(assetName: string): string {
    return this.deps.mode === 'portable' && this.deps.portableFile ? `${this.deps.portableFile}.update` : join(this.updatesDir, assetName)
  }

  /** Startup: recognise a just-applied update, keep a pending one, remove leftovers. */
  async init(): Promise<void> {
    const { currentVersion } = this.deps
    const lastRun = this.deps.lastRunVersion()
    const pending = this.deps.pending()
    try {
      if (lastRun && isNewerVersion(currentVersion, lastRun)) {
        this.state.justUpdated = { version: currentVersion, notes: pending && pending.version === currentVersion ? pending.notes : '' }
        this.deps.log('info', `updated ${lastRun} -> ${currentVersion}`)
      }
    } catch {
      /* unparsable stored version */
    }
    if (lastRun !== currentVersion) await this.deps.saveLastRunVersion(currentVersion).catch(() => undefined)

    // A pending update of another copy of the app (installed vs portable, another portable file) is
    // left alone: it is not this copy's to install or remove.
    const ours =
      !!pending && pending.mode === this.deps.mode && (this.deps.mode !== 'portable' || pending.file === `${this.deps.portableFile}.update`)
    let keepFile = pending && !ours ? pending.file : null
    if (pending && ours) {
      let valid = false
      try {
        valid = isNewerVersion(pending.version, currentVersion) && existsSync(pending.file) && (await sha256File(pending.file)) === pending.sha256
      } catch {
        valid = false
      }
      if (valid) {
        keepFile = pending.file
        this.state.phase = 'ready'
        this.state.release = { version: pending.version, notes: pending.notes, publishedAt: null, htmlUrl: `${RELEASES_PAGE}/tag/v${pending.version}` }
      } else {
        // Installed already (or damaged): the record and the file are not needed any more.
        await fs.rm(pending.file, { force: true }).catch(() => undefined)
        await this.deps.savePending(null).catch(() => undefined)
      }
    }
    // Leftovers: the previous portable exe kept by an interrupted swap, unused downloads.
    if (this.deps.portableFile) {
      await fs.rm(`${this.deps.portableFile}.old`, { force: true }).catch(() => undefined)
      const staged = `${this.deps.portableFile}.update`
      if (staged !== keepFile) await fs.rm(staged, { force: true }).catch(() => undefined)
      await fs.rm(`${staged}.part`, { force: true }).catch(() => undefined) // closed while downloading
    }
    for (const name of await fs.readdir(this.updatesDir).catch(() => [] as string[])) {
      const file = join(this.updatesDir, name)
      if (file !== keepFile) await fs.rm(file, { recursive: true, force: true }).catch(() => undefined)
    }
    this.deps.onState(this.getState())
  }

  /** Periodic checks (startup delay, then every few hours) when enabled. */
  startAuto(firstDelayMs: number): void {
    this.stopAuto()
    if (!this.deps.prefs().autoCheck) return
    if (this.deps.mode === 'manual' && !this.deps.allowInsecure) return
    this.timers.push(setTimeout(() => void this.check(false), firstDelayMs))
    this.timers.push(setInterval(() => void this.check(false), CHECK_EVERY_MS))
  }

  stopAuto(): void {
    for (const t of this.timers) clearTimeout(t)
    this.timers = []
  }

  async check(userInitiated: boolean): Promise<UpdateState> {
    if (this.state.phase === 'checking' || this.state.phase === 'downloading') return this.getState()
    if (this.state.phase === 'ready' && !userInitiated) return this.getState()
    const previous = this.state.phase
    this.set({ phase: 'checking', error: null })
    try {
      const { owner, repo } = UPDATE_REPO
      const json = await fetchJson(this.deps.fetch, `${this.deps.apiBase}/repos/${owner}/${repo}/releases/latest`, {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': `ICT-Trade-Journal/${this.deps.currentVersion}`
      })
      const release = parseRelease(json)
      const lastCheckAt = (this.deps.now?.() ?? new Date()).toISOString()
      const info = { version: release.version, notes: release.notes, publishedAt: release.publishedAt, htmlUrl: release.htmlUrl }
      if (!isNewerVersion(release.version, this.deps.currentVersion)) {
        this.latest = null
        this.set({ phase: previous === 'ready' ? 'ready' : 'up-to-date', release: previous === 'ready' ? this.state.release : info, lastCheckAt })
        return this.getState()
      }
      this.latest = release
      const pending = this.deps.pending()
      if (previous === 'ready' && pending?.version === release.version) {
        this.set({ phase: 'ready', release: info, lastCheckAt })
        return this.getState()
      }
      this.set({ phase: 'available', release: info, lastCheckAt })
      this.deps.log('info', `update available ${release.version}`)
      if (this.deps.mode !== 'manual' && this.deps.prefs().autoDownload) void this.download().catch(() => undefined)
    } catch (e) {
      const lastCheckAt = (this.deps.now?.() ?? new Date()).toISOString()
      if (e instanceof HttpError && e.status === 404) {
        // No release published yet.
        this.set({ phase: 'up-to-date', release: null, lastCheckAt })
      } else {
        this.deps.log('warn', 'update check failed', e)
        this.set({ phase: previous === 'ready' ? 'ready' : 'error', error: describeError(e), lastCheckAt })
      }
    }
    return this.getState()
  }

  async download(): Promise<UpdateState> {
    if (this.downloading) {
      await this.downloading.catch(() => undefined)
      return this.getState()
    }
    this.downloading = this.doDownload().finally(() => {
      this.downloading = null
    })
    await this.downloading.catch(() => undefined)
    return this.getState()
  }

  private async doDownload(): Promise<void> {
    if (this.deps.mode === 'manual') {
      this.set({ phase: 'error', error: this.deps.modeNote ?? 'Tę kopię aplikacji trzeba zaktualizować ręcznie.' })
      return
    }
    if (!this.latest) {
      await this.check(true)
      if (!this.latest) return
    }
    const release = this.latest
    try {
      const asset = pickAsset(release, this.deps.mode)
      if (!asset) throw new Error(`Wydanie ${release.version} nie zawiera pliku dla tej wersji (${this.deps.mode === 'portable' ? 'portable' : 'instalator'}).`)
      for (const url of [asset.url, ...release.assets.filter((a) => a.name === CHECKSUMS_ASSET).map((a) => a.url)]) {
        if (!url.startsWith('https://') && !this.deps.allowInsecure) throw new Error('Odrzucono adres pobierania bez HTTPS.')
      }
      const sumsAsset = release.assets.find((a) => a.name === CHECKSUMS_ASSET)
      const sums = sumsAsset ? parseChecksums(await fetchText(this.deps.fetch, sumsAsset.url)) : null
      const sha256 = expectedSha256(asset, sums)
      const dest = this.stagedPathFor(asset.name)
      this.set({ phase: 'downloading', error: null, progress: { received: 0, total: asset.size } })
      const ready = existsSync(dest) && (await sha256File(dest)) === sha256
      if (!ready) {
        try {
          await fs.mkdir(dirname(dest), { recursive: true })
          await downloadVerified(this.deps.fetch, asset.url, dest, sha256, {
            expectedSize: asset.size,
            onProgress: (received, total) => {
              const now = Date.now()
              if (now - this.lastProgressEmit < 200 && received < total) return
              this.lastProgressEmit = now
              this.set({ progress: { received, total } })
            }
          })
        } catch (e) {
          const code = (e as NodeJS.ErrnoException).code
          if (this.deps.mode === 'portable' && (code === 'EACCES' || code === 'EPERM' || code === 'EROFS')) {
            throw new Error('Nie można zapisać nowej wersji obok pliku aplikacji (folder tylko do odczytu?). Pobierz ją ręcznie ze strony wydania.')
          }
          throw e
        }
      }
      await this.deps.savePending({ version: release.version, notes: release.notes, file: dest, sha256, mode: this.deps.mode })
      this.deps.log('info', `update ready ${release.version} (${dest})`)
      this.set({ phase: 'ready', progress: null, error: null })
    } catch (e) {
      this.deps.log('warn', 'update download failed', e)
      this.set({ phase: 'error', progress: null, error: describeError(e, 'download') })
    }
  }

  async setPrefs(patch: Partial<UpdatePrefs>, autoDelayMs: number): Promise<UpdateState> {
    const prev = this.deps.prefs()
    const next = { ...prev, ...patch }
    await this.deps.savePrefs(next)
    if (next.autoCheck !== prev.autoCheck) next.autoCheck ? this.startAuto(autoDelayMs) : this.stopAuto()
    if (next.autoDownload && !prev.autoDownload && this.state.phase === 'available' && this.deps.mode !== 'manual') void this.download()
    this.deps.onState(this.getState())
    return this.getState()
  }

  dismissNotice(): UpdateState {
    this.set({ justUpdated: null })
    return this.getState()
  }

  /** "Restart now": the app is about to quit; apply the update and start the new version. */
  requestRestart(): void {
    this.restartAfterQuit = true
  }

  /** Closing was cancelled (unsaved changes): a later normal close only installs, without restarting. */
  cancelRestart(): void {
    this.restartAfterQuit = false
  }

  get isReady(): boolean {
    return this.state.phase === 'ready'
  }

  /**
   * Windows is shutting down or logging off: the installer / swap helper could be killed half-way, so the
   * downloaded update waits for the next normal close.
   */
  postponeInstall(): void {
    this.installPostponed = true
  }

  /**
   * Called once while the app quits (after data was flushed and the folder closed). Starts the
   * installer / swap helper, which finish after this process has exited. Synchronous on purpose.
   */
  applyOnQuit(): boolean {
    this.stopAuto()
    if (this.state.phase !== 'ready') return false
    if (this.installPostponed) {
      this.deps.log('info', 'session ending - the update is installed at the next close')
      return false
    }
    const pending = this.deps.pending()
    if (!pending || !existsSync(pending.file)) return false
    try {
      if (this.deps.mode === 'portable' && this.deps.portableFile) {
        this.deps.applyPortable({
          target: this.deps.portableFile,
          staged: pending.file,
          waitPids: this.deps.waitPids,
          restart: this.restartAfterQuit,
          logFile: join(this.deps.userDataDir, 'logs', 'update.log')
        })
      } else if (this.deps.mode === 'installer') {
        this.deps.applyInstaller(pending.file, this.restartAfterQuit)
      } else {
        return false
      }
      this.deps.log('info', `installing update ${pending.version} (${this.deps.mode}, restart=${this.restartAfterQuit})`)
      return true
    } catch (e) {
      this.deps.log('error', 'starting the update failed', e)
      return false
    }
  }
}
