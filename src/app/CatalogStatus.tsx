import type { CatalogRuntimeStatus } from '../lib/catalog/catalogProtocol';

export interface CatalogStatusProps {
  status: CatalogRuntimeStatus;
  onRetry: () => void;
}

const stateLabels: Record<CatalogRuntimeStatus['state'], string> = {
  idle: 'Katalog wird vorbereitet',
  installing: 'Lokaler Katalog wird installiert',
  ready: 'Lokaler Katalog bereit',
  failed: 'Lokaler Katalog nicht verfügbar'
};

export function CatalogStatus({ status, onRetry }: CatalogStatusProps) {
  const isReady = status.state === 'ready';
  const tone = status.state === 'failed' ? 'danger' : isReady ? 'success' : 'working';
  return (
    <section className={`catalog-status catalog-status--${tone}`} aria-live="polite">
      <div className="catalog-status__signal" aria-hidden="true" />
      <div className="catalog-status__body">
        <strong>{stateLabels[status.state]}</strong>
        <span>
          {status.message
            ?? (isReady
              ? `${status.productCount?.toLocaleString('de-DE') ?? '–'} Produkte · Version ${status.catalogVersion ?? 'unbekannt'}`
              : 'Die App wartet auf die lokale SQLite-Datenbank.')}
        </span>
        {isReady && (
          <small>
            {status.persistent ? 'Dauerhaft auf diesem Gerät gespeichert' : 'Nur für diese Sitzung verfügbar'}
            {status.installedFromNetwork ? ' · erstmalig geladen' : ' · lokal wiederverwendet'}
          </small>
        )}
      </div>
      {status.state === 'failed' && (
        <button type="button" className="button button--secondary" onClick={onRetry}>
          Erneut laden
        </button>
      )}
    </section>
  );
}
