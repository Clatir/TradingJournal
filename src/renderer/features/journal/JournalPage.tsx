import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { fileUrl } from '@shared/api'
import { shownDecimals } from '@shared/calc/position'
import { summarize } from '@shared/calc/stats'
import { formatClock, weekdayNy } from '@shared/calc/time'
import { customValueText, filterRows, gridMinWidth, gridTemplate, resolveColumns, tradeAmount, type ColumnDef } from '@shared/journalView'
import type { JournalFile, TradeStatus } from '@shared/schema'
import { fmtMoney, fmtNum, fmtPercent, fmtPips, fmtR, fmtRatio, tone, toneClass, WEEKDAY_PL, fmtPrice } from '../../lib/format'
import { dictName, useTradeRows, type TradeRow } from '../../store/derived'
import { useJournal } from '../../store/journal'
import { navigate, openLightbox, useUi } from '../../store/ui'
import { IconCopy, IconImage, IconPlus, IconSearch } from '../../components/icons'
import { Badge, Kbd, Segmented, cx } from '../../components/ui'
import { newTrade } from '../trade/actions'
import { duplicateTradeEntry } from '../duplicate'
import { ColumnsMenu, FiltersButton, SavedFiltersMenu, setFilter, useJournalFilter } from './JournalTools'
import { toggleMoney } from '../money'

const STATUS_LABEL: Record<TradeStatus, string> = { closed: 'zamkn.', open: 'otwarta', missed: 'missed' }

