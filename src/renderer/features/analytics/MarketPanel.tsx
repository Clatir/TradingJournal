import { useMemo, type ReactNode } from 'react'
import type { AnalyzedTrade } from '@shared/calc/analytics'
import { excursionTiming, volatilityBreakdown, whatIfSummary, type GroupLine } from '@shared/calc/marketAnalytics'
import { countLabel, fmtPercent, fmtR, tone, toneClass } from '../../lib/format'
import { navigate } from '../../store/ui'
import { Panel, cx } from '../../components/ui'

/**
 * Analytics → "Dane rynkowe" (EODHD, 1.10.0): other ways to manage the same trades, results by the day's volatility
 * and by the stop in ATR, when the extremes came. Only trades with a market summary count.
 */
export function MarketPanel({ rows, be }: { rows: readonly AnalyzedTrade[]; be: number }) {
  const data = useMemo(() => ({ w: whatIfSummary(rows, be), v: volatilityBreakdown(rows, be), t: excursionTiming(rows, be) }), [rows, be])
  const { w, v, t } = data
  if (!w.trades && !v.measured && !t.measured)
    return (
      <Section title="Dane rynkowe: co by było, gdyby · zmienność" className="border-t">
        <div className="text-[12px] text-muted">
          Brak transakcji z danymi rynkowymi w zakresie.{' '}
          <button className="underline hover:text-fg-strong" onClick={() => navigate({ page: 'settings', tab: 'market' })}>
            Ustawienia → Dane rynkowe
          </button>
        </div>
      </Section>
    )
  return (
    <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] border-t border-line" data-testid="market-analytics">
      <Section title={`Co by było, gdyby – te same wejścia i SL (${countLabel(w.trades, 'transakcja', 'transakcje', 'transakcji')})`} className="border-r">
        <div className="text-[12px]" data-testid="what-if">
          <div className="grid grid-cols-[minmax(0,1fr)_44px_60px_70px_70px_64px] border-b border-line pb-1 text-[10.5px] uppercase tracking-wide text-muted">
            <span>Zarządzanie</span>
            <span className="text-right">n</span>
            <span className="text-right">WR</span>
            <span className="text-right">Σ R</span>
            <span className="text-right">różnica</span>
            <span className="text-right">maks. DD</span>
          </div>
          {w.lines.filter((x) => x.id === 'actual' || x.count).map((x) => (
            <div
              key={x.id}
              className={cx('grid grid-cols-[minmax(0,1fr)_44px_60px_70px_70px_64px] border-b border-line/50 py-[3px] last:border-b-0', x.id === 'actual' && 'font-medium text-fg-strong')}
              title={`${x.hint}${x.uncertain ? ` · niepewne: ${x.uncertain} (SL i cel w tej samej minucie albo poziom w marginesie)` : ''}`}
              data-testid={`what-if-${x.id}`}
            >
              <span className="truncate">
                {x.label}
                {x.uncertain ? <span className="text-dim"> ·{x.uncertain}?</span> : null}
              </span>
              <span className="num text-right text-muted">{x.count}</span>
              <span className="num text-right">{fmtPercent(x.winRate)}</span>
              <span className={cx('num text-right', toneClass[tone(x.totalR, be)])}>{fmtR(x.totalR, 1)}</span>
              <span className={cx('num text-right', x.id === 'actual' ? 'text-dim' : toneClass[tone(x.deltaR, be)])}>{x.id === 'actual' ? '—' : fmtR(x.deltaR, 1)}</span>
              <span className="num text-right text-muted">{x.maxDrawdownR ? `−${x.maxDrawdownR.toFixed(1)}R` : '0R'}</span>
            </div>
          ))}
          <p className="mt-1.5 text-[11px] text-muted">
            Odtworzenie na świecach M1 od minuty po wejściu do 17:00 NY (albo do wyjścia, gdy było później); bez rozstrzygnięcia – zamknięcie po
            ostatniej cenie. Plany z TP2 tylko dla transakcji z TP2.
          </p>
        </div>
      </Section>
      <div className="flex flex-col">
        <Section title={`Zmienność dnia (ATR 14, zmierzone: ${v.measured})`}>
          <Groups rows={v.regimes} be={be} empty="Za mało transakcji na parę (min. 4), by wyznaczyć percentyle." testId="regimes" />
        </Section>
        <Section title="Wielkość SL względem ATR" className="border-t">
          <Groups rows={v.stops} be={be} empty="Brak transakcji z SL i ATR." testId="sl-atr" />
        </Section>
        <Section title={`MAE / MFE z rynku (zmierzone: ${t.measured})`} className="border-t">
          <div className="num flex flex-col gap-0.5 text-[12px]" data-testid="excursion-timing">
            <span>
              Przed wyjściem do 1R: <b className="text-fg-strong">{fmtPercent(t.reached1R)}</b> · do 2R: <b className="text-fg-strong">{fmtPercent(t.reached2R)}</b>
            </span>
            <span>
              Mediana czasu do MFE wygranych: <b className="text-fg-strong">{t.mfeMinutesWinners == null ? '—' : `${Math.round(t.mfeMinutesWinners)} min`}</b>, do MAE strat:{' '}
              <b className="text-fg-strong">{t.maeMinutesLosers == null ? '—' : `${Math.round(t.maeMinutesLosers)} min`}</b>
            </span>
            {t.stopTouchedSurvived > 0 && (
              <span className="text-muted" title="Inne źródło cen niż broker albo SL ustawiony / przesunięty później">
                SL dotknięty według cen rynku, a pozycja przetrwała: {t.stopTouchedSurvived}
              </span>
            )}
          </div>
        </Section>
      </div>
    </div>
  )
}

function Groups({ rows, be, empty, testId }: { rows: GroupLine[]; be: number; empty: string; testId: string }) {
  if (!rows.some((x) => x.count)) return <span className="text-[11.5px] text-muted">{empty}</span>
  return (
    <div className="text-[12px]" data-testid={testId}>
      {rows.filter((x) => x.count).map((x) => (
        <div key={x.id} className="grid grid-cols-[minmax(0,1fr)_34px_56px_64px] border-b border-line/50 py-[3px] last:border-b-0">
          <span className="truncate">{x.label}</span>
          <span className="num text-right text-muted">{x.count}</span>
          <span className="num text-right">{fmtPercent(x.winRate)}</span>
          <span className={cx('num text-right', toneClass[tone(x.totalR, be)])}>{fmtR(x.totalR, 1)}</span>
        </div>
      ))}
    </div>
  )
}

function Section({ title, children, className }: { title: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Panel title={title} className={cx('border-0 border-line', className)}>
      {children}
    </Panel>
  )
}
