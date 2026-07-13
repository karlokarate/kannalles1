import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep diagnostics available without sending them anywhere automatically.
    console.error('KH Checker render error', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="fatal-error" role="alert" aria-live="assertive">
        <span aria-hidden="true" className="fatal-error-icon">⚠</span>
        <h1>Die App konnte diesen Bildschirm nicht anzeigen</h1>
        <p>Lokale Daten wurden nicht automatisch gelöscht. Du kannst neu laden oder nur die gespeicherte Bildschirmsitzung zurücksetzen.</p>
        <details>
          <summary>Technischer Fehler</summary>
          <code>{this.state.error.name}: {this.state.error.message}</code>
        </details>
        <div className="fatal-error-actions">
          <button type="button" className="primary-button" onClick={() => window.location.reload()}><span aria-hidden="true">↻</span> Neu laden</button>
          <button type="button" className="secondary-button" onClick={() => {
            try {
              localStorage.removeItem('kh-checker-session-v3');
              localStorage.removeItem('kh-checker-v2.0-session');
            } catch {
              // Reload still recovers an in-memory-only session.
            }
            window.location.reload();
          }}><span aria-hidden="true">⌫</span> Sitzung zurücksetzen</button>
        </div>
      </main>
    );
  }
}
