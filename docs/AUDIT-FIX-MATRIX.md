# P0–P2 Audit-/Fix-Matrix

Stand: 2026-07-12. Diese Matrix beschreibt den produktiven Stand nach der Repository-, Contract-, UX- und Upstream-API-Prüfung. `geschlossen` bedeutet: im Produktionscode umgesetzt und durch passende Contract-, Unit-, Build-, Browser- oder Runtime-Evidenz abgedeckt. Externe Inbetriebnahmen sind separat aufgeführt.

## Geschlossene Findings

| Prio | Finding / Sollzustand | Status | Evidenz |
|---|---|---|---|
| P0 | OFF v3.6 `nutrition.aggregated_set` und v2 in ein stabiles internes DTO abbilden | geschlossen | `server/gateway-core/adapters/`; Fixture- und Handler-Tests für 100 g, 100 ml, serving, prepared und ungültige Werte |
| P0 | Produktstatus, Fehler und Metadaten vor der Browserausgabe normalisieren | geschlossen | generierte Zod-Schemas und Gateway-Handlertests |
| P0 | Eine gemeinsame, runtime-neutrale Gateway-Core ohne Orchestrierungsduplikate | geschlossen | `server/gateway-core/`; ein Express-Produktionsadapter in `server/index.mjs` |
| P0 | Browser greift ausschließlich über den versionierten Gateway-Client zu | geschlossen | `/api/v1`, generierter Client, Pages-/Release-Gates gegen direkte OFF-, Search-a-licious- und OpenAI-Aufrufe |
| P0 | Sichtbare Loading-, Empty-, Error-, Offline-, Rate-limit- und Konfigurationszustände | geschlossen | typisierte Search-State-Machine und Cross-Browser-E2E |
| P0 | Sofortiger Retry statt lokaler künstlicher Cooldowns | geschlossen | Contract-Invariante und UI-/API-Tests |
| P0 | Eigener Search-a-licious/OFF-Export-Index ist Primärpfad; OFF Legacy nur Reserve | geschlossen | `SEARCH_INDEX_URL`, `compose.production.yml`, Modus- und Fallbacktests |
| P0 | Verteilter Cache, Single-Flight, Limiter, Circuits und absolute Deadline | geschlossen | Redis-getrennte Cache-/Koordinationsrollen, Fake-Timer-, Fehler- und Health-Tests |
| P0 | OFF-Read-Requests ohne Login, Cookie oder Browser-Secret | geschlossen | Gateway-Core und Secret-/Pages-Gates |
| P0 | Versionierter Health-/Deployment-Contract | geschlossen | generiertes `HealthResponse` und Live-Container-Health |
| P0 | Stale ZIPs, Hotfix-Patches und doppelte Release-Skripte nicht mehr deployen | geschlossen | bereinigter Releasebaum und plattformneutrale Node-Gates |
| P0 | Manuelle Mengen in g/ml nur endlich und größer null; sichere Nährwertauflösung | geschlossen | `manual`, `nutrition`, `resolver` und Grenzwerttests |
| P1 | OpenAPI 3.1 bildet Suche, Produkt, AI und Fehler deckungsgleich ab | geschlossen | kanonischer Contract, Drift-Gate, generierter Client/Server-Schemas/Mocks |
| P1 | `product_api=v3` ist strikt; `hybrid` darf kontrolliert auf v2 fallen | geschlossen | v3/v2 Adapter- und Handlertests |
| P1 | Such- und Produktstrategie sind getrennt typisiert | geschlossen | `SearchApiMode` und `ProductApiMode` |
| P1 | Cache-Alter, Quelle, Layer, Key und Fetch-Zeit bleiben wahrheitsgetreu | geschlossen | Cache-/Single-Flight-Tests und produktive `api_meta` |
| P1 | Lucene-Eingabe, Barcode-Normalisierung und Backend-URLs sind abgesichert | geschlossen | Query-Builder-, Barcode- und SSRF-/Redirect-Tests |
| P1 | Versionierte lokale Repositories mit Memory → IndexedDB → kontrolliertem Fallback | geschlossen | Wire→Domain-Validierung, Migration, Korruption, Quota, Tombstones und Mehrschlüsseltests |
| P1 | Persistenzfehler verändern ein berechnetes Ergebnis nicht | geschlossen | Unit-/Browser-Fehlertests |
| P1 | Verlauf, Kalibrierung und API-Offlinedaten haben getrennte Privacy-Opt-ins und Limits | geschlossen | Settings-, Storage- und Offline-Tests |
| P1 | Root-Recovery, Browser-History, Fokus, Scroll und zugängliche Busy-/Ergebniszustände | geschlossen | Error Boundary und Playwright/Axe-Suite |
| P1 | OFF-Attribution, Quelle, Datenalter und Safety-Hinweis sind sichtbar | geschlossen | Ergebnis-UI und Attributionstests |
| P2 | Progressive Browsermatrix, Mobile-/Touch-Layouts und reduzierte Bewegung | geschlossen | Chromium/Android, Firefox und WebKit/iPhone-Projekte; CSS-Baseline und Fallback-Hinweis |
| P2 | PWA App-Shell, kontrolliertes Offline-Caching und Update-Prompt | geschlossen | Workbox-Konfiguration und PWA-E2E |
| P2 | Bundle-, Contract-, Secret-, Dependency- und Container-Sicherheitsgates | geschlossen | `npm run check`, `npm audit`, Gitleaks und Trivy |
| P2 | Vendor-neutrales Deployment ohne Vercel-Abhängigkeit | geschlossen | distroless Express-Container, Compose und statischer Pages-Build; Vercel-Adapter/-Config entfernt |

