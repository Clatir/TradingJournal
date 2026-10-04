import { Fragment, useRef, useState, type ReactNode } from 'react'
import type { ForecastInput, ForecastResult, ForecastRow } from '@shared/calc/forecast'
import { forecastColumnsVisible, forecastTable, forecastTsv, forecastYears, goalName, type ForecastYear } from '@shared/export/forecast'
import type { Forecast } from '@shared/schema'
import { api, errorMessage } from '../../lib/api'
import { countLabel, fmtAmount, fmtPct, fmtPctShort, parseAmountInput as parseDeposit } from '../../lib/format'
import { toast } from '../../store/ui'
import { Badge, Panel, cx } from '../../components/ui'
import { updateScenario } from './actions'
import { useForecastSession } from './session'
import { tableDescription } from './texts'

/** "Miesiąc po miesiącu" (chapter 7). */
export function MonthTable({ scenario, input, result, readOnly }: { scenario: Forecast; input: ForecastInput; result: ForecastResult; readOnly: boolean }) {
  const fund = scenario.keep === 'fund'
  const pipsMode = scenario.gain === 'pips'
  const visible = forecastColumnsVisible(scenario, input)
  const inputs = useRef(new Map<number, HTMLInputElement>())
  const hasCustom = Object.keys(scenario.deposits).length > 0
  const names = new Map(scenario.goals.map((g) => [g.id, goalName(g.name)]))
  const years = forecastYears(result, input)
  const collapsed = useForecastSession((s) => s.collapsed)
  const yearKey = (year: number) => `${scenario.id}:${year}`
  const isCollapsed = (year: number) => !!collapsed[yearKey(year)]
  const allCollapsed = years.every((y) => isCollapsed(y.year))
  const setCollapsed = (keys: string[], on: boolean) =>
    useForecastSession.setState((st) => {
      const next = { ...st.collapsed }
      for (const k of keys) {
        if (on) next[k] = true
        else delete next[k]
      }
      return { collapsed: next }
    })

  const setDeposit = (k: number, v: number | null) =>
    updateScenario(scenario.id, (f) => {
      const deposits = { ...f.deposits }
      if (v == null) delete deposits[String(k)]
      else deposits[String(k)] = v
      return { ...f, deposits }
    })
  /** Next visible month in that direction (months of collapsed years are skipped). */
  const focusMonth = (from: number, dir: 1 | -1) => {
    for (let k = from + dir; k >= 1 && k <= input.horizon; k += dir) {
      const el = inputs.current.get(k)
      if (!el) continue
      el.focus()
      el.select()
      return
    }
  }
  const copy = async () => {
    try {
      await api.copyText(forecastTsv(forecastTable(result, scenario, input)))
      toast('Skopiowano. Wklej w Excelu (Ctrl+V).', 'success')
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  const head = (title: ReactNode, sub?: string, extra?: string) => (
    <th className={extra}>
      <div>{title}</div>
      {sub && <div className="text-[10px] font-normal text-dim">{sub}</div>}
    </th>
  )

  return (
    <Panel
      title="Miesiąc po miesiącu"
      actions={
        <div className="flex items-center gap-1.5">
          {hasCustom && (
            <button
              className="btn h-[22px] px-2 text-[11.5px]"
              disabled={readOnly}
              onClick={() => updateScenario(scenario.id, (f) => ({ ...f, deposits: {} }))}
              data-testid="fc-reset-deposits"
            >
              Przywróć standardowe wpłaty
            </button>
          )}
          <button
            className="btn h-[22px] px-2 text-[11.5px]"
            onClick={() => setCollapsed(years.map((y) => yearKey(y.year)), !allCollapsed)}
            data-testid="fc-years-toggle"
          >
            {allCollapsed ? 'Rozwiń lata' : 'Zwiń lata'}
          </button>
          <button className="btn h-[22px] px-2 text-[11.5px]" onClick={copy} data-testid="fc-copy">
            Kopiuj tabelę
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-2">
        <div className="text-[12px] text-fg" data-testid="fc-table-description">
          {tableDescription(scenario, input, result)}
        </div>
        <p className="text-[11.5px] text-muted">
          W kolumnie <b className="text-fg">Wpłata</b> możesz wpisać inną kwotę dla każdego miesiąca, także 0 albo kwotę ujemną (wypłata z kapitału). Puste pole
          oznacza standardową dopłatę. Enter przechodzi do następnego miesiąca.
        </p>
        <div className="max-h-[70vh] overflow-auto border border-line" data-testid="fc-table">
          <table className="fc-table num w-full border-collapse text-[12px]">
            <thead>
              <tr>
                {head('Miesiąc', undefined, 'fc-sticky')}
                {head('Zwrot', pipsMode ? 'z pipsów' : undefined)}
                {head('Wpłata', 'puste = standardowa')}
                {visible.tax && head('Podatek')}
                {visible.pips && head('Pipsy')}
                {visible.lot && head('Lot')}
                {head(fund ? 'Masa obrotowa na początku' : 'Kapitał na początku', fund ? 'kapitał + fundusz' : undefined)}
                {head('Zysk', fund ? 'z całej masy' : undefined)}
                <th data-testid="fc-col-payout">
                  <div>{fund ? `Odkładana wypłata (${fmtPctShort(scenario.payoutPercent)})` : `Wypłata (${fmtPctShort(scenario.payoutPercent)})`}</div>
                  {fund && <div className="text-[10px] font-normal text-dim">zostaje w masie</div>}
                </th>
                {head(fund ? 'Fundusz celowy' : 'Odłożona gotówka', fund ? 'suma odłożonych wypłat' : 'nie zarabia')}
                {visible.goals && head('Cel zakupowy', undefined, 'text-left')}
                {head(fund ? 'Masa obrotowa na koniec' : 'Kapitał na koniec', fund ? 'po zakupach' : undefined)}
              </tr>
            </thead>
            <tbody>
              {years.map((y) => (
                <Fragment key={y.year}>
                  {!isCollapsed(y.year) &&
                    result.rows.slice(y.fromK - 1, y.toK).map((row) => (
                      <MonthRow
                        key={row.k}
                        row={row}
                        scenario={scenario}
                        visible={visible}
                        pipsMode={pipsMode}
                        names={names}
                        readOnly={readOnly}
                        inputRef={(el) => (el ? inputs.current.set(row.k, el) : inputs.current.delete(row.k))}
                        onDeposit={setDeposit}
                        onNav={(dir) => focusMonth(row.k, dir)}
                      />
                    ))}
                  <YearRow year={y} visible={visible} collapsed={isCollapsed(y.year)} onToggle={() => setCollapsed([yearKey(y.year)], !isCollapsed(y.year))} />
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Panel>
  )
}

/** Summary of a calendar year (chapter 7.3); a click folds / unfolds its months. */
function YearRow({ year: y, visible, collapsed, onToggle }: { year: ForecastYear; visible: ReturnType<typeof forecastColumnsVisible>; collapsed: boolean; onToggle: () => void }) {
  return (
    <tr className="fc-year cursor-default" onClick={onToggle} data-testid={`fc-year-${y.year}`} aria-expanded={!collapsed}>
      <td className="fc-sticky font-medium text-fg-strong">
        <span className="inline-block w-[12px] text-muted">{collapsed ? '▸' : '▾'}</span>Rok {y.year}
      </td>
      <td className={cx('text-right', y.rate < 0 && 'text-down')}>{fmtPct(y.rate * 100)}</td>
      <td className="text-right">{fmtAmount(y.deposit)}</td>
      {visible.tax && <td className="text-right">{y.tax > 0 ? fmtAmount(y.tax) : ''}</td>}
      {visible.pips && <td />}
      {visible.lot && <td />}
      <td />
      <td className={cx('text-right', y.profit < 0 && 'text-down')}>{fmtAmount(y.profit)}</td>
      <td className="text-right">{fmtAmount(y.payout)}</td>
      <td className="text-right">{fmtAmount(y.pot)}</td>
      {visible.goals && <td className="text-left font-sans">{y.buys ? `${countLabel(y.buys, 'cel', 'cele', 'celów')} · ${fmtAmount(y.spent)}` : '—'}</td>}
      <td className="text-right font-medium text-fg-strong">{fmtAmount(y.end)}</td>
    </tr>
  )
}

function MonthRow({
  row,
  scenario,
  visible,
  pipsMode,
  names,
  readOnly,
  inputRef,
  onDeposit,
  onNav
}: {
  row: ForecastRow
  scenario: Forecast
  visible: ReturnType<typeof forecastColumnsVisible>
  pipsMode: boolean
  names: Map<string, string>
  readOnly: boolean
  inputRef: (el: HTMLInputElement | null) => void
  onDeposit: (k: number, v: number | null) => void
  onNav: (dir: 1 | -1) => void
}) {
  const custom = scenario.deposits[String(row.k)]
  const standard = row.k === 1 ? 0 : scenario.monthlyDeposit
  const red = (v: number) => (row.loss || v < 0 ? 'text-down' : undefined)
  return (
    <tr className={cx(row.buys.length > 0 && 'fc-buy')} data-testid={`fc-row-${row.k}`}>
      <td className="fc-sticky">
        <span className="font-medium text-fg-strong">{row.k}</span> <span className="text-dim">{row.label}</span>
      </td>
      <td className={cx('text-right', red(row.rate))}>{fmtPct(row.rate * 100)}</td>
      <td className="text-right">
        <DepositInput k={row.k} label={row.label} value={custom} standard={standard} readOnly={readOnly} inputRef={inputRef} onChange={onDeposit} onNav={onNav} />
      </td>
      {visible.tax && <td className="text-right">{row.tax > 0 ? fmtAmount(row.tax) : ''}</td>}
      {visible.pips && <td className={cx('text-right', red(row.pips ?? 0))}>{row.pips == null ? '' : fmtAmount(row.pips, undefined, 1)}</td>}
      {visible.lot && <td className="text-right">{row.lot == null ? '' : String(Number(row.lot.toFixed(6)))}</td>}
      <td className="text-right">{fmtAmount(row.start)}</td>
      <td className={cx('text-right', red(row.profit))}>{fmtAmount(row.profit)}</td>
      <td className="text-right">{fmtAmount(row.payout)}</td>
      <td className="text-right">{fmtAmount(row.pot)}</td>
      {visible.goals && (
        <td className="text-left font-sans">
          {row.buys.length ? (
            <span className="flex flex-wrap items-center gap-1.5">
              {row.buys.map((b) => (
                <span key={b.goalId} className="inline-flex items-center gap-1">
                  <Badge tone="accent">{names.get(b.goalId) ?? goalName(b.name)}</Badge>
                  <span className="num text-fg-strong">{fmtAmount(b.amount)}</span>
                </span>
              ))}
            </span>
          ) : row.head ? (
            <span className="text-dim">na: {names.get(row.head) ?? 'Bez nazwy'}</span>
          ) : (
            <span className="text-dim">—</span>
          )}
        </td>
      )}
      <td className="text-right font-medium text-fg-strong">{fmtAmount(row.end)}</td>
    </tr>
  )
}

/**
 * Deposit of one month: empty = the standard one, a number = a custom deposit (negative = withdrawal from
 * capital). Recalculates on every character without losing focus; Enter / ↓ next month, ↑ previous one.
 */
function DepositInput({
  k,
  label,
  value,
  standard,
  readOnly,
  inputRef,
  onChange,
  onNav
}: {
  k: number
  label: string
  value: number | undefined
  standard: number
  readOnly: boolean
  inputRef: (el: HTMLInputElement | null) => void
  onChange: (k: number, v: number | null) => void
  onNav: (dir: 1 | -1) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? (value == null ? '' : fmtAmount(value))
  const invalid = draft != null && parseDeposit(draft) === undefined
  return (
    <input
      ref={inputRef}
      className="input num fc-dep"
      inputMode="decimal"
      spellCheck={false}
      value={shown}
      placeholder={fmtAmount(standard)}
      readOnly={readOnly}
      data-custom={value != null}
      aria-invalid={invalid}
      aria-label={`Wpłata w miesiącu ${k} (${label})`}
      data-testid={`fc-dep-${k}`}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => {
        const t = e.currentTarget.value
        setDraft(t)
        const v = parseDeposit(t)
        if (v !== undefined) onChange(k, v)
      }}
      onBlur={() => setDraft(null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'ArrowDown') {
          e.preventDefault()
          setDraft(null)
          onNav(1)
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          setDraft(null)
          onNav(-1)
        }
      }}
    />
  )
}
