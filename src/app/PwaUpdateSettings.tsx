import type { PwaUpdateViewModel } from './usePwaUpdate';

function shortBuildId(value: string | null): string {
  if (!value) return '–';
  return value.length > 12 ? value.slice(0, 12) : value;
}

function checkedLabel(value: number | null): string {
  return value === null ? 'Noch nicht erfolgreich geprüft' : new Date(value).toLocaleString('de-DE');
}

export function PwaUpdateSettings({ pwa }: { pwa: PwaUpdateViewModel }) {
  const updateAvailable = pwa.canApply || pwa.phase === 'applying';
  const busy = pwa.phase === 'checking' || pwa.phase === 'applying';

  return (
    <section className="settings-card settings-card--wide app-update-settings" aria-labelledby="app-update-settings-title" data-testid="pwa-update-settings">
      <div className="section-title-row">
        <div>
          <span className="eyebrow">Bereitgestellte Web-App</span>
          <h2 id="app-update-settings-title">App-Aktualisierung</h2>
        </div>
        <span className={`app-update-state app-update-state--${pwa.phase}`} data-testid="pwa-update-state">{pwa.phase === 'update-available' ? 'Update verfügbar' : pwa.phase === 'applying' ? 'Wird aktualisiert' : pwa.phase === 'up-to-date' ? 'Aktuell' : pwa.phase === 'checking' ? 'Prüfung läuft' : pwa.phase === 'offline' ? 'Offline' : pwa.phase === 'error' ? 'Prüfung fehlgeschlagen' : pwa.phase === 'unsupported' ? 'Nicht unterstützt' : 'Bereit'}</span>
      </div>
      <p role="status" aria-live="polite" data-testid="pwa-update-message">{pwa.message}</p>
      <dl className="app-update-details">
        <div><dt>Geladene App</dt><dd>v{pwa.currentAppVersion}</dd></div>
        <div><dt>Lokaler Build</dt><dd><code>{shortBuildId(pwa.currentBuildId)}</code></dd></div>
        <div><dt>Bereitgestellter Build</dt><dd><code>{shortBuildId(pwa.remoteBuildId)}</code></dd></div>
        <div><dt>Geprüft vorbereiteter Build</dt><dd><code>{shortBuildId(pwa.preparedBuildId)}</code></dd></div>
        <div><dt>Letzte erfolgreiche Prüfung</dt><dd>{checkedLabel(pwa.checkedAt)}</dd></div>
      </dl>
      <p className="settings-note">Beim Öffnen, bei der Rückkehr in die App, nach erneuter Internetverbindung und stündlich werden Deploymentmanifest und Service Worker ohne Browsercache geprüft. Ein Hinweis erscheint nur, wenn der vorbereitete Worker eindeutig zu einem anderen, aktuell bereitgestellten Build gehört.</p>
      <p className="settings-note"><strong>Lokale Daten bleiben erhalten:</strong> Verlauf, Favoriten, eigene Produkte, Fotos, Einstellungen und persönliche Einheitskalibrierungen werden beim Ersetzen des App-Caches nicht gelöscht.</p>
      <div className="button-row">
        {updateAvailable && <button type="button" className="button button--primary" onClick={() => { void pwa.applyUpdate(); }} disabled={pwa.phase === 'applying' || !pwa.canApply} data-testid="pwa-update-settings-apply">{pwa.phase === 'applying' ? 'Update wird aktiviert …' : 'Jetzt aktualisieren'}</button>}
        <button type="button" className="button button--secondary" onClick={() => { void pwa.checkForUpdates(); }} disabled={!pwa.canCheck || busy} data-testid="pwa-update-check">{pwa.phase === 'checking' ? 'Prüfung läuft …' : 'Jetzt nach Updates suchen'}</button>
      </div>
    </section>
  );
}
