import type { ChangeEvent } from 'react';
import type { OfflineAppSettings } from '../lib/settings';
import type { UserDataCounts } from '../lib/userDataStore';
import { DiabetesSettings } from './DiabetesSettings';
import { PwaUpdateSettings } from './PwaUpdateSettings';
import type { PwaUpdateViewModel } from './usePwaUpdate';

export interface SettingsScreenProps {
  settings: OfflineAppSettings;
  counts: UserDataCounts;
  pwaUpdate: PwaUpdateViewModel;
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
  pwaUpdate,
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
        <PwaUpdateSettings pwa={pwaUpdate} />
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
        <DiabetesSettings enabled={settings.diabeticProfileEnabled} factorSegments={settings.diabetesFactorSegments} insulinActivityDurationHours={settings.insulinActivityDurationHours} manualBolusTrackingEnabled={settings.manualBolusTrackingEnabled} onEnabledChange={(enabled) => update('diabeticProfileEnabled', enabled)} onFactorSegmentsChange={(key, segments) => update('diabetesFactorSegments', { ...settings.diabetesFactorSegments, [key]: segments })} onInsulinActivityDurationChange={(hours) => update('insulinActivityDurationHours', hours)} onManualBolusTrackingChange={(enabled) => update('manualBolusTrackingEnabled', enabled)} />
        <fieldset className="settings-card settings-card--wide transfer-settings">
          <legend>Auf ein anderes Gerät übertragen</legend>
          <p>Eine einzige Datei enthält den Verlauf, die Diabeteseinstellungen und deine persönlichen Portions-, Scheiben-, Stück- und Riegel-Overrides. Kein Profil und keine Anmeldung nötig.</p>
          <div className="button-row"><button type="button" className="button button--secondary" onClick={onExportData}>Datei exportieren</button><button type="button" className="button button--primary" onClick={() => { void onShareData(); }}>Nativ teilen</button><label className="button button--secondary transfer-import-button">Datei importieren<input type="file" accept="application/json,text/plain,.json,.txt" onChange={(event: ChangeEvent<HTMLInputElement>) => { void onImportData(event.target.files?.[0] ?? null); event.target.value = ''; }} data-testid="transfer-file-input" /></label></div>
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
        <section className="settings-card settings-card--wide legal-notice" aria-labelledby="legal-notice-title" data-testid="legal-notice">
          <h2 id="legal-notice-title">Impressum &amp; Lizenzen</h2>
          <div className="legal-notice__grid">
            <section aria-labelledby="developer-contact-title">
              <h3 id="developer-contact-title">Entwicklerkontakt</h3>
              <p><strong>C. Fischer</strong><br />Leverkusen, Deutschland</p>
              <p>Fehlerberichte, Wünsche und sonstige Rückmeldungen bitte per E-Mail an <a href="mailto:fishit.apps@gmail.com">fishit.apps@gmail.com</a>.</p>
            </section>
            <section aria-labelledby="app-license-title">
              <h3 id="app-license-title">Web-App und Software</h3>
              <p>Die öffentlich bereitgestellte Web-App ist ausschließlich für die private, nicht kommerzielle Nutzung bestimmt und wird lizenzkostenfrei angeboten. Der Quellcode des FishIT KH Checkers steht unabhängig davon unter der <a href="https://opensource.org/license/mit" target="_blank" rel="noreferrer">MIT-Lizenz</a>; deren Bedingungen gelten für die Weiterverwendung des Quellcodes.</p>
              <p>Die App verwendet <a href="https://react.dev/" target="_blank" rel="noreferrer">React, React DOM und Scheduler</a> unter der MIT-Lizenz sowie <a href="https://github.com/sqlite/sqlite-wasm" target="_blank" rel="noreferrer">SQLite Wasm</a> unter Apache-2.0. Der eingebettete SQLite-Kern ist gemeinfrei (Public Domain).</p>
            </section>
          </div>
          <section className="legal-notice__liability" aria-labelledby="usage-liability-title">
            <h3 id="usage-liability-title">Nutzung &amp; Haftung</h3>
            <p>Die App ist ausschließlich eine unverbindliche Rechen- und Orientierungshilfe. Sie ersetzt weder medizinische Beratung, Diagnose oder Behandlung noch die Prüfung durch qualifiziertes medizinisches Fachpersonal. Insbesondere stellt eine angezeigte Insulinmenge keine Dosierfreigabe dar. Behandlungs- oder Dosierungsentscheidungen dürfen nicht allein auf Grundlage der App getroffen werden und sind mit dem persönlichen Behandlungsteam abzustimmen.</p>
            <p>Trotz sorgfältiger Entwicklung können Produktdaten, persönliche Eingaben, Berechnungen, Darstellungen oder Funktionen der App unvollständig, veraltet oder fehlerhaft sein. Es wird keine Gewähr für Richtigkeit, Vollständigkeit, Eignung, Verfügbarkeit oder Fehlerfreiheit übernommen. Die Nutzung und die Kontrolle aller Ergebnisse erfolgen eigenverantwortlich.</p>
            <p>Soweit gesetzlich zulässig, ist eine Haftung für Schäden oder nachteilige Folgen ausgeschlossen, die aus der Nutzung oder Nichtverfügbarkeit der App, aus fehlerhaften Daten oder Berechnungen oder aus darauf gestützten Behandlungsentscheidungen entstehen. Unberührt bleibt die Haftung bei Vorsatz und grober Fahrlässigkeit, bei Verletzung von Leben, Körper oder Gesundheit sowie in allen Fällen zwingender gesetzlicher Haftung.</p>
          </section>
          <section className="legal-notice__off" aria-labelledby="off-license-title">
            <h3 id="off-license-title">Open Food Facts (OFF)</h3>
            <p>Der große Offline-Produktkatalog enthält Informationen aus <a href="https://world.openfoodfacts.org/" target="_blank" rel="noreferrer">Open Food Facts</a>. Die Datenbank ist unter der <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noreferrer">Open Database License (ODbL) 1.0</a> verfügbar; einzelne Datenbankinhalte stehen unter der <a href="https://opendatacommons.org/licenses/dbcl/1-0/" target="_blank" rel="noreferrer">Database Contents License (DbCL) 1.0</a>. Der für diese App aufbereitete Offline-Katalog unterliegt ebenfalls der ODbL 1.0.</p>
            <p>Von Open Food Facts geladene Produktbilder stehen unter <a href="https://creativecommons.org/licenses/by-sa/3.0/deed.de" target="_blank" rel="noreferrer">Creative Commons Namensnennung – Weitergabe unter gleichen Bedingungen 3.0 (CC BY-SA 3.0)</a>. Abgebildete Verpackungen, Marken, Logos und sonstige Kennzeichen können zusätzlichen Rechten ihrer jeweiligen Inhaber unterliegen.</p>
            <p>OFF-Daten werden gemeinschaftlich zusammengetragen und können unvollständig, veraltet oder fehlerhaft sein. Nährwertangaben und Berechnungsergebnisse müssen bei gesundheitlich wichtigen Entscheidungen anhand der Produktverpackung oder verlässlicher Fachinformationen geprüft werden. Open Food Facts ist weder Herausgeber noch Anbieter dieser App und unterstützt sie nicht offiziell.</p>
            <p className="legal-notice__links"><a href="https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/tutorials/license-be-on-the-legal-side/" target="_blank" rel="noreferrer">OFF-Lizenzhinweise und Bedingungen zur Weiterverwendung</a></p>
          </section>
        </section>
      </div>
    </section>
  );
}
