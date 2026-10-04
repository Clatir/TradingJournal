/**
 * NBP table A (mid rates) fetched by the main process with Electron's net.fetch, like updates; the renderer
 * never connects to the network. ICTJ_NBP_URL points to a local test server (plain http allowed) or is
 * "off" to never connect.
 */
import { NBP_API, NBP_TABLE_PATH, parseNbpResponse, type FxFetchResult } from '@shared/fx'
import { HttpError, fetchJson, type FetchLike } from '../update/download'

const TIMEOUT_MS = 10_000

const NETWORK_ERROR =
  /net::ERR_|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|fetch failed|failed to fetch|terminated|other side closed|socket hang up|aborted/i

export interface NbpSource {
  /** Base address of the NBP API; null = fetching is switched off. */
  base: string | null
  allowInsecure: boolean
}

/** Where to fetch from: api.nbp.pl, a test server (ICTJ_NBP_URL) or nowhere (ICTJ_NBP_URL=off). */
export function nbpSource(env: string | undefined): NbpSource {
  const value = env?.trim()
  if (!value) return { base: NBP_API, allowInsecure: false }
  if (value.toLowerCase() === 'off') return { base: null, allowInsecure: false }
  return { base: value.replace(/\/+$/, ''), allowInsecure: true }
}

export function describeNbpError(e: unknown): string {
  if (e instanceof HttpError) return `serwer NBP odpowiedział błędem ${e.status}`
  const err = e instanceof Error ? e : new Error(String(e))
  const text = `${err.name} ${err.message} ${(err.cause as { code?: string } | undefined)?.code ?? ''} ${(err.cause as Error | undefined)?.message ?? ''}`
  if (NETWORK_ERROR.test(text) || err.name === 'AbortError') return 'brak połączenia z internetem albo serwer NBP nie odpowiada'
  return err.message
}

export async function fetchNbpTable(fetchFn: FetchLike, source: NbpSource, now: () => Date = () => new Date()): Promise<FxFetchResult> {
  if (!source.base) return { ok: false, message: 'pobieranie kursów jest wyłączone' }
  const url = `${source.base}${NBP_TABLE_PATH}`
  if (!source.allowInsecure && !/^https:\/\//i.test(url)) return { ok: false, message: 'dozwolone są tylko adresy https://' }
  try {
    const raw = await fetchJson(fetchFn, url, { Accept: 'application/json' }, TIMEOUT_MS)
    const table = parseNbpResponse(raw, now().toISOString())
    return table ? { ok: true, table } : { ok: false, message: 'nieoczekiwana odpowiedź serwera NBP' }
  } catch (e) {
    return { ok: false, message: describeNbpError(e) }
  }
}
