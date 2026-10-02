import { Component, type ReactNode } from 'react'

interface State {
  error: Error | null
}

/** Keeps a rendering bug in one screen from blanking the whole window. */
export class ErrorBoundary extends Component<{ children: ReactNode; onReset?: () => void }, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error): void {
    console.error('Błąd widoku:', error)
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex h-full items-center justify-center p-6" data-testid="error-boundary">
        <div className="max-w-[620px] border border-down/50 bg-panel p-4">
          <div className="mb-1 text-[13px] font-medium text-fg-strong">Ten widok napotkał błąd</div>
          <div className="num mb-3 text-[12px] break-words text-down">{this.state.error.message}</div>
          <div className="mb-3 text-[12px] text-muted">Dane na dysku nie zostały naruszone. Możesz wrócić do dziennika.</div>
          <button
            className="btn"
            onClick={() => {
              this.setState({ error: null })
              this.props.onReset?.()
            }}
          >
            Wróć do dziennika
          </button>
        </div>
      </div>
    )
  }
}
