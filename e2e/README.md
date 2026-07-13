# Real catalog browser contract

These tests exercise the built PWA, the production SQLite file named by `Catalog/catalog-manifest.v1.json`, the shipped SQLite-WASM module and the OPFS SAH-pool. They never replace `catalogClient`, the worker or SQLite with a mock. The rollback case only corrupts the same-origin manifest and manifest-declared database transport after a valid slot has been installed, so validation and rollback still execute in production code.

The retained non-API coverage verifies the app shell, accessible navigation, mobile reflow, WCAG A/AA smoke checks, deterministic manual calculation and the local BLS generic-reference path. Gateway, OFF-account and mocked product-API journeys are intentionally absent.

The UI exposes semantic, read-only test attributes. They are also useful for accessible diagnostics and must not change product behavior:

- `catalog-status`: `data-state`, `data-catalog-version`, `data-product-count`, `data-persistent`, `data-installed-from-network`, `data-active-slot`
- `catalog-search-input`, `catalog-search-submit`, `catalog-search-results`
- each `catalog-search-result`: `data-rank-ordinal`
- `catalog-product`: `data-gtin`, `data-amount`, `data-carbs-per-100-g`
- `catalog-unit-select`; each option: `data-unit-kind`, `data-unit-weight-g`, `data-unit-provenance`
- `catalog-calculation`: `data-total-carbs-g` with full internal precision
- `catalog-issue`: `data-error-code`

The browser matrix is intentionally serial because an OPFS SAH-pool with the same directory name cannot be active concurrently in multiple browsing contexts on one origin. Browser support is claimed only after the required Playwright projects pass against the integrated production build.
