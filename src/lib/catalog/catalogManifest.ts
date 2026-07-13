import {
  CATALOG_APPLICATION_ID,
  CATALOG_IMAGE_SIZE,
  CATALOG_USER_VERSION
} from '../../../Catalog/catalog-runtime.generated';
import type { CatalogManifest } from './catalogProtocol';

export class CatalogManifestError extends Error {
  readonly code = 'CATALOG_MANIFEST_INVALID' as const;

  constructor(message: string) {
    super(message);
    this.name = 'CatalogManifestError';
  }
}

const EXPECTED_CONTRACT = 'kh-checker-offline-catalog-production';
const EXPECTED_ORDERING =
  'exact display-name match, display-name prefix, display-name contains, then r DESC, n COLLATE NOCASE ASC, id ASC';
const SAFE_FILE = /^[a-z0-9][a-z0-9._-]*$/i;
const SHA256 = /^[a-f0-9]{64}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requiredRecord(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = parent[key];
  if (!isRecord(value)) throw new CatalogManifestError(`Manifestfeld ${key} fehlt oder ist ungültig.`);
  return value;
}

function requiredString(parent: Record<string, unknown>, key: string): string {
  const value = parent[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new CatalogManifestError(`Manifestfeld ${key} fehlt oder ist ungültig.`);
  }
  return value;
}

function positiveSafeInteger(parent: Record<string, unknown>, key: string): number {
  const value = parent[key];
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new CatalogManifestError(`Manifestfeld ${key} muss eine positive sichere Ganzzahl sein.`);
  }
  return Number(value);
}

function safeFilename(value: string, field: string): string {
  if (!SAFE_FILE.test(value) || value === '.' || value === '..') {
    throw new CatalogManifestError(`Manifestfeld ${field} ist kein sicherer Dateiname.`);
  }
  return value;
}

function sha256(value: string, field: string): string {
  if (!SHA256.test(value)) throw new CatalogManifestError(`Manifestfeld ${field} ist kein SHA-256-Wert.`);
  return value.toLowerCase();
}

