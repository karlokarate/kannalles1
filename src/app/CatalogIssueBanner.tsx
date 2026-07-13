import type { CatalogDiagnostics } from '../lib/catalog/catalogDomain';

export interface CatalogIssueBannerProps {
  diagnostics: CatalogDiagnostics;
  onRetry?: () => void;
  onDismiss: () => void;
}

export function CatalogIssueBanner({
  diagnostics,
  onRetry,
  onDismiss
}: CatalogIssueBannerProps) {
  return (
    <section
      className="issue-banner"
      role="alert"
      aria-labelledby="catalog-issue-title"
      data-testid="catalog-issue"
      data-error-code={diagnostics.code}
      data-operation={diagnostics.operation}
      data-retry-allowed-immediately="true"
      data-active-slot={diagnostics.activeSlot ?? ''}
      data-attempted-slot={diagnostics.attemptedSlot ?? ''}
    >
      <div className="issue-banner__icon" aria-hidden="true">!</div>
      <div className="issue-banner__body">
        <strong id="catalog-issue-title">{diagnostics.message}</strong>
        <p>
          Der letzte verifizierte Katalog bleibt maßgeblich. Es wird keine Online-Produktsuche als
          Ausweichweg gestartet.
        </p>
        <details>
          <summary>Technische Details</summary>
          <dl className="technical-details">
            <div><dt>Code</dt><dd>{diagnostics.code}</dd></div>
            <div><dt>Vorgang</dt><dd>{diagnostics.operation}</dd></div>
            <div><dt>Zeitpunkt</dt><dd>{new Date(diagnostics.occurredAt).toLocaleString('de-DE')}</dd></div>
            <div><dt>Technisch</dt><dd>{diagnostics.technical}</dd></div>
            {Object.entries(diagnostics.details).map(([key, value]) => (
              <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>
            ))}
          </dl>
        </details>
        <div className="button-row">
          {onRetry && (
            <button type="button" className="button button--primary" onClick={onRetry}>
              Sofort erneut versuchen
            </button>
          )}
          <button type="button" className="button button--ghost" onClick={onDismiss}>
            Schließen
          </button>
        </div>
      </div>
    </section>
  );
}
