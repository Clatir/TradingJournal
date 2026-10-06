import { useMemo } from 'react'
import { Command } from 'cmdk'
import { formatClock } from '@shared/calc/time'
import { api, errorMessage } from '../../lib/api'
import { fmtR } from '../../lib/format'
import { dictName, useTradeRows } from '../../store/derived'
import { updateJournal, useJournal } from '../../store/journal'
import { navigate, setPalette, toast, useUi } from '../../store/ui'
import { Kbd } from '../../components/ui'
import { newTrade } from '../trade/actions'
import { duplicateCurrent } from '../duplicate'
import { todayNy } from '../day/DayPlanPage'
import { enterSample, exitSample } from '../sample/sample'
import { currentWeek } from '../week/WeekPage'
import { copyMarkdownForRoute, exportCsv } from '../export/markdownActions'
import { deliverMonthlyReport, latestReportMonth } from '../export/reportActions'
import { checkForUpdates } from '../../store/update'
import { refreshFxRates } from '../../store/fx'
import { createScenario } from '../forecast/actions'
import { addManualSession, setReviewsOpen } from '../sessions/actions'
import { insertTemplate } from '../day/TemplatesMenu'
import { EMPTY_FILTER, filterOf } from '@shared/journalView'
import { useJournalFilter } from '../journal/JournalTools'
import { toggleMoney } from '../money'

export { toggleMoney }

const GROUP =
  '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10.5px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted'

interface Action {
  id: string
  label: string
  keys?: string
  run: () => void
}

