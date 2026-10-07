import { useEffect, type ReactNode } from 'react'
import { boot, useJournal } from '../store/journal'
import { navigate, setPalette, useUi, type Route } from '../store/ui'
import { FolderSetup } from '../features/setup/FolderSetup'
import { JournalPage } from '../features/journal/JournalPage'
import { TradeEditor } from '../features/trade/TradeEditor'
import { SettingsPage } from '../features/settings/SettingsPage'
import { SyncPage } from '../features/sync/SyncPage'
import { DayPlanPage, todayNy } from '../features/day/DayPlanPage'
import { CalculatorPage } from '../features/calculator/CalculatorPage'
import { ForecastPage } from '../features/forecast/ForecastPage'
import { DrillPage } from '../features/drill/DrillPage'
import { ReportsPage } from '../features/reports/ReportsPage'
import { AnalyticsPage } from '../features/analytics/AnalyticsPage'
import { LibraryPage } from '../features/library/LibraryPage'
import { WeekPage, currentWeek } from '../features/week/WeekPage'
import { copyMarkdownForRoute } from '../features/export/markdownActions'
import { CommandPalette, toggleMoney } from '../features/palette/CommandPalette'
import { LimitPromptDialog } from '../features/goals/LimitPrompt'
import { newTrade } from '../features/trade/actions'
import { duplicateCurrent } from '../features/duplicate'
import { Lightbox } from '../components/Lightbox'
import { Toasts } from '../components/Toasts'
import { IconBook, IconCalc, IconCalendar, IconChart, IconForecast, IconGear, IconList, IconPlus, IconReport, IconSync, IconTarget, IconWeek } from '../components/icons'
import { cx } from '../components/ui'
import { TopBar } from './TopBar'
import { Banners } from './Banners'
import { WellbeingPrompt } from '../features/wellbeing/Wellbeing'
import { ErrorBoundary } from './ErrorBoundary'
import { ShortcutsHelp } from './ShortcutsHelp'
import { RemoteChangesDialog } from '../features/sync/RemoteChangesDialog'
import { DecisionsDialog, ReviewsDialog } from '../features/sessions/SessionDialogs'
import { setRemoteDialog, useRemote } from '../store/remote'
import { flushSaves } from '../store/journal'
import { initUpdates } from '../store/update'
import { useFxAutoFetch } from '../store/fx'
import { toast } from '../store/ui'

