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
      >
        <span className="pwa-update-banner__icon" aria-hidden="true">↻</span>
        <div className="pwa-update-banner__body">
          <strong id="pwa-update-title">Neue App-Version verfügbar</strong>
          <p>{applying ? 'Das Update wird aktiviert. Die App lädt anschließend neu.' : 'Die bereitgestellte Version ist neuer. Du entscheidest, wann sie aktiviert wird; deine lokalen Nutzerdaten bleiben erhalten.'}</p>
          <div className="button-row">
            <button
              type="button"
              className="button button--primary"
              onClick={() => { void pwa.applyUpdate(); }}
              disabled={applying}
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