## Noch offene Betriebs- und Abnahmeaufgaben

Diese Punkte benötigen keine weitere Vercel- oder Browser-Runtime-Architektur, müssen aber vor einem echten Produktions-Rollout in der Zielumgebung erledigt werden:

1. Den vollständigen OFF-Export in den eigenen Search-a-licious-Cluster importieren, den inkrementellen Updater aktivieren und Importdauer, Datenalter sowie Speicherbedarf messen.
2. In Staging eine echte `search_api=search-index`-Suche, einen kontrollierten Index-/Redis-Ausfall und mindestens zwei parallele Gateway-Instanzen testen. Die lokalen Preflight-, Unit- und Einzelinstanz-Runtime-Gates ersetzen diesen Betriebsnachweis nicht.
3. Produktionswerte für `OFF_USER_AGENT`, `OFF_CONTACT_EMAIL`, `GATEWAY_CLIENT_SALT`, TLS/Reverse-Proxy, `CORS_ORIGINS`, Redis-Persistenz/Backups und optional `OPENAI_API_KEY` sicher bereitstellen.
4. Den optionalen AI-Pfad mit einem echten Produktions-Key gegen Budget-, Kosten-, 429- und Schemafehler testen; ohne Key bleibt der lokale Parser bewusst funktionsfähig.
5. Externes Monitoring/Alerting für `/api/v1/health`, Suchlatenz, Circuit-Zustände, 429/5xx und Indexalter an den gewählten Hoster anbinden.
6. Reale Geräte-Smoke-Tests auf den offiziell unterstützten Mindestversionen durchführen. Noch ältere oder exotische Browser erhalten eine Fallback-Meldung; eine Garantie für buchstäblich jeden historischen Browser ist technisch nicht seriös.
7. Für ARM64 muss gegebenenfalls ein eigener, commit-gepinnter Search-a-licious-Imagebuild veröffentlicht werden; das aktuell geprüfte Upstream-API-Image ist amd64-spezifisch.

## Reproduzierbare Abnahme

```sh
npm ci
npm run api:check
npm run check
npm run test:e2e
npm run audit
npm audit --omit=dev --audit-level=moderate --prefix deploy/runtime
docker compose config
docker build -t kh-checker-gateway .
trivy image --scanners vuln --severity HIGH,CRITICAL --exit-code 1 kh-checker-gateway
DATA_GATEWAY_URL=https://<staging-gateway> npm run check:gateway
```

Für den produktiven Search-Index kommen `npm run check:search-index`, der vollständige Import, eine reale Indexsuche und die Ausfalltests aus Punkt 2 hinzu.
