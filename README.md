# KH Checker v2.2.4

KH Checker ist eine installierbare, statische Progressive Web App für iPhone, iPad, Android, Windows, macOS und Linux. GitHub Pages veröffentlicht ausschließlich die fertigen Web-Dateien. Produktsuche, Cache, Produktauflösung, Kalibrierung und Kohlenhydratberechnung laufen auf dem Endgerät. Netzwerkzugriffe auf Open Food Facts laufen verpflichtend über ein serverloses Vercel-Gateway.

## Was v2.2.4 ändert

v2.2.4 übernimmt v2.2.3 als Funktionsbaseline und ersetzt den fehleranfälligen Repo-Selbstintegrationsweg durch einen One-Click-Releasepfad:

```text
contracts/source/search-api.contract.mjs
  Hono + Zod OpenAPI
            ↓
OpenAPI 3.1 JSON/YAML
            ↓
Orval 8.20.0
  ├─ Fetch-Client und URL-Builder
  ├─ TypeScript-Modelle
  ├─ Zod-Laufzeitvalidatoren
  └─ MSW-/Faker-Mocks
            ↓
Redocly 2.38.0
  ├─ Contract-Lint
  └─ statische API-Dokumentation
            ↓
Vitest + TypeScript + Biome + Playwright + axe
            ↓
Vite/PWA-App-only-ZIP
            ↓
GitHub Pages
```

Die Generatoren ersetzen Transport-Boilerplate, Typen, Query-/Pfad-Builder, Validatoren, Mocks und Dokumentation. Die projektspezifische Fachlogik bleibt bewusst handgeschrieben und getestet: Fresh-/Stale-Cache, In-Flight-Deduplizierung, höchstens zwei Suchbackends, sofortiger Retry, Produktdetail-Hydrierung, Ranking, Einheitenauflösung, Kalibrierung, Provenance und KH-Berechnung.

## Autoritative Generatorquelle

Die einzige Generatorquelle für das Gateway ist:

```text
contracts/source/search-api.contract.mjs
```

Sie enthält Hono-Routen und Zod-Schemas für:

- `GET /api/health`
- `GET /api/search`
- `GET /api/product/{code}`
- `POST /api/ai/parse`

`npm run api:generate` erzeugt deterministisch:

```text
contracts/generated/search-api.openapi.json
contracts/generated/search-api.openapi.yaml
contracts/generated/generation-manifest.json
src/generated/gateway/client.ts
src/generated/gateway/client.msw.ts
src/generated/gateway/client.faker.ts
src/generated/gateway.zod.ts
src/generated/models/
src/generated/search-api/
server/generated/
generated-tests/
docs/api/index.html
contracts/generated/search-api.generated.test.ts
```

`npm run api:check` regeneriert alles und schlägt bei Drift fehl. `npm run api:verify` prüft die OpenAPI-Datei sowie SHA-256 aller Generatorquellen und -ergebnisse.

## Laufzeitarchitektur

```text
GitHub Pages
└── statische PWA
    ├── Service Worker und App-Shell-Cache
    ├── IndexedDB/localStorage/Memory-Fallback
    ├── lokale Such-, Ranking-, Einheiten- und Berechnungslogik
  └── Gateway-only API-Zugriff
    └── https://<gateway>.vercel.app/api
      ├── Search-a-licious als Primärsuche
      ├── OFF Legacy Search als genau ein Fallback
      ├── OFF API v3.6 für das ausgewählte Produkt
      └── OFF API v2 nur bei weiterhin fehlenden Daten
```

Die Pages-PWA darf keine direkten Browseraufrufe zu Open Food Facts mehr ausführen. `VITE_DATA_GATEWAY_URL` ist daher im Build zwingend und muss auf den laufenden Vercel-Dienst zeigen. Gateway-Antworten werden im Browser und im optionalen Express-Server gegen den generierten Zod-Vertrag geprüft.

## Vercel-Gateway Setup

