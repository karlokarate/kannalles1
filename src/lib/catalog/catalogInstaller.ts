import {
  CATALOG_APPLICATION_ID,
  CATALOG_RESCUE_BARCODE_SQL,
  CATALOG_SEARCH_SQL,
  CATALOG_USER_VERSION,
  buildCatalogFtsQuery,
  packStandardGtin
} from '../../../Catalog/catalog-runtime.generated';
import { CatalogFailure, isCatalogFailure, toCatalogFailure } from './catalogErrors';
import type { CatalogDiagnostics, CatalogSlotId } from './catalogDomain';
import { fetchCatalogManifest, resolveCatalogArtifactUrl } from './catalogManifest';
import type { CatalogManifest } from './catalogProtocol';
import {
  CATALOG_SLOT_FILES,
  type CatalogActivationRecord,
  type CatalogActivationStore,
  inactiveSlot
} from './catalogSlots';

const PRODUCT_COLUMNS = ['id', 'g', 'n', 'b', 'c', 's', 'q', 'u', 'm', 'r'] as const;
const SMOKE_TEXT_QUERY = 'kinder bueno';
const SMOKE_BARCODE = '4008400322728';
const PRODUCT_BY_ID_SQL = `
SELECT p.id,p.g,p.n,d.v AS brand,p.c,p.s,p.q,p.u,p.m,p.r
FROM p LEFT JOIN d ON d.id=p.b
WHERE p.id=? LIMIT 1`;

export interface CatalogDatabase {
  exec(input: string | {
    readonly sql: string;
    readonly bind?: readonly unknown[];
    readonly rowMode?: 'object';
    readonly callback?: (row: Record<string, unknown>) => void;
  }): unknown;
  selectValue(sql: string, bind?: readonly unknown[]): unknown;
  close(): void;
}

export interface CatalogSlotStorage {
  hasSlot(slot: CatalogSlotId): boolean | Promise<boolean>;
  importSlot(slot: CatalogSlotId, bytes: Uint8Array): void | Promise<void>;
  removeSlot(slot: CatalogSlotId): void | Promise<void>;
  readSlot(slot: CatalogSlotId): Uint8Array | Promise<Uint8Array>;
  openSlot(slot: CatalogSlotId): CatalogDatabase;
}

export interface CatalogInstallerDependencies {
  readonly storage: CatalogSlotStorage;
  readonly activations: CatalogActivationStore;
  readonly fetch: typeof fetch;
  readonly now?: () => string;
}

export interface CatalogOpenResult {
  readonly database: CatalogDatabase;
  readonly activation: CatalogActivationRecord;
  readonly productCount: number;
  readonly installedFromNetwork: boolean;
  readonly diagnostics: CatalogDiagnostics | null;
}

interface ValidationContext {
  readonly slot: CatalogSlotId;
  readonly activeSlot: CatalogSlotId | null;
  readonly catalogVersion: string | null;
  readonly manifest: CatalogManifest | null;
}

function failure(
  code: ConstructorParameters<typeof CatalogFailure>[0],
  message: string,
  context: ValidationContext,
  cause?: unknown,
  details: Readonly<Record<string, string | number | boolean | null>> = {}
): CatalogFailure {
  return new CatalogFailure(code, message, {
    operation: 'validate',
    activeSlot: context.activeSlot,
    attemptedSlot: context.slot,
    catalogVersion: context.catalogVersion,
    cause,
    details
  });
}

function queryRows(
  database: CatalogDatabase,
  sql: string,
  bind: readonly unknown[] = []
): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  database.exec({
    sql,
    bind,
    rowMode: 'object',
    callback: (row) => rows.push(row)
  });
  return rows;
}

function firstValue(row: Record<string, unknown> | undefined): unknown {
  return row ? Object.values(row)[0] : undefined;
}

function exactColumns(rows: readonly Record<string, unknown>[]): readonly string[] {
  return rows.map((row) => String(row.name ?? ''));
}

