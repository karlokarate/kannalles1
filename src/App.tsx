import { CatalogIssueBanner } from './app/CatalogIssueBanner';
import { CatalogStatus } from './app/CatalogStatus';
import { CalculatorScreen } from './app/CalculatorScreen';
import { SettingsScreen } from './app/SettingsScreen';
import { unitLabel } from './app/catalogViewModel';
import { useCatalogController } from './app/useCatalogController';
import { formatCarbohydrates } from './lib/settings';

const APP_VERSION = __APP_VERSION__;

export default function App() {
  const c = useCatalogController();
  return (
    <div className="app-shell" data-app-mode="offline-catalog" data-catalog-state={c.status.state} data-search-state={c.search.phase} data-product-state={c.product ? 'selected' : 'none'} data-unit-state={c.resolution?.status ?? 'idle'} data-calculation-state={c.calculation?.status ?? 'idle'}>
      <a className="skip-link" href="#main-content">Zum Inhalt springen</a>
      <header className="app-header"><div className="brand-lockup"><span className="brand-mark" aria-hidden="true">KH</span><div><strong>KH Checker</strong><span>Offline-Kohlenhydratrechner</span></div></div><span className="version-badge">v{APP_VERSION}</span></header>
      <CatalogStatus status={c.status} installedFromNetwork={c.installedFromNetwork} onRetry={() => void c.initialize()} />
      {c.status.diagnostics && <CatalogIssueBanner diagnostics={c.status.diagnostics} onRetry={() => void c.initialize()} onDismiss={() => c.setStatus((s) => ({ ...s, diagnostics: null }))} />}
      {c.search.diagnostics && <CatalogIssueBanner diagnostics={c.search.diagnostics} onRetry={() => void c.executeSearch(c.query)} onDismiss={() => c.dispatch({ type: 'clear-message' })} />}

      <main id="main-content" className="app-main">
        {c.section === 'calculator' && <CalculatorScreen c={c} />}
        {c.section === 'history' && <section className="screen" aria-labelledby="history-title"><header className="screen-heading"><div><span className="eyebrow">Nur lokal</span><h1 id="history-title">Verlauf</h1></div>{c.history.length > 0 && <button type="button" className="button button--ghost" onClick={c.clearHistory}>Löschen</button>}</header>{c.history.length === 0 ? <div className="empty-state"><strong>Noch kein Verlauf</strong><p>Aktiviere das Speichern in den Einstellungen.</p></div> : <div className="history-list">{c.history.map((entry) => <article key={entry.id} className="history-entry"><div><strong>{entry.product.displayName}</strong><small>{new Date(entry.createdAt).toLocaleString('de-DE')}</small></div><span>{entry.amount.toLocaleString('de-DE')} {unitLabel(entry.unit)}</span><b>{formatCarbohydrates(entry.totalCarbohydratesG, c.settings.decimalPlaces)} g KH</b></article>)}</div>}</section>}
        {c.section === 'favorites' && <section className="screen" aria-labelledby="favorites-title"><header className="screen-heading"><div><span className="eyebrow">Schnellzugriff</span><h1 id="favorites-title">Favoriten</h1></div></header>{c.favorites.length === 0 ? <div className="empty-state"><strong>Noch keine Favoriten</strong><p>Markiere ein geöffnetes Katalogprodukt mit „Merken“.</p></div> : <div className="result-list">{c.favorites.map((favorite) => <button key={favorite.productId} type="button" className="product-result" onClick={() => { const query = favorite.code.startsWith('generic:') ? favorite.displayName : favorite.code; c.setSection('calculator'); c.setManualMode(false); c.setQuery(query); void c.executeSearch(query); }}><span className="result-copy"><strong>{favorite.displayName}</strong><small>{favorite.brand ?? favorite.code}</small></span><span aria-hidden="true">→</span></button>)}</div>}</section>}
        {c.section === 'settings' && <SettingsScreen settings={c.settings} counts={c.counts} onChange={c.updateSettings} onClearHistory={c.clearHistory} onClearSession={() => { c.clearSession(); c.refreshLocalData(); }} onClearAllUserData={c.clearAll} />}
      </main>

      <nav className="bottom-nav" aria-label="Hauptnavigation">{([['calculator', 'Rechner', '⌕'], ['history', 'Verlauf', '↺'], ['favorites', 'Favoriten', '★'], ['settings', 'Einstellungen', '⚙']] as const).map(([value, label, icon]) => <button key={value} type="button" className={c.section === value ? 'is-active' : ''} aria-current={c.section === value ? 'page' : undefined} onClick={() => c.setSection(value)}><span aria-hidden="true">{icon}</span>{label}</button>)}</nav>
    </div>
  );
}
