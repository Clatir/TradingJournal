import { useEffect, useRef, useState } from 'react'
import { monthLabel, type ForecastInput, type ForecastResult } from '@shared/calc/forecast'
import { newId } from '@shared/ids'
import { FORECAST_MAX_GOALS, type Forecast, type ForecastGoal } from '@shared/schema'
import { Panel, Segmented, Toggle, cx } from '../../components/ui'
import { updateScenario } from './actions'
import { Num } from './fields'
import { goalStatus } from './texts'

/** "Cele zakupowe" (chapter 6.4) with one row per goal (chapter 9). */
export function GoalsPanel({
  scenario,
  input,
  result,
  cash,
  readOnly
}: {
  scenario: Forecast
  input: Pick<ForecastInput, 'horizon' | 'm0' | 'y0'>
  result: ForecastResult | null
  cash: ForecastResult | null
  readOnly: boolean
}) {
  const id = scenario.id
  const goals = scenario.goals
  const addRef = useRef<HTMLButtonElement>(null)
  const [focusGoal, setFocusGoal] = useState<string | null>(null)
  const setGoals = (fn: (g: ForecastGoal[]) => ForecastGoal[]) => updateScenario(id, (f) => ({ ...f, goals: fn(f.goals) }))
  const full = goals.length >= FORECAST_MAX_GOALS

  const add = () => {
    if (full) return
    const months = goals.map((g) => g.month).filter((m): m is number => m != null && Number.isInteger(m) && m >= 1 && m <= 240)
    const month = months.length ? Math.min(240, Math.max(...months) + 6) : 6
    const goal: ForecastGoal = { id: newId(), name: `Cel ${goals.length + 1}`, month, amount: null, enabled: true, flexible: false }
    setGoals((g) => [...g, goal])
    setFocusGoal(goal.id)
  }
  const remove = (goalId: string) => {
    setGoals((g) => g.filter((x) => x.id !== goalId))
    requestAnimationFrame(() => addRef.current?.focus())
  }

  return (
    <Panel
      title="Cele zakupowe"
      actions={
        <span className="num text-[11.5px] text-muted" data-testid="fc-goal-count">
          {goals.length} / {FORECAST_MAX_GOALS}
        </span>
      }
    >
      <div className="flex flex-col gap-2" data-testid="fc-goals-panel">
        <div className="flex flex-col gap-1">
          <Segmented
            value={scenario.keep}
            options={[
              { value: 'cash', label: 'Gotówka' },
              { value: 'fund', label: 'Fundusz celowy' }
            ]}
            onChange={(keep) => updateScenario(id, (f) => ({ ...f, keep }))}
            aria-label="Tryb odkładania"
            className="self-start"
          />
          <p className="text-[11.5px] text-muted" data-testid="fc-keep-description">
            {scenario.keep === 'cash'
              ? 'Wypłata co miesiąc schodzi z konta i czeka na cele w gotówce. Nie zarabia.'
              : 'Odkładanej wypłaty nie wypłacasz: zostaje w masie obrotowej i od następnego miesiąca pracuje razem z kapitałem. Fundusz celowy to suma tych odłożonych wypłat. Z masy schodzi tylko kwota celu, w miesiącu zakupu.'}
          </p>
        </div>
        <p className="text-[11.5px] text-muted">
          Cele realizujesz po kolei, w kolejności miesięcy. Cel z kwotą kupujesz, gdy minie jego miesiąc i uzbiera się cała kwota; nadwyżka zostaje na kolejne cele.
          Cel bez kwoty zabiera w swoim miesiącu wszystko, co odłożyłeś. Cel oznaczony „może poczekać” nie wstrzymuje następnych. Odznacz cel, żeby zobaczyć tabelę bez niego.
        </p>
        <div className="flex flex-col">
          {goals.map((g, i) => (
            <GoalRow
              key={g.id}
              n={i + 1}
              goal={g}
              scenario={scenario}
              input={input}
              result={result}
              cash={cash}
              autoFocus={focusGoal === g.id}
              onFocused={() => setFocusGoal(null)}
              onRemove={() => remove(g.id)}
            />
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button ref={addRef} className="btn btn-accent" disabled={full || readOnly} onClick={add} data-testid="fc-goal-add">
            + Dodaj cel
          </button>
          {full && <span className="text-[11.5px] text-muted">Limit: {FORECAST_MAX_GOALS} celów</span>}
        </div>
      </div>
    </Panel>
  )
}

function GoalRow({
  n,
  goal,
  scenario,
  input,
  result,
  cash,
  autoFocus,
  onFocused,
  onRemove
}: {
  n: number
  goal: ForecastGoal
  scenario: Forecast
  input: Pick<ForecastInput, 'horizon' | 'm0' | 'y0'>
  result: ForecastResult | null
  cash: ForecastResult | null
  autoFocus: boolean
  onFocused: () => void
  onRemove: () => void
}) {
  const nameRef = useRef<HTMLInputElement>(null)
  const set = (patch: Partial<ForecastGoal>) => updateScenario(scenario.id, (f) => ({ ...f, goals: f.goals.map((g) => (g.id === goal.id ? { ...g, ...patch } : g)) }))
  useEffect(() => {
    if (!autoFocus) return
    nameRef.current?.focus()
    nameRef.current?.select()
    onFocused()
  }, [autoFocus, onFocused])
  const status = result ? goalStatus(goal, { scenario, input, result, cash }) : null
  const validMonth = goal.month != null && goal.month >= 1 && goal.month <= 240
  const testId = (part: string) => `fc-goal-${n}-${part}`

  return (
    <div className={cx('flex flex-col gap-1 border-b border-line/70 py-1.5', !goal.enabled && 'opacity-60')} data-testid={`fc-goal-${n}`}>
      <div className="flex items-center gap-2">
        <span data-testid={testId('on')}>
          <Toggle checked={goal.enabled} onChange={(enabled) => set({ enabled })} label={<span className="sr-only">uwzględnij cel w tabeli</span>} />
        </span>
        <input
          ref={nameRef}
          className="input min-w-0 flex-1"
          value={goal.name}
          maxLength={40}
          placeholder="Nazwa celu"
          spellCheck={false}
          onChange={(e) => set({ name: e.currentTarget.value.slice(0, 40) })}
          aria-label={`Nazwa celu ${n}`}
          data-testid={testId('name')}
        />
        <button className="btn btn-ghost h-[22px] px-1.5 text-[14px] leading-none" onClick={onRemove} aria-label={`Usuń cel ${goal.name.trim() || 'Bez nazwy'}`} data-testid={testId('del')}>
          ×
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-[36px]">
        <span className="text-[11.5px] text-muted">mies.</span>
        <GoalMonthField value={goal.month} onChange={(month) => set({ month })} n={n} />
        <span className="num w-[56px] text-[11.5px] text-dim">{validMonth ? monthLabel(goal.month!, input.m0, input.y0) : ''}</span>
        <span className="text-[11.5px] text-muted">kwota</span>
        <Num
          value={goal.amount}
          onChange={(amount) => set({ amount })}
          nullable
          format="money"
          max={1e12}
          step={100}
          isValid={(v) => v == null || v > 0}
          placeholder="cała pula"
          className="w-[120px]"
          aria-label={`Kwota celu ${n}`}
          data-testid={testId('amount')}
        />
        <span className="num text-[11.5px] text-muted">{scenario.currency}</span>
        <span
          className={cx('ml-1 text-[11.5px]', goal.amount == null && 'pointer-events-none opacity-40')}
          title={goal.amount == null ? 'Dotyczy celu z kwotą' : 'Gdy czeka na swoją kwotę, nie wstrzymuje kolejnych celów'}
          aria-disabled={goal.amount == null}
          data-testid={testId('flex')}
        >
          <Toggle checked={goal.flexible} onChange={(flexible) => goal.amount != null && set({ flexible })} label="może poczekać" />
        </span>
      </div>
      <div
        className={cx('pl-[36px] text-[11.5px]', status?.tone === 'warn' ? 'text-accent' : status?.tone === 'dim' ? 'text-dim' : 'text-fg')}
        data-testid={testId('status')}
      >
        {status?.parts.map((part, i) => (
          <span key={i} className={cx(part.strong && 'num font-medium', part.accent && 'text-accent', part.dim && 'text-muted')}>
            {part.text}
          </span>
        )) ?? '—'}
      </div>
    </div>
  )
}

/** Month number of a goal: empty or outside 1–240 is not clipped – it stores null and keeps the text with an error border. */
function GoalMonthField({ value, onChange, n }: { value: number | null; onChange: (v: number | null) => void; n: number }) {
  const [draft, setDraft] = useState<string | null>(null)
  const parse = (t: string): number | null => {
    const s = t.trim()
    if (!/^\d{1,3}$/.test(s)) return null
    const v = Number(s)
    return v >= 1 && v <= 240 ? v : null
  }
  const shown = draft ?? (value == null ? '' : String(value))
  const invalid = value == null || (draft != null && parse(draft) == null)
  return (
    <input
      className="input num w-[56px] text-right"
      inputMode="numeric"
      value={shown}
      aria-invalid={invalid}
      aria-label={`Miesiąc celu ${n}`}
      data-testid={`fc-goal-${n}-month`}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => {
        const t = e.currentTarget.value
        setDraft(t)
        onChange(parse(t))
      }}
      // An invalid entry stays visible (with the error border); a valid one is shown as stored.
      onBlur={() => setDraft((d) => (d != null && parse(d) == null ? d : null))}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
        e.preventDefault()
        const next = Math.min(240, Math.max(1, (value ?? 0) + (e.key === 'ArrowUp' ? 1 : -1)))
        setDraft(null)
        onChange(next)
      }}
    />
  )
}
