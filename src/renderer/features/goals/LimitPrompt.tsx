import { create } from 'zustand'
import { Modal } from '../../components/Modal'

interface PromptState {
  alerts: string[] | null
  onConfirm: (() => void) | null
}

/** A new trade while a limit is broken waits for this confirmation (Ustawienia → Kalkulator: limity i cele). */
export const useLimitPrompt = create<PromptState>(() => ({ alerts: null, onConfirm: null }))

export function askBeyondLimits(alerts: string[], onConfirm: () => void): void {
  useLimitPrompt.setState({ alerts, onConfirm })
}

const close = () => useLimitPrompt.setState({ alerts: null, onConfirm: null })

export function LimitPromptDialog() {
  const { alerts, onConfirm } = useLimitPrompt()
  if (!alerts) return null
  return (
    <Modal
      title="Limit przekroczony"
      onClose={close}
      width={480}
      testId="limit-prompt"
      footer={
        <>
          <span className="flex-1" />
          <button className="btn btn-accent" onClick={close} autoFocus data-testid="limit-stop">
            Kończę na dziś
          </button>
          <button
            className="btn"
            onClick={() => {
              const run = onConfirm
              close()
              run?.()
            }}
            data-testid="limit-continue"
          >
            Mimo to dodaj transakcję
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-2 text-[12.5px]">
        <ul className="flex flex-col gap-1 text-accent">
          {alerts.map((a) => (
            <li key={a}>• {a}</li>
          ))}
        </ul>
        <p className="text-muted">Zasady ustawiłeś po to, żeby chronić kapitał w takich chwilach. Missed trade i plan dnia możesz dodawać bez pytania.</p>
      </div>
    </Modal>
  )
}
