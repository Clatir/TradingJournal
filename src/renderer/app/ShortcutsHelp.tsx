import { useEffect, useState } from 'react'
import { IconClose } from '../components/icons'
import { Kbd } from '../components/ui'

const GROUPS: Array<{ title: string; items: Array<[string, string]> }> = [
  {
    title: 'Ogólne',
    items: [
      ['Ctrl K', 'paleta komend i wyszukiwanie transakcji'],
      ['Ctrl N', 'nowa transakcja'],
      ['Ctrl Shift N', 'nowy missed trade'],
      ['Ctrl Shift D', 'duplikuj wpis (plan dnia → następny dzień)'],
      ['Ctrl S', 'zapisz teraz (zapis i tak jest automatyczny)'],
      ['Ctrl $', 'pokaż / ukryj kwoty'],
      ['Ctrl Shift M', 'markdown transakcji / planu dnia do schowka'],
      ['? lub F1', 'ta ściąga']
    ]
  },
  {
    title: 'Sekcje',
    items: [
      ['Ctrl 1', 'dziennik'],
      ['Ctrl 2 / Ctrl D', 'plan dnia (dziś)'],
      ['Ctrl 3', 'analityka'],
      ['Ctrl 4', 'biblioteka setupów'],
      ['Ctrl 5', 'przegląd tygodnia'],
      ['Ctrl 6', 'kalkulator pozycji'],
      ['Ctrl 7', 'prognoza wypłat'],
      ['Ctrl ,', 'ustawienia']
    ]
  },
  {
    title: 'Dziennik',
    items: [
      ['↑ ↓', 'poprzednia / następna transakcja'],
      ['Enter', 'otwórz zaznaczoną'],
      ['/', 'szukaj']
    ]
  },
  {
    title: 'Transakcja',
    items: [
      ['Alt L / Alt S', 'long / short'],
      ['↑ ↓ w polu ceny', '± 1 pips (Shift: 10)'],
      ['Ctrl V', 'wklej screen do aktywnej fazy'],
      ['1 – 7', 'interwał ostatniego screena (W, D, H4…)'],
      ['Esc', 'wróć']
    ]
  },
  {
    title: 'Prognoza wypłat',
    items: [
      ['Enter / ↑ ↓ w kolumnie Wpłata', 'następny / poprzedni miesiąc'],
      ['Ctrl Shift D', 'duplikuj scenariusz'],
      ['↑ ↓ w polu liczby', '± krok (Shift: × 10)']
    ]
  },
  {
    title: 'Plan dnia / podgląd',
    items: [
      ['Alt ← / Alt →', 'poprzedni / następny dzień handlowy'],
      ['← →', 'kolejny screen w podglądzie'],
      ['C', 'porównanie dwóch screenów'],
      ['0 / 1', 'dopasuj / 100%'],
      ['A R H T V', 'adnotacje: strzałka, strefa, poziom, tekst, zaznacz']
    ]
  }
]

export function ShortcutsHelp() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')
      if (e.key === 'F1' || (e.key === '?' && !typing && !e.ctrlKey)) {
        e.preventDefault()
        setOpen((o) => !o)
      } else if (e.key === 'Escape' && open) {
        e.preventDefault()
        e.stopPropagation()
        setOpen(false)
      }
    }
    const onOpen = () => setOpen(true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('ictj:shortcuts', onOpen)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('ictj:shortcuts', onOpen)
    }
  }, [open])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-black/60" onMouseDown={() => setOpen(false)} data-testid="shortcuts">
      <div className="w-[860px] animate-pop-in border border-line-strong bg-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex h-[34px] items-center border-b border-line px-3">
          <span className="label flex-1">Skróty klawiszowe</span>
          <button className="btn btn-ghost h-[24px] px-1.5" onClick={() => setOpen(false)} aria-label="Zamknij">
            <IconClose />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-x-6 gap-y-4 p-4">
          {GROUPS.map((g) => (
            <div key={g.title} className="flex flex-col gap-1">
              <span className="label mb-1 text-accent">{g.title}</span>
              {g.items.map(([keys, what]) => (
                <div key={keys} className="flex items-baseline justify-between gap-3 text-[12px]">
                  <span className="text-fg">{what}</span>
                  <Kbd>{keys}</Kbd>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
