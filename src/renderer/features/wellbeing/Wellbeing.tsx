import { useMemo, useState } from 'react'
import { wellbeingStats, type WellbeingGroup } from '@shared/calc/wellbeing'
import type { TradeMetrics } from '@shared/calc/trade'
import { weekdayNy } from '@shared/calc/time'
import type { DayPlan, Trade } from '@shared/schema'
import { fmtPercent, fmtR, tone, toneClass } from '../../lib/format'
import { updateRecord, useJournal } from '../../store/journal'
import { NumberField, Panel, Segmented, cx } from '../../components/ui'
import { todayNy } from '../day/DayPlanPage'
import { ensureDayPlan } from '../sessions/actions'

type Wellbeing = DayPlan['wellbeing']
const SCALE = [1, 2, 3, 4, 5].map((v) => ({ value: String(v), label: String(v) }))

/** Sleep (hours), energy and stress 1–5. */
export function WellbeingFields({ value, onChange, compact }: { value: Wellbeing; onChange: (patch: Partial<Wellbeing>) => void; compact?: boolean }) {
  return (
    <div className={cx('flex flex-wrap items-center text-[12px]', compact ? 'gap-3' : 'gap-x-4 gap-y-2')}>
      <label className="flex items-center gap-1.5">
        <span className="text-muted">Sen</span>
        <NumberField
          className="w-[52px]"
          value={value.sleepHours}
          step={0.5}
          onChange={(v) => onChange({ sleepHours: v == null ? null : Math.min(24, Math.max(0, v)) })}
          aria-label="Sen w godzinach"
          data-testid="wb-sleep"
        />
        <span className="text-muted">h</span>
      </label>
      <span className="flex items-center gap-1.5">
        <span className="text-muted">Energia</span>
        <Segmented size="sm" value={value.energy == null ? null : String(value.energy)} onChange={(v) => onChange({ energy: Number(v) })} options={SCALE} aria-label="Energia" />
      </span>
      <span className="flex items-center gap-1.5">
        <span className="text-muted">Stres</span>
        <Segmented size="sm" value={value.stress == null ? null : String(value.stress)} onChange={(v) => onChange({ stress: Number(v) })} options={SCALE} aria-label="Stres" />
      </span>
    </div>
  )
}

const DISMISS_KEY = 'ictj.wellbeing.dismissed'

function dismissedFor(date: string): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === date
  } catch {
    return false
  }
}

/** Morning question on a trading day until sleep, energy and stress are in today's plan (or it is put off). */
export function WellbeingPrompt() {
  const enabled = useJournal((s) => s.journal?.settings.display.wellbeingPrompt ?? false)
  const readOnly = useJournal((s) => !!s.status?.readOnly)
  const isSample = useJournal((s) => !!s.status?.isSample)
  const today = todayNy()
  const day = useJournal((s) => Object.values(s.days).find((e) => e.record.date === today)?.record ?? null)
  const [hidden, setHidden] = useState(() => dismissedFor(today))
  const weekday = weekdayNy(`${today}T12:00:00.000Z`) <= 5
  const w = day?.wellbeing ?? { sleepHours: null, energy: null, stress: null, note: '' }
  const complete = w.sleepHours != null && w.energy != null && w.stress != null
  // Stays until all three are filled in (here or in the day plan) or it is put off for today.
  if (!enabled || readOnly || isSample || hidden || !weekday || complete) return null
  const set = (patch: Partial<Wellbeing>) => {
    const id = ensureDayPlan(today)
    if (id) updateRecord('days', id, (d: DayPlan) => ({ ...d, wellbeing: { ...d.wellbeing, ...patch } }))
  }
  return (
    <div className="flex min-h-[32px] items-center gap-3 border-b border-line bg-panel px-3 text-[12px]" data-testid="wellbeing-prompt">
      <span className="text-fg-strong">Jak się dziś czujesz?</span>
      <WellbeingFields value={w} onChange={set} compact />
      <span className="text-[11px] text-dim">zapisuje się w planie dnia; w analityce: wynik a sen, energia i stres</span>
      <button
        className="btn btn-ghost ml-auto h-[22px]"
        onClick={() => {
          try {
            localStorage.setItem(DISMISS_KEY, today)
          } catch {
            /* per session only */
          }
          setHidden(true)
        }}
        title="Nie pytaj dziś (wyłącz w Ustawienia → Wyświetlanie)"
        data-testid="wellbeing-dismiss"
      >
        Nie dziś
      </button>
    </div>
  )
}

