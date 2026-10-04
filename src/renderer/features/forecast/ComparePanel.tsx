import type { Forecast } from '@shared/schema'
import { goalName } from '@shared/export/forecast'
import { Panel, cx } from '../../components/ui'
import type { ForecastComputation } from './ForecastPage'
import { compareRows, goalOutcome, summaryCells } from './texts'

/** "Porównanie" with the scenario chosen in "Porównaj z…" (chapter 12). */
export function ComparePanel({
  scenario,
  computed,
  other,
  otherComputed
}: {
  scenario: Forecast
  computed: ForecastComputation
  other: Forecast
  otherComputed: ForecastComputation
}) {
  const ok = computed.outcome.ok && computed.result && otherComputed.outcome.ok && otherComputed.result
  return (
    <Panel title="Porównanie">
      {!ok ? (
        <div className="text-muted" data-testid="fc-compare-panel">
          Jednego ze scenariuszy nie da się policzyć (brak kursu albo wartości pipsa w trybie pipsowym).
        </div>
      ) : (
        <CompareBody scenario={scenario} computed={computed} other={other} otherComputed={otherComputed} />
      )}
    </Panel>
  )
}

function CompareBody({ scenario, computed, other, otherComputed }: { scenario: Forecast; computed: ForecastComputation; other: Forecast; otherComputed: ForecastComputation }) {
  const inputA = computed.outcome.ok ? computed.outcome.input : null
  const inputB = otherComputed.outcome.ok ? otherComputed.outcome.input : null
  if (!inputA || !inputB || !computed.result || !otherComputed.result) return null
  const rows = compareRows(
    { scenario, cells: summaryCells({ scenario, input: inputA, result: computed.result, cash: computed.cash }) },
    { scenario: other, cells: summaryCells({ scenario: other, input: inputB, result: otherComputed.result, cash: otherComputed.cash }) }
  )
  const goals = (f: Forecast, input: typeof inputA, result: NonNullable<ForecastComputation['result']>) =>
    f.goals.length ? (
      f.goals.map((g) => (
        <div key={g.id} className="flex justify-between gap-3 border-b border-line/60 py-0.5 text-[12px]">
          <span className="truncate">{goalName(g.name)}</span>
          <span className="num shrink-0 text-muted">{goalOutcome(g, result, input)}</span>
        </div>
      ))
    ) : (
      <div className="text-[12px] text-dim">bez celów</div>
    )
  return (
    <div className="flex flex-col gap-3" data-testid="fc-compare-panel">
      {scenario.keep !== other.keep && (
        <p className="text-[11.5px] text-muted">Scenariusze mają różne tryby odkładania – porównuję tylko pozycje, które znaczą to samo w obu.</p>
      )}
      {scenario.currency !== other.currency && (
        <p className="text-[11.5px] text-accent">
          Scenariusze mają różne waluty ({scenario.currency}, {other.currency}) – różnice kwot nie są liczone.
        </p>
      )}
      <table className="num w-full border-collapse text-[12px]">
        <thead>
          <tr className="text-[11px] text-muted">
            <th className="border-b border-line py-1 text-left font-medium" />
            <th className="border-b border-line py-1 text-right font-medium">{scenario.name}</th>
            <th className="border-b border-line py-1 text-right font-medium">{other.name}</th>
            <th className="border-b border-line py-1 text-right font-medium">Różnica</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} data-testid={`fc-cmp-${r.key}`}>
              <td className="border-b border-line/60 py-1 font-sans text-muted">{r.label}</td>
              <td className="border-b border-line/60 py-1 text-right text-fg-strong">{r.a}</td>
              <td className="border-b border-line/60 py-1 text-right">{r.b}</td>
              <td className={cx('border-b border-line/60 py-1 text-right', r.sign > 0 ? 'text-up' : r.sign < 0 ? 'text-down' : 'text-muted')} data-testid={`fc-cmp-${r.key}-diff`}>
                {r.diff ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="label mb-1">Cele: {scenario.name}</div>
          {goals(scenario, inputA, computed.result)}
        </div>
        <div>
          <div className="label mb-1">Cele: {other.name}</div>
          {goals(other, inputB, otherComputed.result)}
        </div>
      </div>
    </div>
  )
}
