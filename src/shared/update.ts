/**
 * Updates from GitHub Releases: pure parts shared by the main process and tests.
 * The release workflow publishes the portable exe (stable file name, replaced in place), the NSIS
 * installer and SHA256SUMS.txt; GitHub also reports a sha256 digest for every asset.
 */
import { z } from 'zod'

export const UPDATE_REPO = { owner: 'Clatir', repo: 'TradingJournal' } as const
export const GITHUB_API = 'https://api.github.com'
export const RELEASES_PAGE = `https://github.com/${UPDATE_REPO.owner}/${UPDATE_REPO.repo}/releases`
/** Portable build keeps one file name across versions, so shortcuts keep working after an update. */
export const PORTABLE_ASSET = 'ICT-Trade-Journal-portable.exe'
export const CHECKSUMS_ASSET = 'SHA256SUMS.txt'

/** How this copy of the app can be updated. */
export type InstallMode = 'portable' | 'installer' | 'manual'

export interface ReleaseAsset {
  name: string
  size: number
  url: string
  /** sha256 hex reported by GitHub (asset "digest"), when present. */
  sha256: string | null
}

export interface ReleaseInfo {
  version: string
  tag: string
  name: string
  notes: string
  publishedAt: string | null
  htmlUrl: string
  assets: ReleaseAsset[]
}

export interface UpdatePrefs {
  /** Check GitHub at startup and every few hours. */
  autoCheck: boolean
  /** Download a found update in the background; it is installed when the app closes. */
  autoDownload: boolean
}

export const DEFAULT_UPDATE_PREFS: UpdatePrefs = { autoCheck: true, autoDownload: true }

/** A downloaded, verified update waiting to be installed when the app closes (persisted per machine). */
export interface PendingUpdate {
  version: string
  notes: string
  file: string
  sha256: string
  mode: InstallMode
}

export type UpdatePhase = 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'ready' | 'error'

export interface UpdateState {
  phase: UpdatePhase
  currentVersion: string
  mode: InstallMode
  /** Why updates have to be installed by hand (manual mode). */
  modeNote: string | null
  release: { version: string; notes: string; publishedAt: string | null; htmlUrl: string } | null
  progress: { received: number; total: number } | null
  error: string | null
  lastCheckAt: string | null
  /** Shown once after the app was updated. */
  justUpdated: { version: string; notes: string } | null
  prefs: UpdatePrefs
}

// ---------------------------------------------------------------- versions

export interface Version {
  major: number
  minor: number
  patch: number
  pre: string[]
}

export function parseVersion(text: string): Version | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(text.trim())
  if (!m) return null
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ? m[4].split('.') : [] }
}

/** Semantic-version precedence: negative when a < b, 0 when equal, positive when a > b. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a)
  const y = parseVersion(b)
  if (!x || !y) throw new Error(`Nieprawidłowy numer wersji: ${!x ? a : b}`)
  for (const k of ['major', 'minor', 'patch'] as const) if (x[k] !== y[k]) return x[k] - y[k]
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length // a release outranks its pre-releases
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i]
    const q = y.pre[i]
    if (p === undefined) return -1
    if (q === undefined) return 1
    if (p === q) continue
    const pn = /^\d+$/.test(p)
    const qn = /^\d+$/.test(q)
    if (pn && qn) return Number(p) - Number(q)
    if (pn !== qn) return pn ? -1 : 1
    return p < q ? -1 : 1
  }
  return 0
}

export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0
}

// ---------------------------------------------------------------- GitHub release

const assetSchema = z.looseObject({
  name: z.string().min(1),
  size: z.number().nonnegative(),
  browser_download_url: z.string().min(1),
  digest: z.string().nullable().optional()
})

const releaseSchema = z.looseObject({
  tag_name: z.string().min(1),
  name: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
  published_at: z.string().nullable().optional(),
  html_url: z.string().min(1),
  draft: z.boolean().optional(),
  prerelease: z.boolean().optional(),
  assets: z.array(assetSchema)
})

/** Validate the GitHub API answer for /releases/latest. Throws a readable error. */
export function parseRelease(json: unknown): ReleaseInfo {
  const r = releaseSchema.safeParse(json)
  if (!r.success) throw new Error('Nieoczekiwana odpowiedź GitHub (brak danych wydania).')
  const v = parseVersion(r.data.tag_name)
  if (!v) throw new Error(`Wydanie ${r.data.tag_name} nie ma numeru wersji w formacie 1.2.3.`)
  const version = r.data.tag_name.trim().replace(/^v/, '')
  return {
    version,
    tag: r.data.tag_name,
    name: r.data.name?.trim() || `Wersja ${version}`,
    notes: (r.data.body ?? '').replace(/\r\n/g, '\n').trim(),
    publishedAt: r.data.published_at ?? null,
    htmlUrl: r.data.html_url,
    assets: r.data.assets.map((a) => ({
      name: a.name,
      size: a.size,
      url: a.browser_download_url,
      sha256: a.digest && /^sha256:[0-9a-f]{64}$/i.test(a.digest) ? a.digest.slice(7).toLowerCase() : null
    }))
  }
}

/** The file that updates this kind of installation. */
export function pickAsset(release: ReleaseInfo, mode: InstallMode): ReleaseAsset | null {
  const exe = release.assets.filter((a) => /\.exe$/i.test(a.name))
  if (mode === 'portable') return exe.find((a) => a.name === PORTABLE_ASSET) ?? exe.find((a) => /portable/i.test(a.name)) ?? null
  if (mode === 'installer') return exe.find((a) => /setup/i.test(a.name) && !/portable/i.test(a.name)) ?? null
  return null
}

/** Parse `sha256sum` output ("<hex>  <name>" or "<hex> *<name>"). */
export function parseChecksums(text: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line.trim())
    if (m) out.set(m[2] as string, (m[1] as string).toLowerCase())
  }
  return out
}

/**
 * Expected sha256 of an asset: from SHA256SUMS.txt and/or the GitHub digest. When both exist they must
 * agree; with neither the update is refused (an executable is never run unverified).
 */
export function expectedSha256(asset: ReleaseAsset, sums: Map<string, string> | null): string {
  const fromSums = sums?.get(asset.name) ?? null
  if (fromSums && asset.sha256 && fromSums !== asset.sha256) throw new Error('Sumy kontrolne wydania się nie zgadzają – aktualizacja wstrzymana.')
  const hash = fromSums ?? asset.sha256
  if (!hash) throw new Error(`Wydanie nie zawiera sumy kontrolnej pliku ${asset.name} – aktualizacja wstrzymana.`)
  return hash
}

// ---------------------------------------------------------------- installation

export interface InstallModeInput {
  platform: string
  isPackaged: boolean
  /** PORTABLE_EXECUTABLE_FILE set by the portable launcher. */
  portableFile: string | undefined
  /** The NSIS uninstaller sits next to an installed app. */
  uninstallerExists: boolean
}

export function detectInstallMode(i: InstallModeInput): { mode: InstallMode; note: string | null } {
  if (!i.isPackaged) return { mode: 'manual', note: 'Wersja deweloperska – aktualizacje przez git pull.' }
  if (i.platform !== 'win32') return { mode: 'manual', note: 'Automatyczne aktualizacje działają w wersji dla Windows.' }
  if (i.portableFile) return { mode: 'portable', note: null }
  if (i.uninstallerExists) return { mode: 'installer', note: null }
  return { mode: 'manual', note: 'Ta kopia nie jest ani zainstalowana, ani w wersji portable – nową wersję pobierz ręcznie.' }
}
