import { useState } from 'react'
import { MIN_HISTORY_MONTHS, forecastFromHistory, monthlyReturns, type HistoryForecast } from '@shared/calc/journalReturns'
import type { Forecast } from '@shared/schema'
import { fmtPct } from '../../lib/format'
import { metricsFor } from '../../store/derived'
import { useJournal } from '../../store/journal'
import { toast } from '../../store/ui'
import { updateScenario } from './actions'

const pct = (v: number) => fmtPct(v)

/** "Weź z moich wyników": the percent mode set from the journal's monthly returns, after a preview. */
export function FromJournal({ scenario, readOnly }: { scenario: Forecast; readOnly: boolean }) {
  const [preview, setPreview] = useState<{ result: HistoryForecast | null; months: number } | null>(null)

  const compute = () => {
    const { trades, journal } = useJournal.getState()
    if (!journal) return
    const months = monthlyReturns(
      Object.values(trades).map((e) => e.record),
      (t) => metricsFor(t, journal.settings),
      journal.settings.risk.defaultRiskPercent
    )
    setPreview({ result: forecastFromHistory(months), months: months.length })
  }

  const apply = (h: HistoryForecast) => {
    updateScenario(scenario.id, (f) => ({
      ...f,
      pct: { ...f.pct, mode: 'random', lo: h.gainLo, hi: h.gainHi },
      loss: {
        ...f.loss,
        probability: h.lossProbability,
        pctLo: h.lossLo ?? f.loss.pctLo,
        pctHi: h.lossHi ?? f.loss.pctHi
      }
    }))
    toast('Ustawiono zwrot i miesiące stratne z wyników dziennika.', 'success')
    setPreview(null)
  }

  return (
    <div className="flex flex-col gap-1.5" data-testid="fc-from-journal">
      <div className="flex items-center gap-2">
        <button className="btn" disabled={readOnly} onClick={compute} data-testid="fc-history">
          Weź z moich wyników
        </button>
        <span className="text-[11.5px] text-muted">zwrot miesięczny = suma R × ryzyko % zamkniętych transakcji</span>
      </div>
      {preview &&
        (preview.result ? (
          <div className="flex flex-col gap-1.5 border border-line px-2 py-1.5 text-[12px]" data-testid="fc-history-preview">
            <span>
              Z {preview.result.months} miesięcy ({preview.result.from} – {preview.result.to}): średnio{' '}
              <b className="num font-medium">{pct(preview.result.mean)}</b> / mies.; miesiące zyskowne{' '}
              <b className="num font-medium">
                {pct(preview.result.gainLo)} – {pct(preview.result.gainHi)}
              </b>
              {preview.result.lossLo != null ? (
                <>
                  ; stratne <b className="num font-medium">{pct(preview.result.lossProbability)}</b> miesięcy, strata{' '}
                  <b className="num font-medium">
                    {pct(preview.result.lossLo)} – {pct(preview.result.lossHi!)}
                  </b>
                </>
              ) : (
                '; bez miesięcy stratnych'
              )}
              .
            </span>
            <span className="flex gap-2">
              <button className="btn btn-accent" onClick={() => apply(preview.result!)} data-testid="fc-history-apply">
                Ustaw w scenariuszu
              </button>
              <button className="btn btn-ghost" onClick={() => setPreview(null)}>
                Anuluj
              </button>
            </span>
          </div>
        ) : (
          <p className="text-[12px] text-accent" data-testid="fc-history-preview">
            Za mało danych: potrzeba co najmniej {MIN_HISTORY_MONTHS} miesięcy z zamkniętymi transakcjami (jest {preview.months}).
          </p>
        ))}
    </div>
  )
}
