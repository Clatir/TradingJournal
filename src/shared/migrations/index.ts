/**
 * On-disk format migrations.
 *
 * Every record file carries `schemaVersion`; `journal.json` carries the folder-level version.
 * A file without `schemaVersion` is treated as version 0 (the pre-release, flat format
 * described in tradeV0toV1 — also what a hand-written file most likely looks like).
 *
 * To change the format: bump SCHEMA_VERSION, add a step `N -> N+1` for every kind, add a fixture test.
 */
import { newId } from '../ids'
import { SCHEMA_VERSION } from '../schema/common'
import type { FileKind } from '../paths'

type Raw = Record<string, unknown>
type Step = (raw: Raw) => Raw

export class SchemaTooNewError extends Error {
  constructor(
    public readonly fileVersion: number,
    public readonly appVersion: number = SCHEMA_VERSION
  ) {
    super(`Plik ma format v${fileVersion}, ta wersja aplikacji obsługuje v${appVersion}. Zaktualizuj aplikację.`)
    this.name = 'SchemaTooNewError'
  }
}

export function readSchemaVersion(raw: unknown): number {
  if (raw && typeof raw === 'object' && 'schemaVersion' in raw) {
    const v = (raw as Raw).schemaVersion
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return v
  }
  return 0
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)

/** v0 trade: flat prices (entry, stopLoss, takeProfit, exitPrice, exitTime), buy/sell directions. */
function tradeV0toV1(raw: Raw): Raw {
  const {
    entry,
    stopLoss,
    takeProfit,
    takeProfit1,
    takeProfit2,
    exitPrice,
    exitTime,
    direction,
    ...rest
  } = raw
  const exit = num(exitPrice)
  const entryTime = str(rest.entryTime) ?? new Date(0).toISOString()
  const dir = direction === 'buy' ? 'long' : direction === 'sell' ? 'short' : direction
  const out: Raw = {
    ...rest,
    id: str(rest.id) ?? newId(),
    createdAt: str(rest.createdAt) ?? entryTime,
    updatedAt: str(rest.updatedAt) ?? entryTime,
    status: str(rest.status) ?? (exit != null ? 'closed' : 'open'),
    direction: dir,
    entryTime,
    prices: (rest.prices as Raw | undefined) ?? {
      entry: num(entry),
      stopLoss: num(stopLoss),
      takeProfit1: num(takeProfit1) ?? num(takeProfit),
      takeProfit2: num(takeProfit2)
    },
    exits:
      (rest.exits as unknown[] | undefined) ??
      (exit != null ? [{ id: newId(), time: str(exitTime), price: exit, percent: 100, note: '' }] : [])
  }
  return out
}

function bumpOnly(raw: Raw): Raw {
  return { ...raw }
}

function withIdAndTimestamps(raw: Raw): Raw {
  const now = new Date().toISOString()
  return {
    ...raw,
    id: str(raw.id) ?? newId(),
    createdAt: str(raw.createdAt) ?? now,
    updatedAt: str(raw.updatedAt) ?? now
  }
}

const STEPS: Record<FileKind, Record<number, Step>> = {
  journal: { 0: withIdAndTimestamps },
  trades: { 0: tradeV0toV1 },
  days: { 0: withIdAndTimestamps },
  weeks: { 0: withIdAndTimestamps },
  library: { 0: (raw) => bumpOnly(withIdAndTimestamps(raw)) },
  forecasts: { 0: withIdAndTimestamps },
  drills: { 0: withIdAndTimestamps }
}

export interface MigrationResult {
  data: Raw
  fromVersion: number
  migrated: boolean
}

/** Upgrade a parsed JSON object to the current version. Throws SchemaTooNewError for newer files. */
export function migrateRaw(kind: FileKind, input: unknown): MigrationResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Plik nie zawiera obiektu JSON')
  const fromVersion = readSchemaVersion(input)
  if (fromVersion > SCHEMA_VERSION) throw new SchemaTooNewError(fromVersion)
  let data: Raw = { ...(input as Raw) }
  let v = fromVersion
  while (v < SCHEMA_VERSION) {
    const step = STEPS[kind][v]
    if (!step) throw new Error(`Brak migracji ${kind} v${v} → v${v + 1}`)
    data = step(data)
    v += 1
    data.schemaVersion = v
  }
  return { data, fromVersion, migrated: fromVersion !== SCHEMA_VERSION }
}
