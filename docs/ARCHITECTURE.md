# KH Checker v2.2.4 – Architektur

## Autoritäten

1. `package.json` ist die einzige Versionsquelle.
2. `contracts/source/search-api.contract.mjs` ist die einzige manuell gepflegte API-Vertragsquelle.
3. Die v2-Kernverträge bleiben normativ für Suche, Einheitenauflösung, Kalibrierung und Berechnung.
4. Generierte Verzeichnisse sind Buildprodukte und werden nicht manuell bearbeitet.
5. Das lokal erzeugte, vollständig validierte App-ZIP ist das Failsoft-Deployment-Fallback.

## Contract-driven Generation

```text
package.json + Hono/Zod route graph
  → OpenAPI 3.1 JSON/YAML
  → Redocly lint + HTML-Dokumentation
  → Orval Fetch + Models + Zod + MSW/Faker
  → stabile App-/Server-Adapter
  → generierte Vitest-Contract-Tests
  → Driftprüfung durch Neu-Generation und Hashvergleich
```

### Warum eine Hono/Zod-Quelle

Die Route, Query-, Path-, Body-, Response- und Fehler-Schemas werden einmal definiert. Dieselben Zod-Schemas dienen der Laufzeitvalidierung und der OpenAPI-Erzeugung. Orval übersetzt diese Beschreibung anschließend in browserkompatiblen TypeScript-Code. Das JAR-/AAR-Konzept ist für die Browserlaufzeit nicht erforderlich; Generatoren laufen ausschließlich als Entwicklungs-/CI-Werkzeuge.

### Generierte Bereiche

```text
contracts/generated/
src/generated/
server/generated/
generated-tests/
docs/api/
docs/generated/
```

Die Driftprüfung erzeugt diese Bereiche neu und vergleicht Datei-Hashes. Damit kann ein Contract-Change nicht versehentlich mit veraltetem Client, Validator oder Mock veröffentlicht werden.

## Trennung von Transport und Fachlogik

Generatorfähig:

- Request-/Response-Modelle
- Query- und Pfadaufbau
- Fetch-Operationen
- dokumentierte Statuscodes
- Zod-Laufzeitvalidierung
- MSW-/Faker-Mocks
- OpenAPI-Dokumentation
- grundlegende Contract-Tests

Bewusst handgeschrieben:

- Query-Kanonisierung
- Fresh-/Stale-Cache-Entscheidung
- In-Flight-Deduplizierung
- Search-a-licious/Legacy-Orchestrierung
- höchstens zwei Suchbackends
- Produkt-Selektion und bedingte Detail-Hydrierung
- Ranking, Provenance und Diagnose
- Einheitenauflösung, Kalibrierung und KH-Berechnung


## Statischer Produktionspfad

```text
GitHub Pages / HTTPS-Static-Host
  → relative App-Assets
  → Service Worker
  → lokale PWA-Laufzeit
  → direkte CORS-GETs zu Open Food Facts
```

Die App probt keinen `/api/health`-Endpunkt und erwartet keinen Same-Origin-Server. Nur eine ausdrücklich konfigurierte Gateway-URL ersetzt den direkten Suchtransport.

## Suchausführung

1. Eingabe bereinigen, begrenzen und kontrolliert korrigieren.
2. Kanonischen Query-Key vor Cache und Netzwerk bilden.
3. Fresh Canonical Cache verwenden.
4. Search-a-licious primär aufrufen.
5. OFF Legacy genau einmal bei technischem Fehler oder gültigem Nullresultat aufrufen.
6. Zwei erreichbare Nullresultate als typisierten Leerzustand behandeln.
7. Stale Cache nur offline oder nach Ausfall aller relevanten Backends verwenden.
8. Ohne Treffer/Reserve einen typisierten Zustand liefern; keine Roh-Exception in React.
9. Manuellen Retry nie durch lokalen Counter oder Cooldown blockieren.

Ein konfiguriertes Gateway ist für die Suche autoritativ. Der Browser startet danach keinen zusätzlichen öffentlichen Such-Fan-out.

## Request Manager

Jede konkrete GET-URL besitzt höchstens einen laufenden Netzwerktask. Mehrere Aufrufer abonnieren denselben Task. Das Abbrechen eines UI-Abonnenten beendet nicht automatisch einen Request, den ein anderer Aufrufer noch benötigt.

Jeder Versuch bewahrt Backend, URL, Start, Dauer, Outcome, Status, ursprünglichen Fehler, Antwortvorschau und `Retry-After`. `Retry-After` ist diagnostisch und installiert keinen lokalen Lock.

## Cache-Architektur

1. begrenzter Memory-Cache
2. kompakter `localStorage`-Spiegel
3. IndexedDB für URL-Caches und langlebige Snapshots

