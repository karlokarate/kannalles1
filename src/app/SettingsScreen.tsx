import type { ChangeEvent } from 'react';
import type { OfflineAppSettings } from '../lib/settings';
import type { UserDataCounts } from '../lib/userDataStore';
import { DiabetesSettings } from './DiabetesSettings';

export interface SettingsScreenProps {
  settings: OfflineAppSettings;
  counts: UserDataCounts;
  onChange: (settings: OfflineAppSettings) => void;
  onClearHistory: () => void;
  onClearSession: () => void;
  onClearAllUserData: () => void;
  onExportData: () => void;
  onShareData: () => Promise<void>;
  onImportData: (file: File | null) => Promise<void>;
  transferMessage: string | null;
}

export function SettingsScreen({
  settings,
  counts,
  onChange,
  onClearHistory,
  onClearSession,
  onClearAllUserData,
  onExportData,
  onShareData,
  onImportData,
  transferMessage
}: SettingsScreenProps) {
  function update<K extends keyof OfflineAppSettings>(key: K, value: OfflineAppSettings[K]): void {
    onChange({ ...settings, [key]: value });
  }

  return (
    <section className="screen settings-screen" aria-labelledby="settings-title">
      <header className="screen-heading">
        <div><span className="eyebrow">Nur auf diesem Gerät</span><h1 id="settings-title">Einstellungen</h1></div>
        <p>Keine Produkt-API, keine Zugangsdaten und kein versteckter Online-Fallback.</p>
      </header>
      <div className="settings-grid">
        <fieldset className="settings-card settings-card--wide theme-settings">
          <legend>Design</legend>
          <div className="theme-picker" role="radiogroup" aria-label="Darstellung auswählen">
            <label className={settings.visualTheme === 'comic' ? 'is-active' : ''}><input type="radio" name="visual-theme" value="comic" checked={settings.visualTheme === 'comic'} onChange={() => update('visualTheme', 'comic')} /><span aria-hidden="true">🌈</span><strong>Bunt & Comic</strong><small>Quietschig, freundlich und kindgerecht</small></label>
            <label className={settings.visualTheme === 'standard' ? 'is-active' : ''}><input type="radio" name="visual-theme" value="standard" checked={settings.visualTheme === 'standard'} onChange={() => update('visualTheme', 'standard')} /><span aria-hidden="true">✨</span><strong>Modern & ruhig</strong><small>Klar, hochwertig und zurückhaltend</small></label>
          </div>
        </fieldset>
        <fieldset className="settings-card settings-card--wide">
          <legend>Katalogmodus</legend>
          <label className="field"><span>Datenquellen bei der Produktsuche</span><select value={settings.clinicMode} onChange={(event: ChangeEvent<HTMLSelectElement>) => update('clinicMode', event.target.value as OfflineAppSettings['clinicMode'])} data-testid="clinic-mode-select"><option value="hybrid">Hybrid – Klinik bevorzugt + großer Katalog</option><option value="clinic-only">Klinik Only – nur Klinikum Leverkusen</option><option value="off">Klinik Off – nur großer SQLite-Katalog</option></select></label>
          <p className="settings-note">Im Hybridmodus haben passende Klinikwerte Vorrang. „Klinik Off“ ignoriert die Klinikdatei vollständig; „Klinik Only“ macht alle 105 Klinikdatensätze durchsuch- und scrollbar.</p>
        </fieldset>
        <DiabetesSettings enabled={settings.diabeticProfileEnabled} segments={settings.diabetesSegments} onEnabledChange={(enabled) => update('diabeticProfileEnabled', enabled)} onSegmentsChange={(segments) => update('diabetesSegments', segments)} />
        <fieldset className="settings-card settings-card--wide transfer-settings">
          <legend>Auf ein anderes Gerät übertragen</legend>
          <p>Eine einzige Datei enthält den Verlauf, die Diabeteseinstellungen und deine persönlichen Portions-, Scheiben-, Stück- und Riegel-Overrides. Kein Profil und keine Anmeldung nötig.</p>
          <div className="button-row"><button type="button" className="button button--secondary" onClick={onExportData}>Datei exportieren</button><button type="button" className="button button--primary" onClick={() => { void onShareData(); }}>Teilen</button><label className="button button--secondary transfer-import-button">Datei importieren<input type="file" accept="application/json,.json" onChange={(event: ChangeEvent<HTMLInputElement>) => { void onImportData(event.target.files?.[0] ?? null); event.target.value = ''; }} data-testid="transfer-file-input" /></label></div>
          <small>Beim Import werden Verlauf und Overrides zusammengeführt; die Diabeteseinstellungen aus der Datei werden übernommen. Die Datei enthält Gesundheitsdaten – teile sie nur mit Geräten, denen du vertraust.</small>
          {transferMessage && <p className="inline-message" role="status">{transferMessage}</p>}
        </fieldset>
        <fieldset className="settings-card">
          <legend>Berechnung</legend>
          <label className="field">
            <span>Nachkommastellen</span>
            <select value={settings.decimalPlaces} onChange={(event: ChangeEvent<HTMLSelectElement>) => update('decimalPlaces', Number(event.target.value) as 0 | 1 | 2)}>
              <option value={0}>0</option><option value={1}>1</option><option value={2}>2</option>
            </select>
          </label>
          <label className="field">
            <span>Maximale Suchtreffer</span>
            <select value={settings.searchResultLimit} onChange={(event: ChangeEvent<HTMLSelectElement>) => update('searchResultLimit', Number(event.target.value) as 10 | 15 | 20)}>
              <option value={10}>10</option><option value={15}>15</option><option value={20}>20</option>
            </select>
          </label>
        </fieldset>
        <fieldset className="settings-card">
          <legend>Lokale Speicherung</legend>
          <label className="switch-row"><span><strong>Einzelberechnungen speichern</strong><small>Gesamtrechnungen werden immer automatisch gespeichert; dieser Schalter gilt für einzelne Produkte.</small></span><input type="checkbox" checked={settings.saveHistory} onChange={(event: ChangeEvent<HTMLInputElement>) => update('saveHistory', event.target.checked)} /></label>
          <label className="switch-row"><span><strong>Letzte Ansicht wiederherstellen</strong><small>Speichert nur Suche, Produktcode, Menge und Einheit.</small></span><input type="checkbox" checked={settings.restoreLastSession} onChange={(event: ChangeEvent<HTMLInputElement>) => update('restoreLastSession', event.target.checked)} /></label>
        </fieldset>
        <fieldset className="settings-card">
          <legend>Produktbilder</legend>
          <label className="field"><span>Bildanzeige</span><select value={settings.productImageMode} onChange={(event: ChangeEvent<HTMLSelectElement>) => update('productImageMode', event.target.value as OfflineAppSettings['productImageMode'])}><option value="remote">Wenn vorhanden laden</option><option value="hidden">Immer ausblenden</option></select></label>
          <p className="settings-note">Bilder sind optional. Suche, Auswahl, Einheiten und Berechnung bleiben vollständig lokal.</p>
        </fieldset>
        <section className="settings-card" aria-labelledby="local-data-title">
          <h2 id="local-data-title">Lokale Nutzerdaten</h2>
          <dl className="data-counts"><div><dt>Kalibrierungen</dt><dd>{counts.calibrations}</dd></div><div><dt>Verlauf</dt><dd>{counts.history}</dd></div><div><dt>Favoriten</dt><dd>{counts.favorites}</dd></div><div><dt>Eigene Produkte</dt><dd>{counts.manualProducts}</dd></div><div><dt>Produktfotos</dt><dd>{counts.productPhotos}</dd></div></dl>
          <div className="button-stack"><button type="button" className="button button--secondary" onClick={onClearHistory}>Verlauf löschen</button><button type="button" className="button button--secondary" onClick={onClearSession}>Gespeicherte Ansicht löschen</button><button type="button" className="button button--danger" onClick={onClearAllUserData}>Alle lokalen Nutzerdaten löschen</button></div>
        </section>
      </div>
    </section>
  );
}
