# Handover: E2E Gateway + A11y Hardening (2026-07-12T02:33:00Z)

## Scope

- Stabilized E2E flows under required gateway enforcement.
- Closed remaining accessibility contrast regressions in the start view.
- Fixed live gateway product contract mismatch for OFF `status` typing.
- Re-validated internal gates and real-server runtime behavior.

## Changed Files

- src/styles.css
- e2e/app.spec.ts
- .github/e2e/release.spec.ts
- playwright.config.ts
- server/index.mjs
- .codex/task-ledgers/2026-07-12_e2e-gateway-a11y-hardening.ipynb

## Validation Evidence

1. Internal full gate:

- Command: `npm --prefix /workspaces/kannalles1 run check`
- Result: PASS

1. Browser E2E suite:

- Command: `npm --prefix /workspaces/kannalles1 run test:e2e`
- Result: PASS (12/12)

1. Live real-server contract matrix (5 products):

- Runtime: local gateway server (`npm run start`) with OFF upstreams.
- Contract parsers: `SearchGatewayResponseSchema` and `ProductGatewayResponseSchema`.
- Command: `node /tmp/live_gateway_check.mjs`
- Result: PASS (5/5 products)
- Products validated: Nutella, Kinder Bueno, Coca Cola, Milka Alpenmilch, Barilla Spaghetti.

## Key Fixes

- E2E:
  - Scoped manual form selectors to remove `Einheit` label ambiguity.
  - Updated deterministic result expectation to current UX output (`40 g`).
  - Ensured gateway setup inside E2E before search execution.
  - Stabilized search retry scenario input (non-barcode text query).

- UX/A11y:
  - Improved contrast for inactive mode-switch text, voice/secondary button text, and active bottom-nav state.

- Gateway Runtime:
  - Normalized numeric OFF product `status` to string before `ProductGatewayResponseSchema.parse(...)` to maintain contract conformity and prevent 502 false negatives.

## Risks / Follow-ups

- Upstream OFF/Search-a-licious occasionally throttle (429/503). Retry/backoff already observed and handled in validation script; production behavior should continue to rely on cache/fallback paths.

## Push Status

- Ready to commit and push.
