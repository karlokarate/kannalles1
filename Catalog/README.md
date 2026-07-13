# KH Checker offline catalog artifacts

The browser runtime consumes a generated catalog contract. Do not upload only the SQLite file for production.

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

`catalog-runtime.generated.ts`, `catalog-codecs.v1.json`, and `catalog-image-keys.v2.json` are generated single sources of truth. Application code must not duplicate barcode, metadata, unit, popularity, image-key, or column codecs.

`catalog-manifest.v1.json` identifies the active artifact, byte size, SHA-256, SQLite `application_id`, SQLite `user_version`, schema/codec versions, and product count. The browser verifies these before activating a downloaded database.

## Benchmark proof

`kh-checker-dach.sqlite` and `manifest.json` are temporary browser-proof inputs. They must not be published as the final production catalog once the production-v1 files are uploaded.

## Deploy layout

The build copies only browser-required files to:

```text
dist/catalog/
  kh-checker-dach-v1.sqlite
  catalog-manifest.v1.json
  catalog-codecs.v1.json
  catalog-image-keys.v2.json
```

Build reports, the production contract, and `SHA256SUMS.txt` remain repository/CI evidence and are not downloaded by the app during normal use.
