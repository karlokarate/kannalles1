# P0–P2 Audit-/Fix-Matrix

Stand: 2026-07-13. Diese Matrix beschreibt den produktiven Dual-Lane-Stand nach der Repository-, Contract-, UX- und Upstream-API-Prüfung. `geschlossen` bedeutet: im Produktionscode umgesetzt und durch passende Contract-, Unit-, Build-, Browser- oder Runtime-Evidenz abgedeckt. Externe Inbetriebnahmen sind separat aufgeführt.

## Geschlossene Findings

| Prio | Finding / Sollzustand | Status | Evidenz |
|---|---|---|---|
| P0 | OFF v3.6 `nutrition.aggregated_set` und v2 in ein stabiles internes DTO abbilden | geschlossen | gemeinsamer `server/gateway-core/off-adapters.mjs`; Fixture-, Direct-Client- und Gatewaytests |
| P0 | Produktstatus, Fehler und Metadaten vor der Browserausgabe normalisieren | geschlossen | gemeinsamer Projektionsadapter sowie typisierte Direct-/Gateway-Grenzen |
| P0 | Eine gemeinsame, runtime-neutrale Gateway-Core ohne Orchestrierungsduplikate | geschlossen | `server/gateway-core/`; ein Express-Produktionsadapter in `server/index.mjs` |
| P0 | Direkte Pages-Lane und autoritative Gateway-Lane ohne Mischfallback | geschlossen | Runtime-Auswahl über leere/gesetzte Gateway-URL, Contract- und Clienttests |
| P0 | Sichtbare Loading-, Empty-, Error-, Offline-, Rate-limit- und Konfigurationszustände | geschlossen | typisierte Search-State-Machine und Cross-Browser-E2E |
| P0 | Sofortiger Retry statt lokaler künstlicher Cooldowns | geschlossen | Contract-Invariante und UI-/API-Tests |
| P0 | Search-a-licious direkt primär; OFF Legacy genau einmal als Reserve | geschlossen | echte CORS-Prüfung, Direct-Client- und Fallbacktests |
| P0 | Cache, Single-Flight und begrenzte Deadlines in beiden Lanes | geschlossen | Browsercache/-Deduplizierung sowie optionale Redis-Gatewaykoordination |
| P0 | Optionales persönliches OFF-Konto ohne Gateway: Loginprüfung, lokale Persistenz und Nutzung nur an OFF | geschlossen | Settings-UX, offizieller `/cgi/auth.pl`-POST, Direct-Client-/Redaktionstests und eigener Core-Vertrag |
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
| P1 | Verlauf, Kalibrierung, API-Offlinedaten und optionale OFF-Zugangsdaten haben transparente lokale Lebenszyklen | geschlossen | Settings-, Storage-, Auth- und Offline-Tests |
| P1 | Root-Recovery, Browser-History, Fokus, Scroll und zugängliche Busy-/Ergebniszustände | geschlossen | Error Boundary und Playwright/Axe-Suite |
| P1 | OFF-Attribution, Quelle, Datenalter und Safety-Hinweis sind sichtbar | geschlossen | Ergebnis-UI und Attributionstests |
| P2 | Progressive Browsermatrix, Mobile-/Touch-Layouts und reduzierte Bewegung | geschlossen | Chromium/Android, Firefox und WebKit/iPhone-Projekte; CSS-Baseline und Fallback-Hinweis |
| P2 | PWA App-Shell, kontrolliertes Offline-Caching und Update-Prompt | geschlossen | Workbox-Konfiguration und PWA-E2E |
| P2 | Bundle-, Contract-, Secret-, Dependency- und Container-Sicherheitsgates | geschlossen | `npm run check`, `npm audit`, Gitleaks und Trivy |
| P2 | Direkte Pages-Produktion ohne Vercel, vorbereitete Gateway-Ausweichlane | geschlossen | schlanker Pages-Build, optionaler Express-Core und dokumentierte Vercel-Umschaltkriterien |

## Noch offene Betriebs- und Abnahmeaufgaben

Diese Punkte bleiben als laufende Betriebsbeobachtung beziehungsweise als bedingte Lane-B-Aufgaben offen:

1. Lane A regelmäßig auf realem Android/Chromium, iOS/WebKit und Firefox gegen CORS, 429 und 5xx prüfen; einzelne temporäre Upstream-5xx sind kein Architekturfehler.
2. OFF verlangt für identifizierbare Apps einen eigenen `User-Agent`, den Browser-JavaScript nicht setzen darf. Beobachten, ob OFF direkte Browserzugriffe künftig deswegen ablehnt.
3. Wenn eines der Kriterien aus `docs/DECISION-DUAL-API-LANES.md` reproduzierbar eintritt, dünne Vercel-Routen auf den bestehenden Core setzen, `DATA_GATEWAY_URL` aktivieren und Lane A vollständig abschalten.
4. Den optionalen AI-Pfad erst in Lane B mit Produktions-Key, Salt, Redis-Budgets, Kosten-, 429- und Schemafehlern abnehmen; ohne Gateway bleibt der lokale Parser Standard.
5. Eine Garantie für buchstäblich jeden historischen Browser ist technisch nicht seriös; Browser unterhalb der dokumentierten Mindestbaseline erhalten den statischen Fallback.

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

Die Container-/Gateway-Kommandos sind nur für Lane B erforderlich. Lane A benötigt keinen OFF-Export und keinen Search-Index-Import.
