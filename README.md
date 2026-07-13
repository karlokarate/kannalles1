# FishIT KH Checker v2.3.1

FishIT KH Checker ist eine installierbare, offlinefähige Web-App zur nachvollziehbaren Kohlenhydratberechnung. Produktsuche und Nährwerte kommen aus dem versionierten SQLite-Katalog im Repository. Die App lädt weder Suchergebnisse noch Produktdetails über eine API oder ein Gateway.

## Produktionspfad

```text
Catalog/kh-checker-dach-v1.sqlite
  → SHA-256-, Größen-, Schema- und Metadatenprüfung
  → A/B-Slots im Origin Private File System (OPFS)
  → SQLite-WASM in einem Web Worker
  → Suche → Produktauswahl → deterministische Berechnung
```

Der Katalog umfasst 317.579 Produkte und 60.682 Marken. Manifest, Codecs, Bildschlüssel und Datenbank werden als eine atomare Version ausgeliefert. Ein fehlgeschlagenes Update überschreibt nicht den letzten verifizierten Slot.

## Lokal entwickeln

Voraussetzungen: Node.js 22.18 oder neuer und Python 3 für die Katalogprüfung.

```bash
npm ci
npm run check:catalog
npm run dev
```

Produktionsbuild und statischer lokaler Start:

```bash
npm run build
node scripts/serve-static.mjs dist
```

Der erste Katalogstart benötigt einen sicheren Browserkontext. `localhost` gilt lokal als sicher; das veröffentlichte Artefakt läuft über HTTPS.

Der integrierte Katalogpfad ist für aktuelle Chromium-Browser (einschließlich Android) und Firefox nachgewiesen. WebKit/iPhone wird solange ausdrücklich als nicht unterstützt gemeldet, wie `FileSystemSyncAccessHandle` fehlt; die manuelle Berechnung bleibt erreichbar.

## Qualitätssicherung

```bash
npm run check          # statische Gates, Unit-/Contracttests und Build
npm run test:e2e       # echte SQLite-WASM-/OPFS-Browserjourneys
npm run audit          # Dependency-Audit
npm run check:all      # vollständiges lokales Release-Gate
```

Die Browserjourneys dürfen Produktnetzwerkzugriffe nicht mocken. Sie prüfen den echten 25-MB-Katalog, Suche, Auswahl, Berechnung, persistente A/B-Slots und einen Reload ohne Netzwerk.

## Deployment

`.github/workflows/build-deploy-pages.yml` baut und prüft das manifestgesteuerte Artefakt. Der Deploy-Job startet erst, wenn sowohl die Qualitäts- als auch die echten Browsergates grün sind. Die Zielplattform ist GitHub Pages; ein App-Server ist nicht erforderlich.

## Datenschutz und Sicherheit

- Suchbegriffe, Mengen, Verlauf, Favoriten und eigene Einträge bleiben lokal.
- Der Produktkatalog wird nur von derselben HTTPS-Origin geladen und vor Aktivierung kryptografisch geprüft.
- Produktbilder können optional vom in den Katalogdaten referenzierten Open-Food-Facts-Bildhost geladen und gecacht werden; Suche und Berechnung funktionieren ohne sie.
- Katalog- und Etikettendaten können falsch sein. Ergebnisse nicht ungeprüft für Therapie- oder Insulindosierungsentscheidungen verwenden.

Die verbindliche Runtime-Architektur steht in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), der Konsolidierungsstand in [docs/AUDIT-FIX-MATRIX.md](docs/AUDIT-FIX-MATRIX.md).
