# KH Checker offline catalog artifacts

The browser runtime consumes a generated catalog contract. The SQLite file alone is not a complete production input.

## Production files required in this directory

Runtime inputs:

- `kh-checker-dach-v1.sqlite`
- `catalog-manifest.v1.json`
- `catalog-codecs.v1.json`
- `catalog-image-keys.v2.json`
- `catalog-runtime.generated.ts`

Build and release evidence:

- `catalog-production.contract.v1.json`
- `catalog-build-report.v1.json`
- `catalog-build-report.v1.txt`
- `SHA256SUMS.txt`

The optional ZIP bundle is not stored in the repository. Upload the extracted files instead.

## Runtime authority

`catalog-runtime.generated.ts`, `catalog-codecs.v1.json`, and `catalog-image-keys.v2.json` are generated single sources of truth. Application code must not duplicate barcode, metadata, unit, popularity, image-key, search-order, or column codecs.

`catalog-manifest.v1.json` identifies the active artifact, byte size, SHA-256, SQLite `application_id`, SQLite `user_version`, schema/codec versions, source fingerprint, and product count. The browser verifies the file before activating it in OPFS.

`SHA256SUMS.txt` covers all generated production outputs except itself. CI rejects missing, additional, renamed, or modified generated files.

## Deploy layout

The source filenames retain their version. The static deployment exposes stable runtime URLs so the application code does not change for every catalog version:

```text
dist/catalog/
  kh-checker-dach.sqlite       # copied from kh-checker-dach-v1.sqlite
  manifest.json                # copied from catalog-manifest.v1.json
  catalog-codecs.v1.json
  catalog-image-keys.v2.json
```

`catalog-runtime.generated.ts` is compiled into the catalog worker. Build reports, the production contract, and `SHA256SUMS.txt` remain repository/CI evidence and are not downloaded during normal use.

## Update rule

A new catalog release must arrive as one complete generated set. The app compares catalog version and SHA-256, downloads a changed SQLite file, verifies size/hash/schema/identity/count, imports it into the versioned OPFS SAH pool, and only then opens it for read-only queries. Partial artifact updates are not supported.
