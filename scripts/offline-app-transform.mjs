const SETTINGS_START = 'function SettingsScreen({';
const APP_START = '\nexport default function App() {';

const OFFLINE_SETTINGS_SCREEN = String.raw`function SettingsScreen({
  settings,
  onChange,
  onClearHistory,
  onClearCalibrations
}: {
  settings: AppSettings;
  apiUsage: ApiUsageSnapshot;
  cacheStats: ApiCacheStats;
  issue: UiIssue | null;
  apiTrace: ApiTraceNotice | null;
  onChange: (settings: AppSettings) => void;
  onClearHistory: () => void;
  onClearCalibrations: () => void;
  onClearApiCache: () => void;
  onSendDiagnosticsMail: () => void;
}) {
  const patch = (next: Partial<AppSettings>) => onChange({ ...settings, ...next });
  return (
    <div className="screen-content settings-screen">
      <section className="list-heading">
        <h2>Einstellungen</h2>
        <p>Produktsuche und Barcodeauflösung laufen ausschließlich im lokal installierten SQLite-Katalog. Es gibt keinen Gateway-, Search-a-licious- oder OFF-Produkt-API-Pfad.</p>
      </section>

      <section className="settings-card card">
        <div className="setting-title"><Database size={20} /><div><strong>Lokaler Produktkatalog</strong><span>Production-v1 · 317.579 Produkte · OPFS/SQLite-WASM</span></div></div>
        <p className="setting-note">Der versionierte Katalog wird vom selben App-Host geladen, vor der Aktivierung vollständig geprüft und anschließend lokal im Browser geöffnet. Suchbegriffe und Barcodes verlassen das Gerät nicht.</p>
      </section>

      <section className="settings-card card">
        <div className="setting-title"><Gauge size={20} /><div><strong>Suche & Darstellung</strong><span>Lokaler Katalog und deterministische Portionsberechnung</span></div></div>
        <label className="toggle-row"><span>Deutschen Markt bevorzugen</span><input type="checkbox" checked={settings.preferGermanMarket} onChange={(event) => patch({ preferGermanMarket: event.target.checked })} /></label>
        <label>
          <span>Suchtreffer</span>
          <select value={settings.searchPageSize} onChange={(event) => patch({ searchPageSize: Number(event.target.value) as 10 | 15 | 20 })}>
            <option value={10}>10</option><option value={15}>15</option><option value={20}>20</option>
          </select>
        </label>
        <label>
          <span>Nachkommastellen</span>
          <select value={settings.decimalPlaces} onChange={(event) => patch({ decimalPlaces: Number(event.target.value) as 0 | 1 | 2 })}>
            <option value={0}>0</option><option value={1}>1</option><option value={2}>2</option>
          </select>
        </label>
        <label className="toggle-row"><span>Produktbilder laden</span><input type="checkbox" checked={settings.cacheApiData} onChange={(event) => patch({ cacheApiData: event.target.checked })} /></label>
        <p className="setting-note">Produktbilder sind standardmäßig aus. Bei Aktivierung werden sie direkt vom im Katalog belegten Open-Food-Facts-Bildpfad geladen und lokal zwischengespeichert; die Produktsuche selbst bleibt vollständig lokal.</p>
      </section>

      <section className="settings-card card">
        <div className="setting-title"><Database size={20} /><div><strong>Persönliche Daten</strong><span>Getrennte lokale Einwilligungen</span></div></div>
        <label className="toggle-row"><span>Verlauf speichern</span><input type="checkbox" checked={settings.saveHistory} onChange={(event) => patch({ saveHistory: event.target.checked })} /></label>
        <label className="toggle-row"><span>Aktuelle Suche wiederherstellen</span><input type="checkbox" checked={settings.saveSearchSession} onChange={(event) => patch({ saveSearchSession: event.target.checked })} /></label>
        <label className="toggle-row"><span>Eigene Stückgewichte speichern</span><input type="checkbox" checked={settings.saveCalibrations} onChange={(event) => patch({ saveCalibrations: event.target.checked })} /></label>
        <p className="setting-note">Verlauf, Sitzung und eigene Stückgewichte bleiben getrennt aktivierbar. Deaktivieren entfernt den jeweiligen lokalen Bestand.</p>
      </section>

      <section className="settings-card card danger-zone">
        <div className="setting-title"><Trash2 size={20} /><div><strong>Lokale Nutzerdaten</strong><span>Der Produktkatalog bleibt installiert</span></div></div>
        <button type="button" className="secondary-button" onClick={onClearHistory}>Verlauf löschen</button>
        <button type="button" className="secondary-button" onClick={onClearCalibrations}>Gespeicherte Stückgewichte löschen</button>
      </section>

      <section className="about-card card">
        <Info size={20} />
        <div><strong>KH Checker v{APP_VERSION}</strong><p>Progressive Web App mit lokalem Production-v1-SQLite-Katalog, deterministischer Einheitenauflösung und persönlicher Kalibrierung.</p></div>
      </section>
    </div>
  );
}
`;

export function transformOfflineAppSource(source, id = '') {
  if (!id.replaceAll('\\', '/').endsWith('/src/App.tsx')) return null;
  const start = source.indexOf(SETTINGS_START);
  const end = source.indexOf(APP_START, start);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error('Offline settings transform could not locate the canonical SettingsScreen boundary.');
  }
  const transformed = `${source.slice(0, start)}${OFFLINE_SETTINGS_SCREEN}${source.slice(end)}`;
  for (const retired of [
    'search.openfoodfacts.org',
    'Search-a-licious mit OFF-Reserve',
    'Persönliches Open-Food-Facts-Konto',
    'Technische Produkt-API-Strategie',
    'Daten-Gateway'
  ]) {
    if (transformed.includes(retired)) {
      throw new Error(`Retired online settings text survived the production transform: ${retired}`);
    }
  }
  return transformed;
}

export function offlineAppTransformPlugin() {
  return {
    name: 'kh-checker-offline-app-transform',
    enforce: 'pre',
    transform(source, id) {
      const code = transformOfflineAppSource(source, id);
      return code === null ? null : { code, map: null };
    }
  };
}
