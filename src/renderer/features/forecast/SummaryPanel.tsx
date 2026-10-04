import type { ForecastInput, ForecastResult } from '@shared/calc/forecast'
import type { Forecast } from '@shared/schema'
import { Cell, Panel } from '../../components/ui'
import { summaryCells } from './texts'

/** "Podsumowanie" (chapter 8): six cells, plus tax and withdrawals when they apply. */
export function SummaryPanel({ scenario, input, result, cash }: { scenario: Forecast; input: ForecastInput | null; result: ForecastResult | null; cash: ForecastResult | null }) {
  const cells = input && result ? summaryCells({ scenario, input, result, cash }) : null
  return (
    <Panel title="Podsumowanie">
      {cells ? (
        <div className="grid grid-cols-3 border-t border-l border-line" data-testid="fc-summary">
          {cells.map((c) => (
            <Cell
              key={c.key}
              label={c.label}
              value={<span data-testid={`fc-sum-${c.key}`}>{c.value}</span>}
              valueClassName="text-[15px]"
              sub={<span data-testid={`fc-sum-${c.key}-sub`}>{c.sub}</span>}
              className="border-r border-b border-line"
            />
          ))}
        </div>
      ) : (
        <div className="text-muted" data-testid="fc-summary-empty">
          Brak wyników – uzupełnij kurs albo wartość pipsa w panelu „Zysk i kapitał”.
        </div>
      )}
    </Panel>
  )
}
