import type { CatalogStatus as CatalogStatusModel } from '../lib/catalog/catalogDomain';

export interface CatalogStatusProps {
  status: CatalogStatusModel;
  installedFromNetwork: boolean;
  onRetry: () => void;
}

const STATE_LABELS: Record<CatalogStatusModel['state'], string> = {
  idle: 'Katalog wird vorbereitet',
  checking: 'Lokaler Katalog wird geprüft',
  downloading: 'Lokaler Katalog wird geladen',
  installing: 'Lokaler Katalog wird installiert',
  ready: 'Lokaler Katalog bereit',
  unavailable: 'Lokaler Katalog nicht verfügbar'
};

export function CatalogStatus({ status, installedFromNetwork, onRetry }: CatalogStatusProps) {
  const persistent = status.persistent;
  const tone = status.state === 'unavailable'
    ? 'danger'
    : status.state === 'ready'
      ? 'success'
      : 'working';
  const progress = status.progress === null ? null : Math.round(status.progress * 100);

  return (
    <section
      className={`catalog-status catalog-status--${tone}`}
      aria-live="polite"
      data-testid="catalog-status"
      data-state={status.state}
      data-persistent={String(persistent)}
      data-product-count={status.productCount ?? ''}
      data-catalog-version={status.catalogVersion ?? ''}
      data-active-slot={status.activeSlot ?? ''}
      data-installed-from-network={String(installedFromNetwork)}
    >
      <span className="catalog-status__signal" aria-hidden="true" />
      <div className="catalog-status__body">
        <strong>{STATE_LABELS[status.state]}</strong>
        {status.state === 'ready' ? (
          <span>
            {status.productCount?.toLocaleString('de-DE') ?? '–'} Produkte · Version{' '}
            {status.catalogVersion ?? 'unbekannt'}
          </span>
        ) : (
          <span>{status.diagnostics?.message ?? 'Die verifizierte SQLite-Datenbank wird vorbereitet.'}</span>
        )}
        {progress !== null && status.state !== 'ready' && (
          <span className="catalog-status__progress" role="progressbar" aria-label="Katalogfortschritt" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
            <span style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
          </span>
        )}
        {status.state === 'ready' && (
          <small>
            {persistent ? `Dauerhaft in OPFS · Slot ${status.activeSlot}` : 'Nur für diese Sitzung verfügbar'}
          </small>
        )}
      </div>
      {status.state === 'unavailable' && (
        <button type="button" className="button button--secondary" onClick={onRetry}>
          Sofort erneut laden
        </button>
      )}
    </section>
  );
}