export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen)
  const rows = useTradeRows()
  const journal = useJournal((s) => s.journal)

  const actions: Action[] = useMemo(
    () => [
      { id: 'new', label: 'Nowa transakcja', keys: 'Ctrl N', run: () => newTrade() },
      { id: 'missed', label: 'Nowy missed trade', keys: 'Ctrl Shift N', run: () => newTrade('missed') },
      { id: 'duplicate', label: 'Duplikuj bieżący wpis (transakcja, przykład, scenariusz; plan → następny dzień)', keys: 'Ctrl Shift D', run: duplicateCurrent },
      { id: 'journal', label: 'Dziennik transakcji', keys: 'Ctrl 1', run: () => navigate({ page: 'journal' }) },
      ...(journal?.settings.savedFilters ?? []).map((f) => ({
        id: `filter-${f.id}`,
        label: `Dziennik: zapisany filtr „${f.name}”`,
        run: () => {
          useJournalFilter.setState({ filter: filterOf(f) })
          navigate({ page: 'journal' })
        }
      })),
      {
        id: 'filters-clear',
        label: 'Dziennik: wyczyść filtry',
        run: () => {
          useJournalFilter.setState({ filter: EMPTY_FILTER })
          navigate({ page: 'journal' })
        }
      },
      { id: 'day', label: 'Plan dnia – dziś', keys: 'Ctrl D', run: () => navigate({ page: 'day', date: todayNy() }) },
      { id: 'analysis', label: 'Sesja analizy: start / zakończ i zdecyduj', keys: 'Ctrl Shift A', run: () => window.dispatchEvent(new Event('ictj:analysis-toggle')) },
      { id: 'analysis-manual', label: 'Sesja analizy wpisana ręcznie (dziś)', run: () => addManualSession(todayNy(), 30) },
      { id: 'reviews', label: 'Odrzucone pary: czy dały dobry setup?', run: () => setReviewsOpen(true) },
      ...(journal?.settings.dayTemplates ?? []).map((t) => ({
        id: `template-${t.id}`,
        label: `Plan dnia (dziś): wstaw szablon „${t.name}”`,
        run: () => {
          navigate({ page: 'day', date: todayNy() })
          insertTemplate(t.id, todayNy())
        }
      })),
      { id: 'analytics', label: 'Analityka', keys: 'Ctrl 3', run: () => navigate({ page: 'analytics' }) },
      { id: 'library', label: 'Biblioteka setupów', keys: 'Ctrl 4', run: () => navigate({ page: 'library' }) },
      { id: 'week', label: 'Przegląd tygodnia', keys: 'Ctrl 5', run: () => navigate({ page: 'week', week: currentWeek() }) },
      { id: 'calc', label: 'Kalkulator pozycji i limity dzienne', keys: 'Ctrl 6', run: () => navigate({ page: 'calculator' }) },
      {
        id: 'pnl',
        label: 'Kalkulator zysku / straty (loty × pipsy × wartość pipsa)',
        run: () => {
          navigate({ page: 'calculator' })
          requestAnimationFrame(() => document.getElementById('pnl')?.scrollIntoView({ block: 'start' }))
        }
      },
      { id: 'forecast', label: 'Prognoza wypłat', keys: 'Ctrl 7', run: () => navigate({ page: 'forecast' }) },
      { id: 'drill', label: 'Trening: karty z dawnych transakcji', keys: 'Ctrl 8', run: () => navigate({ page: 'drill' }) },
      {
        id: 'forecast-new',
        label: 'Prognoza: nowy scenariusz',
        run: () => {
          if (!createScenario()) toast('Folder danych jest tylko do odczytu.', 'error')
        }
      },
      { id: 'instruments', label: 'Instrumenty kalkulatora', run: () => navigate({ page: 'settings', tab: 'instruments' }) },
      { id: 'nbp', label: 'Odśwież kursy NBP', run: () => void refreshFxRates(true) },
      { id: 'md', label: 'Kopiuj markdown bieżącej transakcji / planu dnia', keys: 'Ctrl Shift M', run: () => void copyMarkdownForRoute() },
      { id: 'csv', label: 'Eksport CSV wszystkich transakcji', run: () => void exportCsv() },
      { id: 'report-copy', label: 'Raport miesięczny (ostatni miesiąc) – kopiuj markdown', run: () => void deliverMonthlyReport(latestReportMonth(), 'copy') },
      { id: 'report-pdf', label: 'Raport miesięczny (ostatni miesiąc) – zapisz PDF', run: () => void deliverMonthlyReport(latestReportMonth(), 'pdf') },
      { id: 'zip', label: 'Eksport ZIP całego folderu', run: () => navigate({ page: 'settings', tab: 'transfer' }) },
      { id: 'import', label: 'Import / kopie zapasowe', run: () => navigate({ page: 'settings', tab: 'transfer' }) },
      { id: 'broker', label: 'Import historii od brokera (MT4, MT5, XTB)', run: () => navigate({ page: 'settings', tab: 'transfer' }) },
      {
        id: 'sample',
        label: 'Dane przykładowe (demo) – włącz / wyłącz',
        run: () => void (useJournal.getState().status?.isSample ? exitSample() : enterSample())
      },
      { id: 'rules', label: 'Zasady walidatora (progi)', run: () => navigate({ page: 'settings', tab: 'rules' }) },
      { id: 'settings', label: 'Ustawienia', keys: 'Ctrl ,', run: () => navigate({ page: 'settings' }) },
      { id: 'screens', label: 'Ustawienia screenów i osierocone pliki', run: () => navigate({ page: 'settings', tab: 'screens' }) },
      { id: 'dicts', label: 'Słowniki: modele, PD arrays, płynność, błędy', run: () => navigate({ page: 'settings', tab: 'dictionaries' }) },
      { id: 'kz', label: "Killzone'y", run: () => navigate({ page: 'settings', tab: 'killzones' }) },
      { id: 'sync', label: 'Synchronizacja i problemy', run: () => navigate({ page: 'sync' }) },
      { id: 'money', label: 'Przełącz kwoty / tylko R', keys: 'Ctrl $', run: toggleMoney },
      { id: 'rescan', label: 'Przeskanuj folder danych', run: () => void api.rescan().then(() => toast('Przeskanowano folder.', 'success'), (e) => toast(errorMessage(e), 'error')) },
      { id: 'explorer', label: 'Pokaż folder danych w Eksploratorze', run: () => void api.showInFolder(null) },
      {
        id: 'updates',
        label: 'Sprawdź aktualizacje (GitHub)',
        run: () => {
          navigate({ page: 'settings', tab: 'updates' })
          void checkForUpdates()
        }
      },
      { id: 'help', label: 'Skróty klawiszowe', keys: '?', run: () => window.dispatchEvent(new Event('ictj:shortcuts')) }
    ],
    [journal?.settings.dayTemplates, journal?.settings.savedFilters]
  )

  if (!open) return null
  const run = (fn: () => void) => {
    setPalette(false)
    fn()
  }
  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in items-start justify-center bg-black/55 pt-[12vh]" onMouseDown={() => setPalette(false)}>
      <div className="w-[640px] animate-pop-in border border-line-strong bg-panel shadow-none" onMouseDown={(e) => e.stopPropagation()}>
        <Command
          label="Paleta komend"
          loop
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              setPalette(false)
            }
          }}
        >
          <Command.Input
            autoFocus
            placeholder="Wpisz komendę lub szukaj transakcji (para, data, model)…"
            className="h-[40px] w-full border-b border-line bg-transparent px-3 text-[13px] text-fg-strong outline-none placeholder:text-dim"
            data-testid="palette-input"
          />
          <Command.List className="max-h-[52vh] overflow-y-auto p-1">
            <Command.Empty className="px-3 py-4 text-muted">Nic nie znaleziono.</Command.Empty>
            <Command.Group heading="Akcje" className={GROUP}>
              {actions.map((a) => (
                <Command.Item
                  key={a.id}
                  value={a.label}
                  onSelect={() => run(a.run)}
                  className="flex h-[30px] items-center gap-2 px-2 text-[12.5px] data-[selected=true]:bg-accent-soft data-[selected=true]:text-fg-strong"
                >
                  <span className="flex-1">{a.label}</span>
                  {a.keys && <Kbd>{a.keys}</Kbd>}
                </Command.Item>
              ))}
            </Command.Group>
            {rows.length > 0 && (
              <Command.Group heading="Transakcje" className={GROUP}>
                {rows.slice(0, 300).map(({ trade: t, m }) => {
                  const model = dictName(journal, 'entryModels', t.entryModelId)
                  return (
                    <Command.Item
                      key={t.id}
                      value={`${m.tradingDate} ${t.pair} ${t.direction} ${model} ${m.killzoneNames.join(' ')} ${t.id}`}
                      onSelect={() => run(() => navigate({ page: 'trade', id: t.id }))}
                      className="grid h-[28px] grid-cols-[86px_44px_70px_50px_1fr_70px] items-center gap-2 px-2 text-[12px] data-[selected=true]:bg-accent-soft"
                    >
                      <span className="num text-fg-strong">{m.tradingDate}</span>
                      <span className="num text-muted">{formatClock(t.entryTime, 'NY')}</span>
                      <span className="num">{t.pair}</span>
                      <span className="text-muted">{t.direction === 'long' ? 'Long' : 'Short'}</span>
                      <span className="truncate text-muted">{model}</span>
                      <span className="num text-right">{t.status === 'missed' ? 'missed' : fmtR(m.resultR)}</span>
                    </Command.Item>
                  )
                })}
              </Command.Group>
            )}
          </Command.List>
        </Command>
      </div>
    </div>
  )
}