Der Workspace enthält serverlose Endpunkte unter `api/` für Vercel:

- `GET /api/health`
- `GET /api/search`
- `GET /api/product/{code}`

Die Upstream-Requests setzen die für OFF erforderliche Identität:

- `User-Agent: $OFF_USER_AGENT`
- `From: $OFF_CONTACT_EMAIL` (wenn gesetzt)

Erforderliche Vercel-Umgebungsvariablen:

- `OFF_USER_AGENT`
- `OFF_CONTACT_EMAIL`
- `CORS_ORIGINS` (kommagetrennte Origins, optional)

Für den Pages-Build muss zusätzlich im GitHub-Repository gesetzt sein:

- `VITE_DATA_GATEWAY_URL=https://<dein-gateway>.vercel.app`

## One-Click-Deployment

Das Lieferpaket enthält ein direkt kopierbares `repo-overlay/`. Dessen Inhalt wird einmal in den Repository-Stamm übernommen. Alternativ erledigt `install-into-repo.sh` diesen lokalen Kopiervorgang.

Vor dem Commit müssen die drei alten beziehungsweise konkurrierenden Workflows entfernt sein:

```text
.github/workflows/deploy-pages.yml
.github/workflows/build-deploy-pages-v2.2.3.yml
.github/workflows/unpack-kh-checker-repo-integration.yml
```

Danach darf nur noch dieser Workflow existieren:

```text
.github/workflows/build-deploy-pages.yml
```

Der alte Entpack-Workflow wird absichtlich nicht mehr verwendet. Er scheiterte daran, dass ein GitHub-App-Token ohne spezielle `workflows`-Berechtigung keine Workflow-Datei pushen darf. v2.2.4 installiert deshalb keinen Workflow aus einem Workflow heraus.

Nach dem direkten Kopieren, Committen und Pushen:

1. **Actions → Build, validate and deploy KH Checker v2.2.4** öffnen.
2. **Run workflow** starten.
3. Es sind keine Eingaben und kein zweiter Folgeworkflow erforderlich.

Der Workflow arbeitet seriell und failsoft:

- Zuerst wird `releases/kh-checker-v2.2.4-komplett.zip` sicher entpackt und hart validiert.
- Danach werden mit `npm ci` die gelockten Abhängigkeiten installiert und alle Generatorartefakte neu erzeugt.
- Nur ein Kandidat mit bestandenen Generator-, Typ-, Lint-, Unit-/Contract-, Build-, Browser-, ZIP-, Pages- und HTTP-Gates ersetzt das vorvalidierte Fallback.
- Scheitern Registry, Generator, Audit, Build oder Browserinfrastruktur, bleibt die bereits geprüfte v2.2.4-PWA ausgewählt.
- Unsichere ZIPs, Checksummenlücken, Secrets, native/serverseitige Artefakte, ungültige Pages-Pfade und der finale Pages-Deploy bleiben harte Fehler.
- Der Workflow besitzt kein `contents: write`, führt weder `git commit` noch `git push` aus und mutiert das Repository nicht.

## Release-Artefakte

`npm run release` erzeugt getrennt:

```text
release-out/kh-checker-v2.2.4-komplett.zip
release-out/ENTWICKLER-QUELLCODE-v2.2.4.zip
```

Das Komplett-ZIP enthält nur die deploybare PWA, Prüfnachweise, OpenAPI-Dateien und statische API-Dokumentation. Es enthält weder Quellcode noch `node_modules`, JAR/AAR, Server-Runtime, Datenbank, globalen Produktdatensatz oder verschachtelte ZIPs. Das Quellcode-ZIP wird separat erzeugt.

Das äußere Lieferpaket enthält zusätzlich das Repository-Overlay, Installer, Anleitung, Validierungsbericht und beide Release-ZIPs. Der GitHub-Workflow veröffentlicht ausschließlich das final geprüfte Web-Verzeichnis.