export function parseCatalogManifest(value: unknown): CatalogManifest {
  if (!isRecord(value)) throw new CatalogManifestError('Das Produktions-Katalogmanifest ist kein Objekt.');

  const database = requiredRecord(value, 'database');
  const image = requiredRecord(value, 'image');
  const search = requiredRecord(value, 'search');
  const contract = requiredString(value, 'contract');
  const contractVersion = requiredString(value, 'contractVersion');
  const catalogVersion = requiredString(value, 'catalogVersion');
  const generatedAtUtc = requiredString(value, 'generatedAtUtc');
  const filename = safeFilename(requiredString(database, 'file'), 'database.file');
  const databaseSha256 = sha256(requiredString(database, 'sha256'), 'database.sha256');
  const codecFile = safeFilename(requiredString(value, 'codecFile'), 'codecFile');
  const runtimeTypescript = safeFilename(requiredString(value, 'runtimeTypescript'), 'runtimeTypescript');
  const imageDictionaryFile = safeFilename(requiredString(image, 'dictionaryFile'), 'image.dictionaryFile');
  const imageDictionarySha256 = sha256(
    requiredString(image, 'dictionarySha256'),
    'image.dictionarySha256'
  );
  const searchOrdering = requiredString(search, 'ordering');

  if (contract !== EXPECTED_CONTRACT) throw new CatalogManifestError('Unbekannter Katalogvertrag.');
  if (contractVersion !== '1.0.0') throw new CatalogManifestError('Nicht unterstützte Katalogvertragsversion.');
  if (Number.isNaN(Date.parse(generatedAtUtc))) throw new CatalogManifestError('generatedAtUtc ist kein Zeitstempel.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(catalogVersion)) {
    throw new CatalogManifestError('catalogVersion muss das Format YYYY-MM-DD verwenden.');
  }
  if (!filename.endsWith('.sqlite')) throw new CatalogManifestError('Die Manifestdatenbank muss eine SQLite-Datei sein.');
  if (Number(database.applicationId) !== CATALOG_APPLICATION_ID) {
    throw new CatalogManifestError('applicationId passt nicht zur generierten Runtime.');
  }
  if (Number(database.userVersion) !== CATALOG_USER_VERSION) {
    throw new CatalogManifestError('userVersion passt nicht zur generierten Runtime.');
  }
  if (Number(database.pageSize) !== 4096) throw new CatalogManifestError('Unerwartete SQLite-Seitengröße.');
  if (codecFile !== 'catalog-codecs.v1.json') throw new CatalogManifestError('Unerwartete Codec-Datei.');
  if (runtimeTypescript !== 'catalog-runtime.generated.ts') {
    throw new CatalogManifestError('Unerwartete Runtime-SSOT-Datei.');
  }
  if (Number(image.resolution) !== CATALOG_IMAGE_SIZE) {
    throw new CatalogManifestError('Bildauflösung passt nicht zur generierten Runtime.');
  }
  if (imageDictionaryFile !== 'catalog-image-keys.v2.json') {
    throw new CatalogManifestError('Unerwartete Bildschlüsseldatei.');
  }
  if (value.transportCompression !== null) {
    throw new CatalogManifestError('Komprimierte Katalogtransporte werden von Production-v1 nicht unterstützt.');
  }
  if (searchOrdering !== EXPECTED_ORDERING) {
    throw new CatalogManifestError('Die Suchreihenfolge weicht von der Production-v1-Authority ab.');
  }

  const runtimeParameters = search.runtimeParameters;
  const expectedRuntimeParameters = [
    'ftsQuery',
    'canonicalProductQuery',
    'canonicalProductQuery',
    'canonicalProductQuery',
    'limit'
  ];
  if (
    !Array.isArray(runtimeParameters)
    || runtimeParameters.length !== expectedRuntimeParameters.length
    || runtimeParameters.some((item, index) => item !== expectedRuntimeParameters[index])
  ) {
    throw new CatalogManifestError('search.runtimeParameters ist ungültig.');
  }
  if (Number(search.resultLimitDefault) !== 20) {
    throw new CatalogManifestError('Production-v1 muss exakt 20 Standardsuchergebnisse deklarieren.');
  }

  return {
    contract: EXPECTED_CONTRACT,
    contractVersion,
    catalogVersion,
    generatedAtUtc,
    filename,
    sizeBytes: positiveSafeInteger(database, 'bytes'),
    sha256: databaseSha256,
    applicationId: Number(database.applicationId),
    userVersion: Number(database.userVersion),
    pageSize: Number(database.pageSize),
    productCount: positiveSafeInteger(database, 'products'),
    brandCount: positiveSafeInteger(database, 'brands'),
    codecFile,
    runtimeTypescript,
    imageResolution: Number(image.resolution),
    imageDictionaryFile,
    imageDictionarySha256,
    transportCompression: null,
    searchOrdering,
    resultLimitDefault: positiveSafeInteger(search, 'resultLimitDefault')
  };
}

export async function fetchCatalogManifest(url: string, signal?: AbortSignal): Promise<CatalogManifest> {
  const response = await fetch(url, {
    cache: 'no-store',
    credentials: 'same-origin',
    signal
  });
  if (!response.ok) {
    const error = new Error(`Katalogmanifest nicht erreichbar (HTTP ${response.status}).`);
    error.name = 'CatalogManifestUnavailableError';
    Object.assign(error, { code: 'CATALOG_MANIFEST_UNAVAILABLE' as const });
    throw error;
  }
  try {
    return parseCatalogManifest(await response.json());
  } catch (error) {
    if (error instanceof CatalogManifestError) throw error;
    throw new CatalogManifestError(`Katalogmanifest konnte nicht gelesen werden: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function resolveCatalogArtifactUrl(manifest: CatalogManifest, catalogBaseUrl: string): string {
  const base = new URL('./', catalogBaseUrl);
  return new URL(encodeURIComponent(manifest.filename), base).href;
}
