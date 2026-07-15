import { CatalogIssueBanner } from './app/CatalogIssueBanner';
import { CatalogStatus } from './app/CatalogStatus';
import { CalculatorScreen } from './app/CalculatorScreen';
import { SettingsScreen } from './app/SettingsScreen';
import { SmartUnitPromptOverlay } from './app/SmartUnitPromptOverlay';
import { unitLabel } from './app/catalogViewModel';
import { useSmartCatalogController } from './app/useSmartCatalogController';
import type { CatalogController } from './app/useCatalogController';
import { formatCarbohydrates } from './lib/settings';

const APP_VERSION = __APP_VERSION__;

function HistoryScreen({ c }: { c: CatalogController }) {
  const hasEntries = c.savedMeals.length > 0 || c.history.length > 0;
  return <section className="screen" aria-labelledby="history-title">
    <header className="screen-heading"><div><span className="eyebrow">Nur lokal</span><h1 id="history-title">Verlauf</h1></div>{hasEntries && <button type="button" className="button button--ghost" onClick={() => { if (window.confirm('Den gesamten Verlauf einschließlich gespeicherter Rechnungen löschen?')) c.clearHistory(); }}>Alles löschen</button>}</header>
    {!hasEntries ? <div className="empty-state"><strong>Noch kein Verlauf</strong><p>Gesamtrechnungen kannst du direkt in ihrer Übersicht speichern.</p></div> : <>
      {c.savedMeals.length > 0 && <section className="saved-meal-history" aria-labelledby="saved-meals-title"><div className="section-title-row"><div><span className="eyebrow">Wiederverwendbar</span><h2 id="saved-meals-title">Gespeicherte Rechnungen</h2></div><span>{c.savedMeals.length}</span></div><div className="history-list">{c.savedMeals.map((entry) => <article key={entry.id} className="history-entry history-entry--meal"><div><strong>{entry.items.map((item) => item.productName).join(' + ')}</strong><small>{new Date(entry.createdAt).toLocaleString('de-DE')} · {entry.items.length} {entry.items.length === 1 ? 'Produkt' : 'Produkte'}</small></div><b>{formatCarbohydrates(entry.totalCarbohydratesG, c.settings.decimalPlaces)} g KH</b><div className="history-entry__actions"><button type="button" className="button button--primary" onClick={() => { void c.loadSavedMeal(entry); }}>Öffnen & verwenden</button><button type="button" className="button button--ghost" onClick={() => { if (window.confirm('Diese gespeicherte Rechnung löschen?')) c.removeSavedMeal(entry.id); }} aria-label="Gespeicherte Rechnung löschen">Löschen</button></div></article>)}</div></section>}
      {c.history.length > 0 && <section aria-labelledby="single-history-title"><div className="section-title-row"><div><span className="eyebrow">Einzelberechnungen</span><h2 id="single-history-title">Produkte</h2></div><span>{c.history.length}</span></div><div className="history-list">{c.history.map((entry) => <article key={entry.id} className="history-entry"><div><strong>{entry.product.displayName}</strong><small>{new Date(entry.createdAt).toLocaleString('de-DE')}</small></div><span>{entry.amount.toLocaleString('de-DE')} {unitLabel(entry.unit)}</span><b>{formatCarbohydrates(entry.totalCarbohydratesG, c.settings.decimalPlaces)} g KH</b></article>)}</div></section>}
    </>}
  </section>;
}

export default function App() {
  const c = useSmartCatalogController();
  return (
    <div className="app-shell" data-app-mode="offline-catalog" data-visual-theme={c.settings.visualTheme} data-catalog-state={c.status.state} data-catalog-version={c.status.catalogVersion ?? ''} data-product-count={c.status.productCount ?? ''} data-persistent={String(c.status.persistent)} data-installed-from-network={String(c.installedFromNetwork)} data-active-slot={c.status.activeSlot ?? ''} data-search-state={c.search.phase} data-product-state={c.product ? 'selected' : 'none'} data-unit-state={c.resolution?.status ?? 'idle'} data-calculation-state={c.calculation?.status ?? 'idle'}>
      <a className="skip-link" href="#main-content">Zum Inhalt springen</a>
      <header className="app-header"><div className="brand-lockup"><span className="brand-mark" aria-hidden="true">KH</span><div><strong>FishIT KH Checker</strong><span>Offline-Kohlenhydratrechner</span></div></div><span className="version-badge">v{APP_VERSION}</span></header>
      {c.status.state !== 'ready' && <CatalogStatus status={c.status} installedFromNetwork={c.installedFromNetwork} onRetry={() => void c.initialize()} />}
      {c.status.diagnostics && <CatalogIssueBanner diagnostics={c.status.diagnostics} onRetry={() => void c.initialize()} onDismiss={() => c.setStatus((s) => ({ ...s, diagnostics: null }))} />}
      {c.search.diagnostics && <CatalogIssueBanner diagnostics={c.search.diagnostics} onRetry={() => void c.executeSearch(c.query)} onDismiss={() => c.dispatch({ type: 'clear-message' })} />}

      <main id="main-content" className="app-main">
        {c.section === 'calculator' && <CalculatorScreen c={c} />}
        {c.section === 'history' && <HistoryScreen c={c} />}
        {c.section === 'favorites' && <section className="screen" aria-labelledby="favorites-title"><header className="screen-heading"><div><span className="eyebrow">Schnellzugriff</span><h1 id="favorites-title">Favoriten</h1></div></header>{c.favorites.length === 0 ? <div className="empty-state"><strong>Noch keine Favoriten</strong><p>Markiere ein geöffnetes Katalogprodukt mit „Merken“.</p></div> : <div className="result-list">{c.favorites.map((favorite) => <button key={favorite.productId} type="button" className="product-result" onClick={() => { const query = favorite.code.startsWith('generic:') ? favorite.displayName : favorite.code; c.setSection('calculator'); c.setManualMode(false); c.setQuery(query); void c.executeSearch(query); }}><span className="result-copy"><strong>{favorite.displayName}</strong><small>{favorite.brand ?? favorite.code}</small></span><span aria-hidden="true">→</span></button>)}</div>}</section>}
        {c.section === 'settings' && <SettingsScreen settings={c.settings} counts={c.counts} onChange={c.updateSettings} onClearHistory={c.clearHistory} onClearSession={() => { c.clearSession(); c.refreshLocalData(); }} onClearAllUserData={c.clearAll} onExportData={c.downloadTransferFile} onShareData={c.shareTransferFile} onImportData={c.importTransferFile} transferMessage={c.transferMessage} />}
      </main>

      {c.section === 'calculator' && <SmartUnitPromptOverlay c={c} />}
      <nav className="bottom-nav" aria-label="Hauptnavigation">{([['calculator', 'Rechner', '⌕'], ['history', 'Verlauf', '↺'], ['favorites', 'Favoriten', '★'], ['settings', 'Einstellungen', '⚙']] as const).map(([value, label, icon]) => <button key={value} type="button" className={c.section === value ? 'is-active' : ''} aria-current={c.section === value ? 'page' : undefined} onClick={() => c.setSection(value)}><span aria-hidden="true">{icon}</span>{label}</button>)}</nav>
    </div>
  );
}