## Lokale Entwicklung und Reproduktion

Voraussetzung ist **Node.js 22.18.0 oder neuer**; für neue lokale Installationen und CI wird Node.js 24 LTS empfohlen.

```bash
npm ci
npm run api:generate
npm run check
npm run audit
```

Vollständige Browsergates:

```bash
npm run test:e2e:install
PLAYWRIGHT_INCLUDE_WEBKIT=1 npm run test:e2e
```

Release:

```bash
npm run release
```

Wichtige Einzelprüfungen:

```bash
npm run api:verify
npm run api:check
npm run check:workflow
npm run typecheck
npm run lint
npm test
npm run check:server
npm run check:scripts
npm run build
npm run check:pages
npm run check:release
```

## Installation auf Geräten

### iPhone und iPad

Die GitHub-Pages-Seite in Safari öffnen, **Teilen** wählen und **Zum Home-Bildschirm** ausführen.

### Android

Die Pages-Seite in Chrome öffnen und **App installieren** beziehungsweise **Zum Startbildschirm hinzufügen** wählen.

### Desktop

Die Pages-Seite in einem PWA-fähigen Browser öffnen und das Installationssymbol verwenden. Safari auf macOS kann sie ebenfalls als Web-App hinzufügen.

Ein direktes Öffnen von `index.html` über `file://` ist kein Produktionsweg. Service Worker und PWA-Installation benötigen einen sicheren HTTP(S)-Kontext.

## Cache- und Fehlervertrag

| Daten | Frisch | Ausfallreserve |
|---|---:|---:|
| erfolgreiche Suche | 24 Stunden | 30 Tage |
| leere Suche | 15 Minuten | 24 Stunden |
| Produktdetails | 30 Tage | 180 Tage |

Der Service Worker cached App-Shell und Produktbilder. API-JSON wird durch den Request Manager verwaltet, damit Fresh-/Stale-Status und Diagnose eindeutig bleiben. Ein externer Ausfall erzeugt einen typisierten Zustand; er darf weder die UI abstürzen lassen noch einen lokalen Cooldown oder gesperrten Retry installieren.

## Einheiten und Berechnung

- Explizite Nutzereinheiten bleiben erhalten.
- Bewiesene Einzelgewichte stehen vor Portion und Packung.
- Ein Einzelgewicht darf aus expliziter Stückzahl und Nettogewicht abgeleitet werden.
- Ein unbekanntes zählbares Gewicht führt zur Einzel- oder Gruppenwägung statt zu einer Schätzung.
- Gespeichert wird das präzise Einheitengewicht mit Scope und Provenance.
- Kohlenhydrate werden immer mit dem aktuellen Wert pro 100 g beziehungsweise 100 ml neu berechnet.
- Intern wird vor dem Endergebnis nicht gerundet.

## Qualitätswerkzeuge

Integriert sind Redocly, Orval, Hono/Zod OpenAPI, TypeScript, Biome, Vitest, MSW, Faker, Playwright, axe-core, npm audit und ein eigener sicherer ZIP-/Pages-/HTTP-Validator. Dependabot ist gelockt vorkonfiguriert.

Sinnvolle nächste Ergänzungen sind Lighthouse CI für Performance/PWA-Regressionswerte, CodeQL für statische Sicherheitsanalyse und ein datenschutzgeprüftes Sentry-Setup für Produktionsfehler. Diese Werkzeuge sind nicht Voraussetzung für den v2.2.4-Deploy und sollten erst nach eigener Policy-Entscheidung aktiviert werden.

## Grenzen

Die App kann Open Food Facts oder das Gerätenetz nicht verfügbar machen. Ohne Netzwerk und ohne passenden Cache kann keine neue globale Produktsuche erfolgen. Das finale Artefakt ist eine installierbare PWA und keine nativ signierte Android-APK; eine APK würde einen separaten TWA-/Capacitor-, Signing- und Store-Prozess benötigen.
