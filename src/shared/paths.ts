/**
 * Layout of the data folder. All paths handled by the app are RELATIVE to the data folder
 * and always use forward slashes, so the folder can be moved or synced as a whole.
 */
import { tradingDateNy } from './calc/time'

export type Collection = 'trades' | 'days' | 'weeks' | 'library' | 'forecasts' | 'drills'
export const COLLECTIONS: readonly Collection[] = ['trades', 'days', 'weeks', 'library', 'forecasts', 'drills']
export type FileKind = Collection | 'journal'

export const JOURNAL_FILE = 'journal.json'
export const SCREENS_DIR = 'screens'
export const BACKUPS_DIR = 'backups'
export const PRESENCE_DIR = '.presence'

const ULID = '[0-9A-HJKMNP-TV-Z]{26}'

const CANONICAL: Record<FileKind, RegExp> = {
  journal: /^journal\.json$/,
  trades: new RegExp(`^trades/(\\d{4})/(\\d{4}-\\d{2}-\\d{2})_([A-Z0-9]+)_(${ULID})\\.json$`),
  days: /^days\/(\d{4})\/(\d{4}-\d{2}-\d{2})\.json$/,
  weeks: /^weeks\/(\d{4}-W\d{2})\.json$/,
  library: new RegExp(`^library/(${ULID})\\.json$`),
  forecasts: new RegExp(`^forecasts/(${ULID})\\.json$`),
  drills: new RegExp(`^drills/(${ULID})\\.json$`)
}

/** Stem prefixes used to recognize copies made by sync tools (anything appended after a canonical stem). */
const STEM_PREFIX: Record<FileKind, RegExp> = {
  journal: /^(journal)(.+)$/,
  trades: new RegExp(`^(\\d{4}-\\d{2}-\\d{2}_[A-Z0-9]+_${ULID})(.+)$`),
  days: /^(\d{4}-\d{2}-\d{2})(.+)$/,
  weeks: /^(\d{4}-W\d{2})(.+)$/,
  library: new RegExp(`^(${ULID})(.+)$`),
  forecasts: new RegExp(`^(${ULID})(.+)$`),
  drills: new RegExp(`^(${ULID})(.+)$`)
}

export function toPosix(p: string): string {
  return p.replace(/\\/g, '/')
}

/** Files and folders the scanner and watcher never treat as records. */
export function isIgnoredPath(rel: string): boolean {
  const p = toPosix(rel)
  if (p.startsWith(`${BACKUPS_DIR}/`) || p === BACKUPS_DIR) return true
  if (p.includes('.tmp-')) return true
  return p.split('/').some((seg) => seg.startsWith('.'))
}

export function kindOfDir(rel: string): FileKind | null {
  const p = toPosix(rel)
  if (!p.includes('/')) return p.endsWith('.json') ? 'journal' : null
  const top = p.split('/')[0] as Collection
  return COLLECTIONS.includes(top) ? top : null
}

export function classifyCanonical(rel: string): FileKind | null {
  const p = toPosix(rel)
  for (const kind of Object.keys(CANONICAL) as FileKind[]) {
    if (CANONICAL[kind].test(p)) return kind
  }
  return null
}

export interface ConflictName {
  kind: FileKind
  /** Canonical relative path this file is a copy of. */
  canonicalPath: string
  /** Best guess of the sync tool that created the copy. */
  source: string
}

export function guessConflictSource(remainder: string): string {
  if (/^-zewnetrzna-/.test(remainder)) return 'zmiana z zewnątrz podczas edycji'
  if (/^-uszkodzona-/.test(remainder)) return 'uszkodzony plik odsunięty przy zapisie'
  if (/sync-conflict/i.test(remainder)) return 'Syncthing'
  if (/conflicted copy|kopia powoduj|konflikt/i.test(remainder)) return 'Dropbox'
  if (/^ \(\d+\)$/.test(remainder)) return 'Google Drive / kopia'
  if (/^-[A-Za-z0-9][A-Za-z0-9-]*$/.test(remainder)) return 'OneDrive'
  return 'nieznane źródło'
}

/** Recognize a non-canonical JSON file in a data directory as a sync-conflict copy of a canonical file. */
export function detectConflictName(rel: string): ConflictName | null {
  const p = toPosix(rel)
  if (!p.toLowerCase().endsWith('.json') || classifyCanonical(p)) return null
  const kind = kindOfDir(p)
  if (!kind) return null
  const slash = p.lastIndexOf('/')
  const dir = slash >= 0 ? p.slice(0, slash + 1) : ''
  const stem = p.slice(slash + 1, -'.json'.length)
  const m = STEM_PREFIX[kind].exec(stem)
  if (!m) return null
  const canonicalPath = `${dir}${m[1]}.json`
  if (classifyCanonical(canonicalPath) !== kind) return null
  return { kind, canonicalPath, source: guessConflictSource(m[2] ?? '') }
}

function safePair(pair: string): string {
  return pair.toUpperCase().replace(/[^A-Z0-9]/g, '') || 'PARA'
}

export function tradeRelPath(trade: { id: string; pair: string; entryTime: string }): string {
  const date = tradingDateNy(trade.entryTime)
  return `trades/${date.slice(0, 4)}/${date}_${safePair(trade.pair)}_${trade.id}.json`
}

export function dayRelPath(date: string): string {
  return `days/${date.slice(0, 4)}/${date}.json`
}

export function weekRelPath(week: string): string {
  return `weeks/${week}.json`
}

export function libraryRelPath(id: string): string {
  return `library/${id}.json`
}

export function forecastRelPath(id: string): string {
  return `forecasts/${id}.json`
}

export function drillRelPath(id: string): string {
  return `drills/${id}.json`
}

export function recordRelPath(collection: Collection, record: Record<string, unknown>): string {
  switch (collection) {
    case 'trades':
      return tradeRelPath(record as { id: string; pair: string; entryTime: string })
    case 'days':
      return dayRelPath(String(record.date))
    case 'weeks':
      return weekRelPath(String(record.week))
    case 'library':
      return libraryRelPath(String(record.id))
    case 'forecasts':
      return forecastRelPath(String(record.id))
    case 'drills':
      return drillRelPath(String(record.id))
  }
}

const PL_MAP: Record<string, string> = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' }

export function slugLabel(label: string, fallback = 'screen'): string {
  const ascii = label
    .split('')
    .map((ch) => {
      const lower = ch.toLowerCase()
      const mapped = PL_MAP[lower]
      if (!mapped) return ch
      return ch === lower ? mapped : mapped.toUpperCase()
    })
    .join('')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
  const slug = ascii.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return slug || fallback
}

/** Screens live under screens/YYYY/MM/<id>_<label>.webp with a sibling .thumb.webp. */
export function screenRelPaths(id: string, label: string, date: string): { path: string; thumbPath: string } {
  const base = `${SCREENS_DIR}/${date.slice(0, 4)}/${date.slice(5, 7)}/${id}_${slugLabel(label)}`
  return { path: `${base}.webp`, thumbPath: `${base}.thumb.webp` }
}

export function isScreenFile(rel: string): boolean {
  return /^screens\/\d{4}\/\d{2}\/[^/]+\.webp$/.test(toPosix(rel))
}

/** Reject absolute paths and traversal; returns normalized posix relative path or null. */
export function sanitizeRelPath(rel: string): string | null {
  const p = toPosix(rel).replace(/^\.\/+/, '')
  if (!p || p.startsWith('/') || /^[A-Za-z]:/.test(p)) return null
  const parts = p.split('/')
  if (parts.some((s) => s === '..' || s === '')) return null
  return parts.join('/')
}
