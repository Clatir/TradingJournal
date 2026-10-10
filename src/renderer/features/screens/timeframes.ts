import type { ScreenRef } from '@shared/schema'
import { detectTimeframe, screenBlob } from '../../lib/tvOcr'
import { updateRecord, useJournal } from '../../store/journal'

type Mapper = (s: ScreenRef) => ScreenRef

type Holder = { screens: ScreenRef[]; pairs?: Array<{ screens: ScreenRef[] }> }
/** The records that hold screens: trades, library examples, day plans (their own screens and each pair's). */
const COLLECTIONS = ['trades', 'library', 'days'] as const
type Collection = (typeof COLLECTIONS)[number]

function mapScreens<T extends Holder>(record: T, fn: Mapper): T {
  return { ...record, screens: record.screens.map(fn), ...(record.pairs ? { pairs: record.pairs.map((p) => ({ ...p, screens: p.screens.map(fn) })) } : {}) }
}

const screensOf = (record: Holder): ScreenRef[] => [...record.screens, ...(record.pairs ?? []).flatMap((p) => p.screens)]

export interface TimeframeScan {
  checked: number
  found: number
  unsure: number
}

/**
 * Read the timeframe from the legend of every saved screen without one (a file shared by a trade and a library
 * example is read once). Screens with a timeframe set by hand are left alone.
 */
export async function detectMissingTimeframes(onProgress: (done: number, total: number) => void): Promise<TimeframeScan> {
  const state = useJournal.getState()
  const owners = new Map<string, Array<{ collection: Collection; id: string }>>()
  for (const collection of COLLECTIONS)
    for (const [id, entry] of Object.entries(state[collection])) {
      if (!entry || entry.readOnly) continue
      for (const s of screensOf(entry.record as Holder))
        if (s.timeframe == null) owners.set(s.path, [...(owners.get(s.path) ?? []), { collection, id }])
    }
  const paths = [...owners.keys()]
  const result: TimeframeScan = { checked: 0, found: 0, unsure: 0 }
  for (const path of paths) {
    onProgress(result.checked, paths.length)
    try {
      const r = await detectTimeframe(await screenBlob(path))
      if (r.name) {
        result.found++
        if (!r.certain) result.unsure++
        const fn: Mapper = (s) => (s.path === path && s.timeframe == null ? { ...s, timeframe: r.name, timeframeAuto: r.certain ? 'sure' : 'unsure' } : s)
        for (const o of owners.get(path)!) updateRecord(o.collection, o.id, (rec) => mapScreens(rec as Holder, fn) as typeof rec)
      }
    } catch {
      // A missing or unreadable file: skipped.
    }
    result.checked++
  }
  onProgress(result.checked, paths.length)
  return result
}
