import type { PwaUpdateViewModel } from './usePwaUpdate';

export function PwaUpdateBanner({ pwa }: { pwa: PwaUpdateViewModel }) {
  if ((pwa.phase === 'update-available' || pwa.phase === 'applying') && pwa.updatePromptVisible) {
    const applying = pwa.phase === 'applying';
    return (
      <section
        className="pwa-update-banner"
        role="alert"
        aria-labelledby="pwa-update-title"
        data-testid="pwa-update-banner"
        data-update-state={pwa.phase}
        data-prepared-build={pwa.preparedBuildId ?? ''}
      >
        <span className="pwa-update-banner__icon" aria-hidden="true">↻</span>
        <div className="pwa-update-banner__body">
          <strong id="pwa-update-title">Neue App-Version verfügbar</strong>
          <p>{applying
            ? 'Der geprüfte neue Build wird aktiviert. Danach lädt die App mit dem erneuerten App-Cache.'
            : 'Ein eindeutig neuer Build ist vollständig vorbereitet. Du entscheidest, wann er den bisherigen App-Cache ersetzt; deine lokalen Nutzerdaten bleiben erhalten.'}</p>
          <div className="button-row">
            <button
              type="button"
              className="button button--primary"
              onClick={() => { void pwa.applyUpdate(); }}
              disabled={applying || !pwa.canApply}
              data-testid="pwa-update-apply"
            >
              {applying ? 'Update wird aktiviert …' : 'Jetzt aktualisieren'}
            </button>
            {!applying && <button type="button" className="button button--ghost" onClick={pwa.dismissUpdate}>Später</button>}
          </div>
        </div>
      </section>
    );
  }

  if (pwa.offlineReadyNoticeVisible) {
    return (
      <section className="notice pwa-offline-ready" role="status" data-testid="pwa-offline-ready">
        <span>Die App ist jetzt für die Offline-Nutzung vorbereitet.</span>
        <button type="button" onClick={pwa.dismissOfflineReady} aria-label="Hinweis schließen">×</button>
      </section>
    );
  }

  return null;
}
