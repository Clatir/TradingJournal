import { useState } from 'react'
import { positionSize } from '@shared/calc/position'
import { fmtMoney, fmtR, tone, toneClass } from '../../lib/format'
import { metricsFor, useDailyLimits } from '../../store/derived'
import { updateJournal, updateRecord, useJournal } from '../../store/journal'
import { navigate, toast } from '../../store/ui'
import { Field, NumberField, Panel, cx } from '../../components/ui'
import { PnlCalculator } from './PnlCalculator'

/** Position size calculator (lots from balance, risk % and stop in pips), P/L calculator and daily limits. */
export function CalculatorPage({ tradeId }: { tradeId?: string }) {
  const journal = useJournal((s) => s.journal)
  const trade = useJournal((s) => (tradeId ? s.trades[tradeId]?.record : undefined))
  const settings = journal?.settings
  const initialPair = trade?.pair ?? settings?.pairs.find((p) => p.symbol === 'EURUSD')?.symbol ?? settings?.pairs[0]?.symbol ?? 'EURUSD'
  const [pair, setPair] = useState(initialPair)
  const [riskPercent, setRiskPercent] = useState<number | null>(trade?.riskPercent ?? settings?.risk.defaultRiskPercent ?? 0.5)
  const initialStop = trade && settings ? metricsFor(trade, settings).riskPips : null
  const [stopPips, setStopPips] = useState<number | null>(initialStop != null ? Number(initialStop.toFixed(1)) : 15)
  const limits = useDailyLimits(new Date().toISOString())

  if (!journal || !settings) return null
  const pairCfg = settings.pairs.find((p) => p.symbol === pair)
  const account = settings.risk.accountCurrency
  const quote = pairCfg?.quoteCurrency ?? 'USD'
  const sameCurrency = quote === account
  const rate = sameCurrency ? 1 : (settings.risk.conversionRates[quote] ?? null)
  const balance = settings.risk.accountBalance

  const result =
    balance != null && riskPercent != null && stopPips != null && rate != null
      ? positionSize({
          balance,
          riskPercent,
          stopPips,
          pipSize: pairCfg?.pipSize ?? 0.0001,
          contractSize: settings.risk.contractSize,
          quoteToAccountRate: rate,
          lotStep: settings.risk.lotStep
        })
      : null

  const setRisk = (patch: Partial<typeof settings.risk>) => updateJournal((j) => ({ ...j, settings: { ...j.settings, risk: { ...j.settings.risk, ...patch } } }))

  const apply = () => {
    if (!tradeId || !result) return
    updateRecord('trades', tradeId, (t) => ({ ...t, lots: result.lots, riskPercent, riskAmount: Number(result.actualRiskAmount.toFixed(2)) }))
    toast(`Zapisano w transakcji: ${result.lots.toFixed(2)} lota, ryzyko ${result.actualRiskAmount.toFixed(2)} ${account}.`, 'success')
    navigate({ page: 'trade', id: tradeId })
  }

  return (
    <div className="h-full overflow-y-auto p-3" data-testid="calculator">
      <div className="mx-auto grid max-w-[1040px] grid-cols-[1fr_1fr] gap-3">
        <Panel title="Kalkulator pozycji">
          <div className="flex flex-col gap-2">
            <Field label={`Kapitał (${account})`}>
              <NumberField value={balance} onChange={(v) => setRisk({ accountBalance: v != null && v >= 0 ? v : null })} decimals={2} placeholder="np. 10000" data-testid="calc-balance" />
            </Field>
            <Field label="Ryzyko %">
              <NumberField value={riskPercent} onChange={setRiskPercent} decimals={2} step={0.05} data-testid="calc-risk" />
            </Field>
            <Field label="Para">
              <select className="input" value={pair} onChange={(e) => setPair(e.currentTarget.value)} aria-label="Para">
                {settings.pairs
                  .filter((p) => !p.archived || p.symbol === pair)
                  .map((p) => (
                    <option key={p.symbol} value={p.symbol}>
                      {p.symbol} (kwotowana {p.quoteCurrency})
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="SL (pips)">
              <NumberField value={stopPips} onChange={setStopPips} decimals={1} step={0.5} data-testid="calc-sl" />
            </Field>
            <Field
              label="Kurs"
              hint={sameCurrency ? 'waluta kwotowana = waluta konta, kurs 1' : `ile ${account} kosztuje 1 ${quote} – wpisz ręcznie (zapamiętywany)`}
            >
              {sameCurrency ? (
                <span className="num text-muted">
                  1 {quote} = 1 {account}
                </span>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="num w-[54px] text-muted">1 {quote} =</span>
                  <NumberField
                    value={rate}
                    onChange={(v) => v && v > 0 && setRisk({ conversionRates: { ...settings.risk.conversionRates, [quote]: v } })}
                    decimals={4}
                    step={0.0001}
                    data-testid="calc-rate"
                  />
                  <span className="num text-muted">{account}</span>
                </div>
              )}
            </Field>
          </div>
        </Panel>

        <Panel title="Wynik">
          {result ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-baseline gap-3">
                <span className="num text-[34px] leading-none font-medium text-fg-strong" data-testid="calc-lots">
                  {result.lots.toFixed(2)}
                </span>
                <span className="text-muted">lota</span>
                <span className="num ml-auto text-[12px] text-dim">dokładnie {result.lotsExact.toFixed(4)}</span>
              </div>
              <div className="grid grid-cols-2 border border-line">
                <Cell label="Ryzyko docelowe" value={`${result.riskAmount.toFixed(2)} ${account}`} />
                <Cell label="Ryzyko po zaokrągleniu" value={`${result.actualRiskAmount.toFixed(2)} ${account} (${result.actualRiskPercent.toFixed(2)}%)`} />
                <Cell label="Wartość pipsa / 1 lot" value={`${result.pipValuePerLot.toFixed(2)} ${account}`} />
                <Cell label="Wartość pipsa / pozycja" value={`${(result.pipValuePerLot * result.lots).toFixed(2)} ${account}`} />
              </div>
              <p className="text-[11.5px] text-muted">
                Loty zaokrąglane w dół do kroku {settings.risk.lotStep}, więc ryzyko nigdy nie przekracza zadanego. Lot = {settings.risk.contractSize.toLocaleString('pl-PL')} jednostek.
              </p>
              {tradeId && (
                <button className="btn btn-accent self-start" onClick={apply} data-testid="calc-apply">
                  Zastosuj do transakcji
                </button>
              )}
            </div>
          ) : (
            <div className="text-muted">
              {balance == null ? 'Wpisz kapitał konta.' : rate == null ? `Wpisz kurs ${quote} → ${account}.` : 'Uzupełnij ryzyko i SL.'}
            </div>
          )}
        </Panel>

        <PnlCalculator settings={settings} />

        <Panel title="Limity dzienne" className="col-span-2">
          <div className="grid grid-cols-[1fr_1fr_1.4fr] items-start gap-4">
            <Field label="Limit straty (R)">
              <NumberField
                value={settings.risk.dailyLossLimitR}
                onChange={(v) => setRisk({ dailyLossLimitR: v != null && v > 0 ? v : null })}
                decimals={1}
                step={0.5}
                placeholder="brak"
              />
            </Field>
            <Field label="Maks. transakcji">
              <NumberField
                value={settings.risk.dailyMaxTrades}
                onChange={(v) => setRisk({ dailyMaxTrades: v != null && v >= 1 ? Math.round(v) : null })}
                decimals={0}
                step={1}
                placeholder="brak"
              />
            </Field>
            {limits && (
              <div className="flex flex-col gap-1 text-[12px]">
                <span className="text-muted">Dziś ({limits.date}, data NY)</span>
                <span>
                  Wynik:{' '}
                  <span className={cx('num', toneClass[tone(limits.totalR)])}>{fmtR(limits.totalR)}</span>
                  {limits.lossLimitR != null && <span className="num text-dim"> / limit −{limits.lossLimitR.toFixed(1)}R</span>}
                </span>
                <span>
                  Transakcje: <span className="num text-fg-strong">{limits.trades}</span>
                  {limits.maxTrades != null && <span className="num text-dim"> / {limits.maxTrades}</span>}
                </span>
                {(limits.lossLimitHit || limits.maxTradesHit) && (
                  <span className="text-accent" data-testid="limit-warning">
                    {limits.lossLimitHit ? 'Dzienny limit straty osiągnięty – koniec handlu na dziś. ' : ''}
                    {limits.maxTradesHit ? 'Limit liczby transakcji osiągnięty.' : ''}
                  </span>
                )}
                {settings.display.showMoney && limits.trades > 0 && balance != null && (
                  <span className="text-dim">≈ {fmtMoney((limits.totalR * balance * (settings.risk.defaultRiskPercent / 100)), account)} przy ryzyku domyślnym</span>
                )}
              </div>
            )}
          </div>
        </Panel>
      </div>
    </div>
  )
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 border-r border-b border-line px-2 py-1.5 [&:nth-child(2n)]:border-r-0 [&:nth-last-child(-n+2)]:border-b-0">
      <span className="label">{label}</span>
      <span className="num text-[13px] text-fg-strong">{value}</span>
    </div>
  )
}