function duration(from: string, to: string | null): string {
  if (!to) return '—'
  const min = Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 60_000))
  if (min < 60) return `${min}m`
  if (min < 24 * 60) return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`
  return `${Math.floor(min / 1440)}d ${Math.floor((min % 1440) / 60)}h`
}

/** One cell of the list. */
function cell(col: ColumnDef, row: TradeRow, journal: JournalFile | null, be: number): ReactNode {
  const { trade: t, m } = row
  if (col.field) {
    const text = customValueText(col.field, t.custom[col.field.id])
    return <span className={cx('truncate', col.field.type === 'number' && 'num text-right', !text && 'text-dim')}>{text || '—'}</span>
  }
  switch (col.id) {
    case 'date':
      return <span className="num text-fg-strong">{m.tradingDate}</span>
    case 'weekday':
      return <span className="text-muted">{WEEKDAY_PL[weekdayNy(t.entryTime)]}</span>
    case 'ny':
      return <span className="num">{formatClock(t.entryTime, 'NY')}</span>
    case 'waw':
      return <span className="num text-muted">{formatClock(t.entryTime, 'WAW')}</span>
    case 'pair':
      return <span className="num text-fg-strong">{t.pair}</span>
    case 'direction':
      return <span className={t.direction === 'long' ? 'text-fg-strong' : 'text-fg'}>{t.direction === 'long' ? 'Long' : 'Short'}</span>
    case 'killzone':
      return row.continuation ? (
        <span className="truncate text-muted" title="Kontynuacja: transakcja otwarta ponownie po zamknięciu – killzone z pierwszego wejścia" data-testid="row-continuation">
          ↻ {m.killzoneNames.join(', ') || 'kontynuacja'}
        </span>
      ) : (
        <span className="truncate text-muted">{m.killzoneNames.join(', ') || '—'}</span>
      )
    case 'model':
      return <span className="truncate">{dictName(journal, 'entryModels', t.entryModelId) || <span className="text-dim">—</span>}</span>
    case 'status':
      return <span className={cx('text-[11px]', t.status === 'closed' ? 'text-muted' : 'text-accent')}>{STATUS_LABEL[t.status]}</span>
    case 'sl':
      return <span className="num text-right">{m.riskPips != null ? m.riskPips.toFixed(1) : '—'}</span>
    case 'rr':
      return <span className="num text-right">{fmtRatio(m.rrTp1)}</span>
    case 'pips':
      return <span className={cx('num text-right', t.status === 'missed' ? 'text-dim' : toneClass[tone(m.resultPips)])}>{fmtPips(m.resultPips)}</span>
    case 'r':
      return <span className={cx('num text-right font-medium', t.status === 'missed' ? 'text-dim' : toneClass[tone(m.resultR, be)])}>{fmtR(m.resultR)}</span>
    case 'score':
      return (
        <span
          className={cx('num text-right text-[11px]', row.v.compliant === false ? 'text-accent' : 'text-muted')}
          title={row.v.broken.map((b) => `${b.label}: ${b.detail}`).join('\n') || 'zgodna z zasadami'}
        >
          {row.v.score == null ? '—' : `${Math.round(row.v.score * 100)}%`}
        </span>
      )
    case 'mistakes':
      return <span className="truncate text-[11px] text-muted">{t.psychology.mistakeTagIds.map((id) => dictName(journal, 'mistakeTags', id)).join(', ')}</span>
    case 'pdArray':
      return <span className="truncate text-muted">{[dictName(journal, 'pdArrays', t.entryPdArrayId), dictName(journal, 'pdArrays', t.htfPdArrayId)].filter(Boolean).join(' · ') || '—'}</span>
    case 'liquidity':
      return <span className="truncate text-muted">{t.liquidityTakenIds.map((id) => dictName(journal, 'liquidityPools', id)).join(', ') || '—'}</span>
    case 'exitNy':
      return <span className="num text-muted">{m.exitTime ? formatClock(m.exitTime, 'NY') : '—'}</span>
    case 'duration':
      return <span className="num text-right text-muted">{duration(t.entryTime, m.exitTime)}</span>
    case 'lots':
      return <span className="num text-right">{t.lots != null ? fmtNum(t.lots, shownDecimals(t.lots, 2)) : '—'}</span>
    case 'risk':
      return <span className="num text-right">{t.riskPercent != null ? `${fmtNum(t.riskPercent, shownDecimals(t.riskPercent, 1))}%` : '—'}</span>
    case 'amount':
      return journal?.settings.display.showMoney ? (
        <AmountText row={row} journal={journal} className="truncate text-right" />
      ) : (
        <span className="num text-right text-dim" title="Kwoty są ukryte – kliknij nagłówek „Kwota” albo Ctrl+$">
          •••
        </span>
      )
    case 'notes':
      return <span className="truncate text-muted">{t.notes.split('\n')[0]}</span>
    default:
      return <span />
  }
}

/** The money result of a row: exact, "≈" estimate from risk % × balance, or "—" with what is missing. */
function AmountText({ row, journal, className }: { row: TradeRow; journal: JournalFile; className?: string }) {
  const a = tradeAmount(row.trade, row.m, journal.settings.risk)
  return (
    <span className={cx('num', className, a.value == null ? 'text-dim' : toneClass[tone(a.value)], a.estimated && 'opacity-80')} title={a.hint} data-testid="trade-amount">
      {a.value == null ? '—' : `${a.estimated ? '≈ ' : ''}${fmtMoney(a.value, journal.settings.risk.accountCurrency)}`}
    </span>
  )
}

export function JournalPage() {
  const rows = useTradeRows()
  const journal = useJournal((s) => s.journal)
  const selectedId = useUi((s) => s.selectedTradeId)
  const filter = useJournalFilter((s) => s.filter)
  const { pair, status } = filter
  const [hover, setHover] = useState<{ row: TradeRow; x: number; y: number } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const be = journal?.settings.stats.breakevenThresholdR ?? 0.1
  const columns = useMemo(() => resolveColumns(journal?.settings.journalView.columns ?? null, journal?.settings.customFields ?? []), [journal])
  const template = gridTemplate(columns)

  const deferredFilter = useDeferredValue(filter)
  const filtered = useMemo(() => filterRows(rows, deferredFilter, journal), [rows, deferredFilter, journal])

  const summary = useMemo(
    () => summarize(filtered.filter((r) => r.m.countsInStats).map((r) => ({ r: r.m.resultR as number, time: r.m.exitTime ?? r.trade.entryTime })), be),
    [filtered, be]
  )
  const showMoney = journal?.settings.display.showMoney ?? false
  // Σ of the amounts of closed trades (estimates included and marked; trades without an amount counted apart).
  const amountSum = useMemo(() => {
    if (!journal || !showMoney) return null
    let sum = 0
    let known = 0
    let estimated = false
    const closed = filtered.filter((r) => r.m.countsInStats)
    for (const r of closed) {
      const a = tradeAmount(r.trade, r.m, journal.settings.risk)
      if (a.value == null) continue
      sum += a.value
      known++
      estimated ||= a.estimated
    }
    return { sum, known, total: closed.length, estimated }
  }, [filtered, journal, showMoney])

  const virtualizer = useVirtualizer({ count: filtered.length, getScrollElement: () => scrollRef.current, estimateSize: () => 26, overscan: 24 })

  const selectedIndex = filtered.findIndex((r) => r.trade.id === selectedId)
  const selected = selectedIndex >= 0 ? filtered[selectedIndex] : (filtered[0] ?? null)

  const select = (id: string) => useUi.setState({ selectedTradeId: id })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useUi.getState().paletteOpen || useUi.getState().lightbox) return
      const el = document.activeElement
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')
      if (e.key === '/' && !typing) {
        e.preventDefault()
        searchRef.current?.focus()
        return
      }
      if (typing && el !== searchRef.current) return
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const cur = selectedIndex >= 0 ? selectedIndex : -1
        const next = Math.min(filtered.length - 1, Math.max(0, cur + (e.key === 'ArrowDown' ? 1 : -1)))
        const row = filtered[next]
        if (row) {
          select(row.trade.id)
          virtualizer.scrollToIndex(next, { align: 'auto' })
        }
      } else if (e.key === 'Enter' && selected) {
        e.preventDefault()
        navigate({ page: 'trade', id: selected.trade.id })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [filtered, selectedIndex, selected, virtualizer])

  const pairs = journal?.settings.pairs.filter((p) => !p.archived) ?? []

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* filters */}
        <div className="flex h-[36px] shrink-0 items-center gap-2 border-b border-line bg-panel px-2">
          <div className="relative w-[200px] shrink-0">
            <IconSearch size={13} className="absolute top-1/2 left-2 -translate-y-1/2 text-dim" />
            <input
              ref={searchRef}
              className="input pl-7"
              placeholder="Szukaj: para, model, notatki…  ( / )"
              value={filter.query}
              onChange={(e) => setFilter({ query: e.currentTarget.value })}
              data-testid="journal-search"
            />
          </div>
          <select
            className={cx('input num w-[112px] shrink-0', pair && 'border-accent/60 text-accent')}
            value={pair ?? ''}
            onChange={(e) => setFilter({ pair: e.currentTarget.value || null })}
            aria-label="Para"
            data-testid="journal-pair"
          >
            <option value="">wszystkie pary</option>
            {pairs.map((p) => (
              <option key={p.symbol} value={p.symbol}>
                {p.symbol}
              </option>
            ))}
            {pair && !pairs.some((p) => p.symbol === pair) && <option value={pair}>{pair}</option>}
          </select>
          <Segmented
            size="sm"
            className="shrink-0"
            value={status}
            onChange={(v) => setFilter({ status: v })}
            options={[
              { value: 'all', label: 'Wszystkie' },
              { value: 'closed', label: 'Zamknięte' },
              { value: 'open', label: 'Otwarte' },
              { value: 'missed', label: 'Missed' }
            ]}
          />
          <FiltersButton />
          <SavedFiltersMenu />
          <span className="ml-auto" />
          <ColumnsMenu />
          <button className="btn btn-accent shrink-0" onClick={() => newTrade()} data-testid="new-trade" title="Nowa transakcja (Ctrl+N)">
            <IconPlus size={13} /> Nowa
          </button>
        </div>

        {/* summary strip */}
        <div className="flex h-[30px] shrink-0 items-center gap-5 border-b border-line px-3 text-[11.5px]">
          <SumItem label="Wpisy" value={String(filtered.length)} />
          <SumItem label="Zamknięte" value={String(summary.count)} />
          <SumItem label="Σ R" value={fmtR(summary.totalR)} cls={toneClass[tone(summary.totalR)]} />
          <SumItem label="Win rate" value={fmtPercent(summary.winRate)} />
          <SumItem label="Expectancy" value={fmtR(summary.expectancy)} cls={toneClass[tone(summary.expectancy)]} />
          <SumItem label="W / L / BE" value={`${summary.wins} / ${summary.losses} / ${summary.breakevens}`} />
          {amountSum && amountSum.known > 0 && (
            <span
              className="flex items-baseline gap-1.5"
              title={
                (amountSum.estimated ? '≈ zawiera szacunki z ryzyka % i salda konta. ' : '') +
                (amountSum.known < amountSum.total ? `Kwota znana dla ${amountSum.known} z ${amountSum.total} zamkniętych transakcji.` : '')
              }
              data-testid="journal-amount-sum"
            >
              <span className="text-muted">Σ kwota</span>
              <span className={cx('num', toneClass[tone(amountSum.sum)])}>
                {amountSum.estimated ? '≈ ' : ''}
                {fmtMoney(amountSum.sum, journal!.settings.risk.accountCurrency)}
              </span>
              {amountSum.known < amountSum.total && (
                <span className="num text-dim">
                  ({amountSum.known}/{amountSum.total})
                </span>
              )}
            </span>
          )}
        </div>

        {/* table: scrolls sideways when the chosen columns do not fit next to the preview */}
        <div className="flex min-h-0 flex-1 flex-col overflow-x-auto overflow-y-hidden" data-testid="journal-hscroll">
          <div className="flex min-h-0 flex-1 flex-col" style={{ minWidth: gridMinWidth(columns) }}>
            <div
              className="grid h-[26px] shrink-0 items-center gap-x-1.5 border-b border-line bg-panel px-2 text-[10.5px] tracking-wide text-muted uppercase"
              style={{ gridTemplateColumns: template }}
              data-testid="journal-header"
            >
              {columns.map((c) =>
                c.id === 'amount' && !showMoney ? (
                  <button
                    key={c.id}
                    className="truncate text-right tracking-wide text-accent uppercase hover:underline"
                    onClick={toggleMoney}
                    title="Kwoty są ukryte – kliknij, by je pokazać (Ctrl+$)"
                    data-testid="amount-show"
                  >
                    {c.label} •••
                  </button>
                ) : (
                  <span key={c.id} className={cx('truncate', c.align === 'right' && 'text-right', c.field && 'normal-case')} title={c.title ?? c.label}>
                    {c.label}
                  </span>
                )
              )}
              <span />
            </div>
            <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto" data-testid="journal-table">
              {filtered.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-muted">
                  {rows.length === 0 ? (
                    <>
                      <span>Dziennik jest pusty.</span>
                      <span>
                        <Kbd>Ctrl N</Kbd> dodaje transakcję, <Kbd>Ctrl K</Kbd> otwiera paletę komend.
                      </span>
                    </>
                  ) : (
                    <span>Brak wpisów dla wybranych filtrów.</span>
                  )}
                </div>
              ) : (
                <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
                  {virtualizer.getVirtualItems().map((v) => {
                    const row = filtered[v.index] as TradeRow
                    const t = row.trade
                    const isSel = selected?.trade.id === t.id
                    return (
                      <div
                        key={t.id}
                        data-testid="journal-row"
                        onClick={() => select(t.id)}
                        onDoubleClick={() => navigate({ page: 'trade', id: t.id })}
                        className={cx(
                          'absolute left-0 grid w-full items-center gap-x-1.5 border-b border-line/70 px-2 text-[12px]',
                          isSel ? 'bg-accent-soft' : v.index % 2 ? 'bg-white/[0.012] hover:bg-hover' : 'hover:bg-hover'
                        )}
                        style={{ top: v.start, height: 26, gridTemplateColumns: template }}
                      >
                        {columns.map((c) => (
                          <span key={c.id} className={cx('min-w-0 truncate', c.align === 'right' && 'text-right')}>
                            {cell(c, row, journal, be)}
                          </span>
                        ))}
                        <span
                          className="flex items-center justify-end gap-0.5 text-dim"
                          onMouseEnter={(e) => t.screens.length && setHover({ row, x: e.clientX, y: e.clientY })}
                          onMouseLeave={() => setHover(null)}
                        >
                          {t.screens.length > 0 && (
                            <>
                              <IconImage size={12} />
                              <span className="num text-[10.5px]">{t.screens.length}</span>
                            </>
                          )}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* preview */}
      <aside className="flex w-[340px] shrink-0 flex-col border-l border-line bg-panel">
        {selected ? <Preview row={selected} be={be} /> : <div className="p-4 text-muted">Zaznacz transakcję.</div>}
      </aside>

      {hover && hover.row.trade.screens[0] && (
        <div className="pointer-events-none fixed z-40 w-[300px] animate-fade-in border border-line-strong bg-black" style={{ left: hover.x - 320, top: Math.min(hover.y - 20, window.innerHeight - 190) }}>
          <img src={fileUrl(hover.row.trade.screens[0].thumbPath)} alt="" className="block w-full" />
        </div>
      )}
    </div>
  )
}

function SumItem({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-muted">{label}</span>
      <span className={cx('num text-fg-strong', cls)}>{value}</span>
    </span>
  )
}

function Preview({ row, be }: { row: TradeRow; be: number }) {
  const journal = useJournal((s) => s.journal)
  const readOnly = useJournal((s) => s.status?.readOnly ?? false) || row.readOnly
  const { trade: t, m } = row
  const pairCfg = journal?.settings.pairs.find((p) => p.symbol === t.pair)
  const dec = pairCfg?.priceDecimals ?? 5
  const line = (label: string, value: React.ReactNode) => (
    <div className="flex items-baseline justify-between gap-3 border-b border-line/60 py-[3px]">
      <span className="text-muted">{label}</span>
      <span className="truncate text-right">{value}</span>
    </div>
  )
  return (
    <div className="flex min-h-0 flex-1 flex-col animate-fade-in" key={t.id}>
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="num text-[14px] font-medium text-fg-strong">{t.pair}</span>
        <span className="text-fg">{t.direction === 'long' ? 'Long' : 'Short'}</span>
        {t.status !== 'closed' && <Badge tone="accent">{STATUS_LABEL[t.status]}</Badge>}
        <span className={cx('num ml-auto text-[16px] font-medium', t.status === 'missed' ? 'text-dim' : toneClass[tone(m.resultR, be)])}>{fmtR(m.resultR)}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 text-[12px]">
        {line('Wejście NY', <span className="num">{m.tradingDate} {formatClock(t.entryTime, 'NY')}</span>)}
        {line('Wejście WAW', <span className="num">{formatClock(t.entryTime, 'WAW')}</span>)}
        {line('Killzone', m.killzoneNames.join(', ') || 'poza killzone')}
        {line('Wejście / SL', <span className="num">{fmtPrice(t.prices.entry, dec) || '—'} / {fmtPrice(t.prices.stopLoss, dec) || '—'}</span>)}
        {line('TP1 / TP2', <span className="num">{fmtPrice(t.prices.takeProfit1, dec) || '—'} / {fmtPrice(t.prices.takeProfit2, dec) || '—'}</span>)}
        {line('SL / R:R TP1', <span className="num">{m.riskPips != null ? `${m.riskPips.toFixed(1)} p` : '—'} / {fmtRatio(m.rrTp1)}</span>)}
        {line('Pipsy', <span className={cx('num', toneClass[tone(m.resultPips)])}>{fmtPips(m.resultPips)}</span>)}
        {journal?.settings.display.showMoney && line('Kwota', <AmountText row={row} journal={journal} />)}
        {line('Model', dictName(journal, 'entryModels', t.entryModelId) || '—')}
        {line('PD array', [dictName(journal, 'pdArrays', t.entryPdArrayId), dictName(journal, 'pdArrays', t.htfPdArrayId)].filter(Boolean).join(' · HTF ') || '—')}
        {line('Płynność', t.liquidityTakenIds.map((id) => dictName(journal, 'liquidityPools', id)).join(', ') || '—')}
        {line('Błędy', t.psychology.mistakeTagIds.map((id) => dictName(journal, 'mistakeTags', id)).join(', ') || '—')}
        {line('Zgodność', <span className={cx('num', row.v.compliant === false ? 'text-accent' : '')}>{row.v.score == null ? '—' : `${Math.round(row.v.score * 100)}%`}</span>)}
        {row.v.broken.map((b) => (
          <div key={b.id} className="flex gap-1.5 py-[2px] text-[11.5px] text-accent">
            <span>✕</span>
            <span className="truncate" title={b.detail}>
              {b.label}: <span className="num">{b.detail}</span>
            </span>
          </div>
        ))}
        {t.notes && <p className="mt-2 line-clamp-6 whitespace-pre-wrap text-fg">{t.notes}</p>}
        {t.screens.length > 0 && (
          <div className="mt-2 grid grid-cols-2 gap-1">
            {t.screens.map((s, i) => (
              <button key={s.id} className="relative aspect-video overflow-hidden border border-line bg-black hover:border-line-strong" onClick={() => openLightbox(t.screens, i)}>
                <img src={fileUrl(s.thumbPath)} alt="" loading="lazy" className="h-full w-full object-cover object-top" />
                {s.timeframe && <span className="num absolute top-0.5 left-0.5 bg-black/75 px-1 text-[10px]">{s.timeframe}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex gap-2 border-t border-line p-2">
        <button className="btn flex-1 justify-center" onClick={() => navigate({ page: 'trade', id: t.id })} data-testid="open-trade">
          Otwórz <Kbd>Enter</Kbd>
        </button>
        {!readOnly && (
          <button className="btn" onClick={() => duplicateTradeEntry(t.id)} title="Utwórz kopię tej transakcji (Ctrl+Shift+D)" data-testid="duplicate-selected">
            <IconCopy size={13} /> Duplikuj
          </button>
        )}
      </div>
    </div>
  )
}
