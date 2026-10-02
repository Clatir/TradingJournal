import { DateTime } from 'luxon'
import type { ScreenRef } from '@shared/schema'
import { generateSample, type ScreenSpec } from '@shared/sample/generate'
import { api, errorMessage } from '../../lib/api'
import { compressImage } from '../../lib/image'
import { applySnapshot, flushSaves, openResult, useJournal } from '../../store/journal'
import { navigate, toast } from '../../store/ui'
import { todayNy } from '../day/DayPlanPage'
import { drawSampleChart } from './drawChart'

function lastCompletedTradingDay(): string {
  let d = DateTime.fromISO(todayNy()).minus({ days: 1 })
  while (d.weekday > 5) d = d.minus({ days: 1 })
  return d.toISODate() as string
}

async function populate(): Promise<void> {
  const data = generateSample({ seed: 1234, endDate: lastCompletedTradingDay() })
  await api.saveJournal(data.journal)
  const refs = new Map<string, Array<{ spec: ScreenSpec; ref: ScreenRef }>>()
  const settings = data.journal.settings.screens
  for (const spec of data.screens) {
    const png = await drawSampleChart(spec)
    const c = await compressImage(png, { mode: settings.mode, quality: settings.quality, autoMaxRatio: settings.autoMaxRatio, maxWidth: settings.maxWidth, thumbWidth: settings.thumbWidth })
    const owner =
      spec.target === 'trade'
        ? data.trades.find((t) => t.id === spec.targetId)?.entryTime.slice(0, 10)
        : spec.target === 'day'
          ? data.days.find((d) => d.id === spec.targetId)?.date
          : data.library.find((l) => l.id === spec.targetId)?.date
    const saved = await api.saveScreen({ date: owner ?? todayNy(), label: spec.label, image: c.image, thumb: c.thumb, width: c.width, height: c.height })
    const ref: ScreenRef = { ...saved, phase: spec.phase, timeframe: spec.timeframe, caption: '', annotations: [] }
    refs.set(spec.targetId, [...(refs.get(spec.targetId) ?? []), { spec, ref }])
  }
  for (const day of data.days) {
    for (const { spec, ref } of refs.get(day.id) ?? []) {
      const section = day.pairs.find((p) => p.pair === spec.pair)
      if (section) section.screens.push(ref)
      else day.screens.push(ref)
    }
    await api.saveRecord('days', day)
  }
  for (const t of data.trades) {
    t.screens = (refs.get(t.id) ?? []).map((x) => x.ref)
    await api.saveRecord('trades', t)
  }
  for (const w of data.weeks) await api.saveRecord('weeks', w)
  for (const l of data.library) {
    l.screens = (refs.get(l.id) ?? []).map((x) => x.ref)
    await api.saveRecord('library', l)
  }
}

/** Switch to the separate demo folder (generated on first use). Real data is never touched. */
export async function enterSample(regenerate = false): Promise<void> {
  try {
    await flushSaves()
    if (regenerate) await api.resetSample()
    const res = await api.openSample()
    if (!res.ok) {
      toast(res.message, 'error', 6000)
      return
    }
    applySnapshot(res.snapshot)
    if (res.snapshot.trades.length === 0) {
      toast('Generowanie danych przykładowych…')
      await populate()
      const again = await api.openSample()
      if (again.ok) applySnapshot(again.snapshot)
    }
    toast('Tryb DEMO: dane przykładowe. Twoje dane są nietknięte.', 'success', 5000)
    navigate({ page: 'analytics' })
  } catch (e) {
    toast(`Nie udało się przygotować danych przykładowych: ${errorMessage(e)}`, 'error', 8000)
  }
}

export async function exitSample(): Promise<void> {
  await flushSaves()
  const res = await api.exitSample()
  if (!res) {
    useJournal.setState({ phase: 'setup', setupMessage: 'Wybierz folder ze swoim dziennikiem.', setupDir: null })
    return
  }
  if (await openResult(res)) {
    toast('Wrócono do Twojego dziennika.', 'success')
    navigate({ page: 'journal' })
  }
}
