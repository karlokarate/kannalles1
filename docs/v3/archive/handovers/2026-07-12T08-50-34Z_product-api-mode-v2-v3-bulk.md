# Handover: Product API Mode v2/v3/hybrid + Gateway Routing (2026-07-12T08:50:34Z)

```json
{
  "task": "product-api-mode-v2-v3-bulk",
  "status": "completed",
  "request": "Settings switch for v2/v3 usage, correct v2 gateway configuration, and doc-conform optimized bulk/fallback behavior.",
  "behavior": {
    "new_setting": "productApiMode in App settings with values hybrid|v3|v2",
    "default": "hybrid",
    "client_propagation": "productApiMode is passed from UI to getProductByBarcode/getSearchDocumentByBarcode and appended as product_api query for gateway product calls",
    "gateway_product_mode": {
      "hybrid": "v3 primary, v2 fallback only when needed",
      "v3": "v3 only",
      "v2": "v2 only"
    },
    "bulk_optimization": [
      "mode-aware product cache key prevents cross-mode cache pollution",
      "known_carbs/seed data in hybrid mode avoids redundant v2 follow-up requests",
      "explicit v2/v3 mode avoids unnecessary second upstream call"
    ]
  },
  "changed_files": [
    "src/types.ts",
    "src/App.tsx",
    "src/lib/api.ts",
    "src/lib/api.test.ts",
    "api/product/[code].js",
    "api/_lib/gateway.js",
    "server/index.mjs",
    "README.md",
    "docs/ARCHITECTURE.md",
    ".codex/task-ledgers/2026-07-12_product-api-mode-v2-v3-bulk.ipynb"
  ],
  "validation": [
    {
      "command": "npm --prefix /workspaces/kannalles1 run typecheck",
      "result": "pass"
    },
    {
      "command": "npm --prefix /workspaces/kannalles1 run -s test -- src/lib/api.test.ts",
      "result": "pass",
      "tests": 85
    }
  ],
  "notes": [
    "Repository does not contain scripts/v3/validate_codex_task_notebook_ledger.py, so ledger contract validation script could not be executed.",
    "Existing quality warnings unrelated to this task remain in files touched previously."
  ]
}
```