/** Day plan section. */
export function WellbeingSection({ day, readOnly }: { day: DayPlan; readOnly: boolean }) {
  const set = (patch: Partial<Wellbeing>) => updateRecord('days', day.id, (d: DayPlan) => ({ ...d, wellbeing: { ...d.wellbeing, ...patch } }))
  return (
    <Panel title="Samopoczucie (rano)" className="border-0 border-b">
      <fieldset disabled={readOnly} className="flex flex-col gap-2">
        <WellbeingFields value={day.wellbeing} onChange={set} />
        <input
          className="input h-[24px]"
          value={day.wellbeing.note}
          placeholder="np. mało snu, ból głowy, dobra forma"
          onChange={(e) => set({ note: e.currentTarget.value })}
          aria-label="Notatka o samopoczuciu"
        />
      </fieldset>
    </Panel>
  )
}

/** Analytics: results by sleep, energy and stress of the day. */
export function WellbeingPanel({ rows, from, to }: { rows: ReadonlyArray<{ trade: Trade; m: TradeMetrics }>; from: string | null; to: string | null }) {
  const days = useJournal((s) => s.days)
  const st = useMemo(() => wellbeingStats(Object.values(days).map((e) => e.record), rows, { from, to }), [days, rows, from, to])
  return (
    <Panel title="Samopoczucie a wynik" className="border-0 border-t border-line">
      {st.daysFilled === 0 ? (
        <div className="py-4 text-center text-[12px] text-dim">Brak dni z wpisanym snem, energią lub stresem (plan dnia albo pytanie rano).</div>
      ) : (
        <div className="grid grid-cols-3 gap-3 text-[12px]" data-testid="wellbeing-panel">
          <GroupTable title="Sen" groups={st.sleep} testId="wb-sleep-table" />
          <GroupTable title="Energia" groups={st.energy} />
          <GroupTable title="Stres" groups={st.stress} />
        </div>
      )}
    </Panel>
  )
}

function GroupTable({ title, groups, testId }: { title: string; groups: WellbeingGroup[]; testId?: string }) {
  const cols = 'grid grid-cols-[minmax(0,1.4fr)_38px_38px_52px_62px_52px]'
  return (
    <div className="flex min-w-0 flex-col" data-testid={testId}>
      <span className="label mb-1">{title}</span>
      <div className="border border-line">
        <div className={cx(cols, 'border-b border-line bg-raised px-2 py-0.5 text-[10.5px] tracking-wide text-muted uppercase')}>
          <span />
          <span className="text-right">dni</span>
          <span className="text-right">n</span>
          <span className="text-right">WR</span>
          <span className="text-right">śr. R</span>
          <span className="text-right">błędy</span>
        </div>
        {groups.map((g) => (
          <div key={g.label} className={cx(cols, 'border-b border-line/50 px-2 py-0.5 last:border-b-0')}>
            <span className="truncate">{g.label}</span>
            <span className="num text-right text-muted">{g.days}</span>
            <span className="num text-right text-muted">{g.trades}</span>
            <span className="num text-right">{fmtPercent(g.winRate, 0)}</span>
            <span className={cx('num text-right', toneClass[tone(g.avgR)])}>{g.avgR == null ? '—' : fmtR(g.avgR)}</span>
            <span className="num text-right text-muted">{fmtPercent(g.mistakes, 0)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
