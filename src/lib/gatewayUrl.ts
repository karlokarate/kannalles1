export class GatewayUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GatewayUrlError';
  }
}

function isLoopback(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || normalized === '::1'
    || /^127(?:\.\d{1,3}){3}$/.test(normalized);
}

/**
 * Browser product access is offline-catalog-only. Returning an empty runtime
 * endpoint also neutralizes gateway URLs persisted by previous releases, so an
 * obsolete setting can never block or silently re-enable network search.
 *
 * Node-side validation remains available for retained migration tooling until
 * the old gateway tree is removed in a separate cleanup.
 */
export function validatedGatewayBase(
  value: string,
  currentOrigin?: string,
  allowEmpty = false
): string {
  if (typeof window !== 'undefined') return '';

  const clean = value.trim();
  if (!clean) {
    if (allowEmpty) return '';
    throw new GatewayUrlError('Kein Daten-Gateway konfiguriert.');
  }
  try {
    if (clean.startsWith('/') && !currentOrigin) {
      throw new GatewayUrlError('Ein relativer Gateway-Pfad benötigt einen Browser-Origin.');
    }
    const base = clean.startsWith('/')
      ? new URL(clean, currentOrigin as string)
      : new URL(clean);
    if (!['http:', 'https:'].includes(base.protocol)) {
      throw new GatewayUrlError('Erlaubt sind nur HTTP- oder HTTPS-Endpunkte.');
    }
    if (base.username || base.password || base.search || base.hash) {
      throw new GatewayUrlError('Die Gateway-Basis darf keine Zugangsdaten, Query-Parameter oder URL-Fragmente enthalten.');
    }
    const sameOrigin = currentOrigin
      ? base.origin === new URL(currentOrigin).origin
      : false;
    if (base.protocol === 'http:' && !sameOrigin && !isLoopback(base.hostname)) {
      throw new GatewayUrlError('Externe Gateways müssen HTTPS verwenden; HTTP ist nur Same-Origin oder auf Loopback zulässig.');
    }
    return clean;
  } catch (cause) {
    if (cause instanceof GatewayUrlError) throw cause;
    throw new GatewayUrlError('Die Gateway-Adresse ist keine gültige oder sichere URL.');
  }
}
