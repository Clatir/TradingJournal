import { updateJournal } from '../store/journal'
import { toast } from '../store/ui'

/** Show / hide money amounts everywhere (Ctrl+$); by default the journal shows R and pips only. */
export function toggleMoney(): void {
  let on = false
  updateJournal((j) => {
    on = !j.settings.display.showMoney
    return { ...j, settings: { ...j.settings, display: { ...j.settings.display, showMoney: on } } }
  })
  toast(on ? 'Kwoty widoczne (Ctrl+$ ukrywa).' : 'Kwoty ukryte – wyniki w R i pipsach.')
}