function useGlobalHotkeys(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useJournal.getState().phase !== 'ready') return
      const ctrl = e.ctrlKey || e.metaKey
      if (!ctrl) return
      const k = e.key.toLowerCase()
      if (k === 'k') {
        e.preventDefault()
        setPalette(!useUi.getState().paletteOpen)
      } else if (k === 'n') {
        e.preventDefault()
        setPalette(false)
        newTrade(e.shiftKey ? 'missed' : 'trade')
      } else if (k === 'd' && e.shiftKey) {
        e.preventDefault()
        setPalette(false)
        duplicateCurrent()
      } else if (e.key === '1') {
        e.preventDefault()
        navigate({ page: 'journal' })
      } else if (e.key === '2' || k === 'd') {
        e.preventDefault()
        navigate({ page: 'day', date: todayNy() })
      } else if (e.key === '3') {
        e.preventDefault()
        navigate({ page: 'analytics' })
      } else if (e.key === '4' && !e.shiftKey) {
        // Ctrl+Shift+4 (Ctrl+$ on some layouts reports the digit) toggles amounts, below.
        e.preventDefault()
        navigate({ page: 'library' })
      } else if (e.key === '5') {
        e.preventDefault()
        navigate({ page: 'week', week: currentWeek() })
      } else if (k === 'a' && e.shiftKey) {
        e.preventDefault()
        window.dispatchEvent(new Event('ictj:analysis-toggle'))
      } else if (k === 'm' && e.shiftKey) {
        e.preventDefault()
        void copyMarkdownForRoute()
      } else if (e.key === '6') {
        e.preventDefault()
        navigate({ page: 'calculator' })
      } else if (e.key === '7') {
        e.preventDefault()
        navigate({ page: 'forecast' })
      } else if (e.key === '8') {
        e.preventDefault()
        navigate({ page: 'drill' })
      } else if (e.key === '9') {
        e.preventDefault()
        navigate({ page: 'reports' })
      } else if (e.key === ',') {
        e.preventDefault()
        navigate({ page: 'settings' })
      } else if (k === 's') {
        e.preventDefault()
        if (useRemote.getState().pending.length) {
          setRemoteDialog(true)
          toast('Czekają zmiany z drugiego komputera – te wpisy zapiszą się po Twojej decyzji.', 'info', 5000)
          return
        }
        void flushSaves().then((saved) =>
          saved
            ? toast('Zapisano. (Zapis jest automatyczny – Ctrl+S nie jest potrzebne.)', 'success', 2200)
            : toast(`Nie udało się zapisać: ${useJournal.getState().save.error ?? 'błąd zapisu'}. Aplikacja ponowi zapis automatycznie.`, 'error', 6000)
        )
      } else if (e.key === '$' || (e.shiftKey && e.code === 'Digit4')) {
        e.preventDefault()
        toggleMoney()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

function NavButton({ active, onClick, label, keys, children, badge, testId }: { active: boolean; onClick: () => void; label: string; keys?: string; children: ReactNode; badge?: number; testId?: string }) {
  return (
    <button
      onClick={onClick}
      title={keys ? `${label} (${keys})` : label}
      data-testid={testId}
      className={cx(
        'relative flex h-[46px] w-full flex-col items-center justify-center gap-0.5 border-l-2 text-[9.5px] transition-colors duration-100',
        active ? 'border-accent bg-accent-soft text-accent' : 'border-transparent text-muted hover:bg-hover hover:text-fg-strong'
      )}
    >
      {children}
      <span>{label}</span>
      {badge ? <span className="num absolute top-1 right-1.5 min-w-[14px] bg-accent px-0.5 text-[9.5px] text-bg">{badge}</span> : null}
    </button>
  )
}

function Page({ route }: { route: Route }) {
  switch (route.page) {
    case 'journal':
      return <JournalPage />
    case 'trade':
      return <TradeEditor key={route.id} id={route.id} />
    case 'day':
      return <DayPlanPage key={route.date} date={route.date} />
    case 'analytics':
      return <AnalyticsPage />
    case 'library':
      return <LibraryPage id={route.id} />
    case 'week':
      return <WeekPage key={route.week} week={route.week} />
    case 'calculator':
      return <CalculatorPage key={route.tradeId ?? 'calc'} tradeId={route.tradeId} />
    case 'forecast':
      return <ForecastPage id={route.id} />
    case 'drill':
      return <DrillPage />
    case 'reports':
      return <ReportsPage />
    case 'settings':
      return <SettingsPage />
    case 'sync':
      return <SyncPage />
  }
}

export function App() {
  const phase = useJournal((s) => s.phase)
  const route = useUi((s) => s.route)
  const issues = useJournal((s) => s.conflicts.length + s.problems.filter((p) => p.kind !== 'unknown-file').length)
  useGlobalHotkeys()
  useFxAutoFetch()
  useEffect(() => {
    void boot()
    initUpdates()
  }, [])

  if (phase === 'boot') return <div className="flex h-full items-center justify-center text-muted">Wczytywanie…</div>
  if (phase === 'setup') return <FolderSetup />

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <Banners />
      <WellbeingPrompt />
      <div className="flex min-h-0 flex-1">
        <nav className="flex w-[64px] shrink-0 flex-col border-r border-line bg-panel">
          <NavButton active={route.page === 'journal' || route.page === 'trade'} onClick={() => navigate({ page: 'journal' })} label="Dziennik" keys="Ctrl+1" testId="nav-journal">
            <IconList size={17} />
          </NavButton>
          <NavButton active={route.page === 'day'} onClick={() => navigate({ page: 'day', date: todayNy() })} label="Plan dnia" keys="Ctrl+D" testId="nav-day">
            <IconCalendar size={17} />
          </NavButton>
          <NavButton active={route.page === 'analytics'} onClick={() => navigate({ page: 'analytics' })} label="Analityka" keys="Ctrl+3" testId="nav-analytics">
            <IconChart size={17} />
          </NavButton>
          <NavButton active={route.page === 'library'} onClick={() => navigate({ page: 'library' })} label="Biblioteka" keys="Ctrl+4" testId="nav-library">
            <IconBook size={17} />
          </NavButton>
          <NavButton active={route.page === 'week'} onClick={() => navigate({ page: 'week', week: currentWeek() })} label="Tydzień" keys="Ctrl+5" testId="nav-week">
            <IconWeek size={17} />
          </NavButton>
          <NavButton active={route.page === 'calculator'} onClick={() => navigate({ page: 'calculator' })} label="Kalkulator" keys="Ctrl+6" testId="nav-calc">
            <IconCalc size={17} />
          </NavButton>
          <NavButton active={route.page === 'forecast'} onClick={() => navigate({ page: 'forecast' })} label="Prognoza" keys="Ctrl+7" testId="nav-forecast">
            <IconForecast size={17} />
          </NavButton>
          <NavButton active={route.page === 'drill'} onClick={() => navigate({ page: 'drill' })} label="Trening" keys="Ctrl+8" testId="nav-drill">
            <IconTarget size={17} />
          </NavButton>
          <NavButton active={route.page === 'reports'} onClick={() => navigate({ page: 'reports' })} label="Raporty" keys="Ctrl+9" testId="nav-reports">
            <IconReport size={17} />
          </NavButton>
          <NavButton active={false} onClick={() => newTrade()} label="Nowa" keys="Ctrl+N" testId="nav-new">
            <IconPlus size={17} />
          </NavButton>
          <div className="flex-1" />
          <button
            className="mx-auto mb-1 flex h-[22px] w-[22px] items-center justify-center border border-line-strong text-[11px] text-muted hover:text-fg-strong"
            title="Skróty klawiszowe (?)"
            onClick={() => window.dispatchEvent(new Event('ictj:shortcuts'))}
            data-testid="nav-help"
          >
            ?
          </button>
          <NavButton active={route.page === 'sync'} onClick={() => navigate({ page: 'sync' })} label="Synchr." badge={issues} testId="nav-sync">
            <IconSync size={17} />
          </NavButton>
          <NavButton active={route.page === 'settings'} onClick={() => navigate({ page: 'settings' })} label="Ustawienia" keys="Ctrl+," testId="nav-settings">
            <IconGear size={17} />
          </NavButton>
        </nav>
        <main
          className="min-w-0 flex-1 animate-fade-in"
          key={route.page === 'trade' ? `trade-${route.id}` : route.page === 'day' ? `day-${route.date}` : route.page === 'week' ? `week-${route.week}` : route.page}
        >
          <ErrorBoundary onReset={() => navigate({ page: 'journal' })}>
            <Page route={route} />
          </ErrorBoundary>
        </main>
      </div>
      <CommandPalette />
      <LimitPromptDialog />
      <ShortcutsHelp />
      <RemoteChangesDialog />
      <DecisionsDialog />
      <ReviewsDialog />
      <Lightbox />
      <Toasts />
    </div>
  )
}