Writes aktualisieren Memory/Spiegel zuerst; IndexedDB folgt asynchron. Ein Generationsschutz verhindert verspätete Writes nach bewusstem Cache-Leeren. Stale-Daten behalten ihr ursprüngliches `fetchedAt` und werden nach fehlgeschlagenem Refresh nicht als frisch hochgestuft.

Gültigkeiten:

- erfolgreiche Suche: 24 Stunden frisch, 30 Tage Reserve
- leere Suche: 15 Minuten frisch, 24 Stunden Reserve
- Produkt: 30 Tage frisch, 180 Tage Reserve

## Produktdetails

1. Nur ausgewählter oder eindeutig bestimmter Barcode wird hydratisiert.
2. Suchtreffer dient als Seed.
3. OFF API v3.6 ist primär.
4. OFF API v2 wird nur bei weiterhin fehlenden Kohlenhydrat-/Kompatibilitätsfeldern verwendet.
5. Dokumente werden feldweise, Nutriments schlüsselweise zusammengeführt.
6. Erreichbare Antworten ohne Produkt werden als 404 klassifiziert.
7. Nützliche Teildaten bleiben bei transientem v2-Ausfall verwendbar.

## Einheiten- und Kalibrierungsvertrag

Priorität:

1. explizite Nutzer-Einheit
2. passende gespeicherte Nutzerkalibrierung
3. explizites Einzelgewicht
4. aus expliziter Anzahl und Nettogewicht abgeleitetes Einzelgewicht
5. Herstellerportion, Packungs- und Masseoptionen

Unzulässig sind stille Stück/Portion-Substitution, nackte `serving_quantity` als Stückgewicht, Verpackungsanzahl als essbare Stückzahl, typische Gewichtsschätzung und Packungsauswahl trotz kleinerer bewiesener Einheit.

Gruppenwägung verwendet `Gesamtgewicht / Anzahl` mit mindestens zwei Einheiten. Autoritativ gespeichert wird das präzise Einheitengewicht; Kohlenhydrate werden aus dem aktuellen Wert pro 100 g neu berechnet.

## One-Click-Releasepipeline

Der finale Workflow enthält keine Integrations-/Commit-Phase und keine Eingaben.

```text
hart validiertes Fallback-ZIP
  → optionale Source-/Generatorpipeline
  → vollständig bestandener Source-Kandidat ODER Fallback
  → harte finale PWA-/HTTP-Prüfung
  → Pages-Artefakt
  → separater OIDC-Deploy-Job
```

### Failsoft

Ausfall von npm, Registry, Generator, Audit, Build oder Browserinstallation darf eine bereits validierte PWA nicht unbrauchbar machen. Der Source-Kandidat wird dann verworfen.

### Harte Abbrüche

Unsicheres ZIP, fehlende Checksummenabdeckung, Secrets/Keys, native Artefakte, Datenbank-/Serverinhalte, inkonsistente Generator-Metadaten, fehlende PWA-Dateien, ungültige Pages-Pfade oder ein fehlgeschlagener finaler Deploy führen zum Abbruch.

## PWA und GitHub Pages

- Vite-Basis `./`
- Manifest `id`, `start_url`, `scope` jeweils `./`
- `display: standalone`, `orientation: any`
- `.nojekyll` wird checksummiert im ZIP mitgeliefert
- Apple-Touch-, 192-, 512- und Maskable-Icons
- App-Shell-Precache und automatische Service-Worker-Aktualisierung
- OFF-Bilder CacheFirst, 30 Tage, höchstens 80 Einträge
- API-JSON bleibt außerhalb des Workbox-Runtime-Caches

## Optionaler Express-Server

`server/index.mjs` bleibt für lokale Entwicklung, bestehende Gateway-Deployments und den optionalen OpenAI-Parser erhalten. Er konsumiert die generierten Zod-Schema-Brücken. Der Server wird weder in das Pages-ZIP eingebettet noch für den Normalbetrieb benötigt.

## Supply Chain und Updates

Alle npm-Abhängigkeiten sind exakt gepinnt; `npm ci` ist der einzige Installationsweg im Workflow. Das Lockfile verwendet die öffentliche npm Registry. GitHub Actions sind auf aktuelle kompatible Major-Versionen festgelegt. Dependabot darf Updates vorschlagen; eine Freigabe erfolgt nur als kompatible Welle nach Generator-, Contract-, Browser-, PWA-, Cache- und Pages-Gates.

Das App-only-Release-ZIP legt die gebauten Dateien direkt in den ZIP-Stamm. Zusätzlich enthält es die erzeugte OpenAPI-Beschreibung, das Generationsmanifest und die statische API-Dokumentation als Nachweis, aber keine Generator-Runtime und keinen Quellcode.
