import type { CatalogIssue } from '../lib/searchState';

export interface CatalogIssueBannerProps {
  issue: CatalogIssue;
  onRetry?: () => void;
  onDismiss: () => void;
}

export function CatalogIssueBanner({ issue, onRetry, onDismiss }: CatalogIssueBannerProps) {
  return (
    <section className="issue-banner" role="alert" aria-labelledby="catalog-issue-title">
      <div className="issue-banner__icon" aria-hidden="true">!</div>
      <div className="issue-banner__body">
        <strong id="catalog-issue-title">{issue.title}</strong>
        <p>{issue.message}</p>
        <details>
          <summary>Technische Details</summary>
          <dl className="technical-details">
            <div>
              <dt>Zeitpunkt</dt>
              <dd>{new Date(issue.occurredAt).toLocaleString('de-DE')}</dd>
            </div>
            <div>
              <dt>Fehler</dt>
              <dd>{issue.technical}</dd>
            </div>
            <div>
              <dt>Erneut versuchen</dt>
              <dd>sofort möglich</dd>
            </div>
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
