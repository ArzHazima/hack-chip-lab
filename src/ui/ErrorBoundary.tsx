// Catches a crash while drawing the board (e.g. from a damaged saved circuit) and offers a way out,
// instead of leaving a blank page. React only supports this with a CLASS component.
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { clearSavedCircuits } from './storage'

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Board crashed:', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="error-boundary" role="alert">
        <h2>Something went wrong while drawing the board</h2>
        <p>{this.state.error.message}</p>
        <p>A damaged saved circuit is a common cause. Clearing it removes every circuit saved in this browser.</p>
        <button
          type="button"
          onClick={() => {
            clearSavedCircuits()
            window.location.reload()
          }}
        >
          Clear saved circuit
        </button>
      </div>
    )
  }
}