export function validateCatalogDatabase(
  database: CatalogDatabase,
  context: ValidationContext
): { readonly productCount: number } {
  const manifest = context.manifest;
  const expectedApplicationId = manifest?.applicationId ?? CATALOG_APPLICATION_ID;
  const expectedUserVersion = manifest?.userVersion ?? CATALOG_USER_VERSION;
  const expectedPageSize = manifest?.pageSize ?? 4096;

  try {
    const applicationId = Number(database.selectValue('PRAGMA application_id'));
    if (applicationId !== expectedApplicationId) {
      throw failure(
        'CATALOG_APPLICATION_ID_MISMATCH',
        'Die SQLite application_id passt nicht zur Katalogauthority.',
        context,
        undefined,
        { expectedApplicationId, applicationId }
      );
    }

    const userVersion = Number(database.selectValue('PRAGMA user_version'));
    if (userVersion !== expectedUserVersion) {
      throw failure(
        'CATALOG_USER_VERSION_MISMATCH',
        'Die SQLite user_version passt nicht zur Katalogauthority.',
        context,
        undefined,
        { expectedUserVersion, userVersion }
      );
    }

    const pageSize = Number(database.selectValue('PRAGMA page_size'));
    if (pageSize !== expectedPageSize) {
      throw failure(
        'CATALOG_SCHEMA_MISMATCH',
        'Die SQLite-Seitengröße passt nicht zum Manifest.',
        context,
        undefined,
        { expectedPageSize, pageSize }
      );
    }

    const columns = exactColumns(queryRows(database, 'PRAGMA table_info(p)'));
    if (columns.length !== PRODUCT_COLUMNS.length || columns.some((column, index) => column !== PRODUCT_COLUMNS[index])) {
      throw failure(
        'CATALOG_SCHEMA_MISMATCH',
        'Die Produkttabelle besitzt nicht das Production-v1-Schema.',
        context,
        undefined,
        { expectedColumns: PRODUCT_COLUMNS.join(','), actualColumns: columns.join(',') }
      );
    }

    const ftsDefinition = firstValue(queryRows(
      database,
      "SELECT sql FROM sqlite_schema WHERE type='table' AND name='x' LIMIT 1"
    )[0]);
    if (typeof ftsDefinition !== 'string' || !/\bfts5\b/i.test(ftsDefinition)) {
      throw failure('CATALOG_SCHEMA_MISMATCH', 'Der erforderliche FTS5-Suchindex x fehlt.', context);
    }

    const integrityRows = queryRows(database, 'PRAGMA integrity_check');
    const integrityValues = integrityRows.map((row) => String(firstValue(row) ?? ''));
    if (integrityValues.length !== 1 || integrityValues[0] !== 'ok') {
      throw failure(
        'CATALOG_INTEGRITY_FAILED',
        'SQLite integrity_check ist fehlgeschlagen.',
        context,
        undefined,
        { integrity: integrityValues.join('; ') || 'empty' }
      );
    }

    const productCount = Number(database.selectValue('SELECT count(*) FROM p'));
    if (!Number.isSafeInteger(productCount) || productCount <= 0) {
      throw failure('CATALOG_PRODUCT_COUNT_MISMATCH', 'Die Produkttabelle ist leer oder unlesbar.', context);
    }
    if (manifest && productCount !== manifest.productCount) {
      throw failure(
        'CATALOG_PRODUCT_COUNT_MISMATCH',
        'Die Produktanzahl passt nicht zum Manifest.',
        context,
        undefined,
        { expectedProductCount: manifest.productCount, productCount }
      );
    }

    const ftsQuery = buildCatalogFtsQuery(SMOKE_TEXT_QUERY);
    if (!ftsQuery) {
      throw failure('CATALOG_QUERY_FAILED', 'Die Runtime konnte die Smoke-Suchanfrage nicht kanonisieren.', context);
    }
    const textSmoke = queryRows(database, CATALOG_SEARCH_SQL, [
      ftsQuery,
      SMOKE_TEXT_QUERY,
      SMOKE_TEXT_QUERY,
      SMOKE_TEXT_QUERY,
      1
    ]);
    if (textSmoke.length !== 1) {
      throw failure(
        'CATALOG_QUERY_FAILED',
        'Die reale Text-Smoke-Query lieferte kein Ergebnis.',
        context,
        undefined,
        { smokeQuery: SMOKE_TEXT_QUERY, hits: textSmoke.length }
      );
    }

    const packedBarcode = packStandardGtin(SMOKE_BARCODE);
    if (packedBarcode === null) {
      throw failure('CATALOG_QUERY_FAILED', 'Die Runtime konnte den Smoke-Barcode nicht codieren.', context);
    }
    const barcodeSmoke = queryRows(database, PRODUCT_BY_ID_SQL, [packedBarcode]);
    if (barcodeSmoke.length !== 1) {
      const rescueSmoke = queryRows(database, CATALOG_RESCUE_BARCODE_SQL, [SMOKE_BARCODE]);
      if (rescueSmoke.length !== 1) {
        throw failure(
          'CATALOG_QUERY_FAILED',
          'Die reale Barcode-Smoke-Query lieferte kein Ergebnis.',
          context,
          undefined,
          { smokeBarcode: SMOKE_BARCODE }
        );
      }
    }

    return { productCount };
  } catch (error) {
    if (isCatalogFailure(error)) throw error;
    throw failure('CATALOG_QUERY_FAILED', 'Die Katalogvalidierung konnte nicht abgeschlossen werden.', context, error);
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

async function downloadCatalog(
  fetcher: typeof fetch,
  manifest: CatalogManifest,
  catalogBaseUrl: string,
  activeSlot: CatalogSlotId | null
): Promise<Uint8Array> {
  const artifactUrl = resolveCatalogArtifactUrl(manifest, catalogBaseUrl);
  let response: Response;
  try {
    response = await fetcher(artifactUrl, { cache: 'no-store', credentials: 'same-origin' });
  } catch (cause) {
    throw new CatalogFailure('CATALOG_DOWNLOAD_FAILED', 'Der SQLite-Katalog konnte nicht geladen werden.', {
      operation: 'download',
      activeSlot,
      catalogVersion: manifest.catalogVersion,
      cause,
      details: { filename: manifest.filename }
    });
  }
  if (!response.ok) {
    throw new CatalogFailure('CATALOG_DOWNLOAD_FAILED', `SQLite-Katalog nicht erreichbar (HTTP ${response.status}).`, {
      operation: 'download',
      activeSlot,
      catalogVersion: manifest.catalogVersion,
      details: { filename: manifest.filename, status: response.status }
    });
  }
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null && Number(declaredLength) !== manifest.sizeBytes) {
    throw new CatalogFailure('CATALOG_SIZE_MISMATCH', 'Die HTTP-Länge des SQLite-Katalogs passt nicht zum Manifest.', {
      operation: 'download',
      activeSlot,
      catalogVersion: manifest.catalogVersion,
      details: { expectedBytes: manifest.sizeBytes, responseBytes: Number(declaredLength) }
    });
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== manifest.sizeBytes) {
    throw new CatalogFailure('CATALOG_SIZE_MISMATCH', 'Die Byte-Länge des SQLite-Katalogs passt nicht zum Manifest.', {
      operation: 'download',
      activeSlot,
      catalogVersion: manifest.catalogVersion,
      details: { expectedBytes: manifest.sizeBytes, actualBytes: bytes.byteLength }
    });
  }
  const actualHash = await sha256Hex(bytes);
  if (actualHash !== manifest.sha256.toLowerCase()) {
    throw new CatalogFailure('CATALOG_HASH_MISMATCH', 'Die SHA-256-Prüfung des SQLite-Katalogs ist fehlgeschlagen.', {
      operation: 'download',
      activeSlot,
      catalogVersion: manifest.catalogVersion,
      details: { expectedSha256: manifest.sha256, actualSha256: actualHash }
    });
  }
  return bytes;
}

export class CatalogInstaller {
  private readonly now: () => string;

  constructor(private readonly dependencies: CatalogInstallerDependencies) {
    this.now = dependencies.now ?? (() => new Date().toISOString());
  }

  async initialize(manifestUrl: string, catalogBaseUrl: string): Promise<CatalogOpenResult> {
    const activation = await this.dependencies.activations.readActivationRecord();
    if (!activation) return this.installUpdate(manifestUrl, catalogBaseUrl);
    return this.openPersistedActivation(activation);
  }

  async installUpdate(manifestUrl: string, catalogBaseUrl: string): Promise<CatalogOpenResult> {
    const current = await this.dependencies.activations.readActivationRecord();
    const activeSlot = current?.activeSlot ?? null;
    let manifest: CatalogManifest;
    try {
      manifest = await fetchCatalogManifestWith(this.dependencies.fetch, manifestUrl);
    } catch (error) {
      throw toCatalogFailure(error, 'CATALOG_MANIFEST_UNAVAILABLE', 'Das Produktions-Katalogmanifest ist nicht verfügbar.', {
        operation: 'manifest',
        activeSlot,
        catalogVersion: current?.catalogVersion ?? null
      });
    }

    if (current && current.sha256 === manifest.sha256 && current.catalogVersion === manifest.catalogVersion) {
      return this.openPersistedActivation(current);
    }

    const targetSlot = inactiveSlot(activeSlot);
    const bytes = await downloadCatalog(this.dependencies.fetch, manifest, catalogBaseUrl, activeSlot);
    let validationDatabase: CatalogDatabase | null = null;
    let runtimeDatabase: CatalogDatabase | null = null;
    try {
      await this.dependencies.storage.removeSlot(targetSlot);
      await this.dependencies.storage.importSlot(targetSlot, bytes);
      validationDatabase = this.dependencies.storage.openSlot(targetSlot);
      const validated = validateCatalogDatabase(validationDatabase, {
        slot: targetSlot,
        activeSlot,
        catalogVersion: manifest.catalogVersion,
        manifest
      });
      validationDatabase.close();
      validationDatabase = null;

      // Reopen the completely validated candidate before changing the sole active
      // pointer. This proves startup readiness while the previous slot is still
      // authoritative, including on a first install where no rollback slot exists.
      runtimeDatabase = this.dependencies.storage.openSlot(targetSlot);
      const nextRecord: CatalogActivationRecord = {
        activeSlot: targetSlot,
        catalogVersion: manifest.catalogVersion,
        sha256: manifest.sha256,
        validatedAt: this.now(),
        previousSlot: activeSlot
      };
      await this.dependencies.activations.activateValidatedSlot(nextRecord);

      return {
        database: runtimeDatabase,
        activation: nextRecord,
        productCount: validated.productCount,
        installedFromNetwork: true,
        diagnostics: null
      };
    } catch (error) {
      validationDatabase?.close();
      runtimeDatabase?.close();
      await this.removeFailedInactiveSlot(targetSlot);
      throw toCatalogFailure(error, 'CATALOG_IMPORT_FAILED', 'Der inaktive Katalogslot konnte nicht installiert werden.', {
        operation: 'install',
        activeSlot,
        attemptedSlot: targetSlot,
        catalogVersion: manifest.catalogVersion
      });
    }
  }

  private async openPersistedActivation(activation: CatalogActivationRecord): Promise<CatalogOpenResult> {
    let database: CatalogDatabase | null = null;
    try {
      if (!await this.dependencies.storage.hasSlot(activation.activeSlot)) {
        throw new CatalogFailure('CATALOG_OPEN_FAILED', 'Der aktive Katalogslot fehlt im OPFS.', {
          operation: 'open',
          activeSlot: activation.activeSlot,
          catalogVersion: activation.catalogVersion
        });
      }
      const bytes = await this.dependencies.storage.readSlot(activation.activeSlot);
      const actualHash = await sha256Hex(bytes);
      if (actualHash !== activation.sha256) {
        throw new CatalogFailure('CATALOG_HASH_MISMATCH', 'Der persistierte aktive Katalogslot hat eine ungültige SHA-256.', {
          operation: 'open',
          activeSlot: activation.activeSlot,
          catalogVersion: activation.catalogVersion,
          details: { expectedSha256: activation.sha256, actualSha256: actualHash }
        });
      }
      database = this.dependencies.storage.openSlot(activation.activeSlot);
      const validated = validateCatalogDatabase(database, {
        slot: activation.activeSlot,
        activeSlot: activation.activeSlot,
        catalogVersion: activation.catalogVersion,
        manifest: null
      });
      return {
        database,
        activation,
        productCount: validated.productCount,
        installedFromNetwork: false,
        diagnostics: null
      };
    } catch (error) {
      database?.close();
      if (activation.previousSlot) {
        return this.rollbackAfterFailedStartup(activation, error);
      }
      throw toCatalogFailure(error, 'CATALOG_OPEN_FAILED', 'Der aktive Katalogslot konnte nicht geöffnet werden.', {
        operation: 'open',
        activeSlot: activation.activeSlot,
        catalogVersion: activation.catalogVersion
      });
    }
  }

  private async rollbackAfterFailedStartup(
    failedActivation: CatalogActivationRecord,
    cause: unknown
  ): Promise<CatalogOpenResult> {
    const rollbackSlot = failedActivation.previousSlot;
    if (!rollbackSlot || !await this.dependencies.storage.hasSlot(rollbackSlot)) {
      throw toCatalogFailure(cause, 'CATALOG_OPEN_FAILED', 'Aktiver und vorheriger Katalogslot sind nicht verfügbar.', {
        operation: 'rollback',
        activeSlot: failedActivation.activeSlot,
        attemptedSlot: rollbackSlot,
        catalogVersion: failedActivation.catalogVersion
      });
    }
    let database: CatalogDatabase | null = null;
    try {
      const bytes = await this.dependencies.storage.readSlot(rollbackSlot);
      const rollbackHash = await sha256Hex(bytes);
      database = this.dependencies.storage.openSlot(rollbackSlot);
      const validated = validateCatalogDatabase(database, {
        slot: rollbackSlot,
        activeSlot: failedActivation.activeSlot,
        catalogVersion: failedActivation.catalogVersion,
        manifest: null
      });
      const rollbackRecord: CatalogActivationRecord = {
        activeSlot: rollbackSlot,
        // The exact activation-record contract carries no previous catalog version.
        // The file is fully revalidated and its hash is reconstructed here; the
        // version label remains the last authoritative manifest label.
        catalogVersion: failedActivation.catalogVersion,
        sha256: rollbackHash,
        validatedAt: this.now(),
        previousSlot: null
      };
      await this.dependencies.activations.activateValidatedSlot(rollbackRecord);
      await this.dependencies.storage.removeSlot(failedActivation.activeSlot);
      await this.dependencies.activations.clearInactiveSlotMetadata(failedActivation.activeSlot);
      const rollbackFailure = new CatalogFailure('CATALOG_OPEN_FAILED', 'Der aktive Katalogslot war ungültig; der vorherige validierte Slot wurde wiederhergestellt.', {
        operation: 'rollback',
        activeSlot: rollbackSlot,
        attemptedSlot: failedActivation.activeSlot,
        catalogVersion: rollbackRecord.catalogVersion,
        cause,
        details: { reconstructedSha256: rollbackHash }
      });
      return {
        database,
        activation: rollbackRecord,
        productCount: validated.productCount,
        installedFromNetwork: false,
        diagnostics: rollbackFailure.diagnostics
      };
    } catch (rollbackError) {
      database?.close();
      throw toCatalogFailure(rollbackError, 'CATALOG_OPEN_FAILED', 'Der vorherige Katalogslot konnte nicht wiederhergestellt werden.', {
        operation: 'rollback',
        activeSlot: failedActivation.activeSlot,
        attemptedSlot: rollbackSlot,
        catalogVersion: failedActivation.catalogVersion
      });
    }
  }

  private async removeFailedInactiveSlot(slot: CatalogSlotId): Promise<void> {
    try {
      await this.dependencies.storage.removeSlot(slot);
    } finally {
      await this.dependencies.activations.clearInactiveSlotMetadata(slot);
    }
  }
}

async function fetchCatalogManifestWith(
  fetcher: typeof fetch,
  url: string
): Promise<CatalogManifest> {
  const originalFetch = globalThis.fetch;
  if (fetcher === originalFetch) return fetchCatalogManifest(url);
  const response = await fetcher(url, { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) {
    throw new CatalogFailure('CATALOG_MANIFEST_UNAVAILABLE', `Katalogmanifest nicht erreichbar (HTTP ${response.status}).`, {
      operation: 'manifest',
      details: { status: response.status }
    });
  }
  const { parseCatalogManifest } = await import('./catalogManifest');
  return parseCatalogManifest(await response.json());
}

export function catalogSlotFilename(slot: CatalogSlotId): string {
  return CATALOG_SLOT_FILES[slot];
}
