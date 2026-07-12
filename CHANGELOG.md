# Changelog

## 2.2.4

### Zielarchitektur und API

- statische, installierbare PWA plus vendor-neutraler Node-Gateway; globale Suche benötigt das Gateway, manuelle und lokal gespeicherte Funktionen nicht
- Browserdaten-API strikt Gateway-only; eigener Search-a-licious-/OFF-Export-Index primär, OFF Legacy kontrollierte Auto-Reserve, öffentliche Search-a-licious-Instanz nur explizite Diagnose
- URL-versionierte `/api/v1`-Routen mit generiertem OpenAPI-/Orval-/Zod-Vertrag, strukturierten Fehlern und diagnostizierbarem Health-503
- OFF Produkt v3.6 primär und v2 nur zur gezielten Ergänzung weiterhin fehlender Produktdaten
- physisch getrennte Redis-Rollen: Limits/Single-Flight/Circuits fail-closed mit `noeviction`, Antwortcache fail-soft mit `allkeys-lru`; gleiche Production-Keyspaces werden abgelehnt

### Reproduzierbarer Betrieb

- portable Docker-/Compose-Auslieferung ohne Vercel-Konfiguration oder Serverless-Wrapper; CI validiert Compose, baut das Runtime-Image und verlangt einen gesunden gestarteten Gateway-Container
- gepinnter offizieller Search-a-licious-Commit mit tatsächlich verwendeten Tag-und-Digest-Images, versioniertem Länderfeld-Patch, Commit- und SHA-256-Preflight; ARM64-Buildgrenze dokumentiert
- Pages-Workflow baut ausschließlich aktuellen Source; `main` verlangt das Profil `full-app` inklusive HTTPS-Gateway, Redis-/Index-Readiness und echter Such-Canary, PR/lokal ist explizit `manual-only`
- Search-a-licious verwendet einen eigenen Eventstream-Redis; der Updater liegt hinter dem Profil `search-updates` und setzt einen realen Product-Opener-Producer voraus
- sichere, reproduzierbare Release- und Quellcode-ZIPs mit vollständiger SHA-256-Verifikation; keine alten Binärartefakte als Fallback
- gepinnter Gitleaks-Scan mit enger Ausnahme ausschließlich für generierte Manifest-Digests
- sämtliche GitHub Actions auf volle Commit-SHAs gepinnt; Dependabot pflegt Actions-, npm- und Docker-Updates über prüfbare Pull Requests

### Browser, UX und Datenschutz

- Pflichtprojekte Chromium Desktop/Android, Firefox Desktop und WebKit/iPhone sowie Offline-/Service-Worker-, History-, 320-px-, große-Schrift- und axe-WCAG-Smokes
- deterministische manuelle Berechnung, Gruppenwägung, Kalibrierung, sofortiger Retry sowie getrennte lokale Daten-/Löschgrenzen
- Suchbegriffe, Barcodes und Produktdaten nur zum Gateway; transparenter Hinweis, dass Produktbilder derzeit direkt vom OFF-CDN geladen werden und nur gecachte Assets/Daten offline vorliegen
- strukturierte, sicher bereinigte Fehlerdiagnose ohne Offenlegung interner Stackdetails

## 2.2.1

### Suchtransport und Diagnose

- Same-Origin-Gateway wird über `/api/health` automatisch erkannt
- Gateway-Suche ist autoritativ; der Browser wiederholt keine identischen öffentlichen Suchaufrufe
- statischer Datei-Viewer wird bei doppelt blockierter Volltextsuche als eingeschränkter CORS-Modus erklärt
- Suchcache, Produktsuche und Produktdetails bleiben in einer gemeinsamen UI-Ablaufspur sichtbar
- spätere Produktdetails überschreiben die ursprüngliche Suchdiagnose nicht mehr

### Produktabrufe

- vorhandene Kohlenhydratwerte des ausgewählten Suchtreffers werden in die Detail-Hydrierung übernommen
- v2 wird nicht mehr angefragt, wenn der zusammengeführte Suchtreffer plus v3.6 bereits ausreichende Kohlenhydratdaten enthält
- Gateway erhält `known_carbs=1` und trennt seeded/complete Produktcache-Keys, damit partielle Antworten nicht den vollständigen Barcodepfad kontaminieren

### Auslieferung und Qualität

- Komplett-Paket auf Gateway/PWA-Betrieb statt unsicherem lokalen Datei-Viewer ausgerichtet
- Android-Termux-, Linux/macOS- und Windows-Startskripte
- 54 automatisierte Tests
- TypeScript, Biome, Server-Syntax und Produktionsbuild vollständig grün

## 2.2.0

### Fehlerdiagnose und Bedienung

- tatsächlicher Netzwerk-, CORS-, Timeout-, JSON- oder HTTP-Fehler direkt im UI
- vollständige Endpunkte, Status, Startzeit, Dauer, Antwortvorschau, Retry-After und Cache-Alter pro Versuch
- kopierbare JSON-Diagnose
- erfolgreiche Fallbacks verschweigen den ursprünglichen Fehler nicht mehr
- Suchbutton bleibt während einer Anfrage bedienbar und startet sofort neu
- lokaler Countdown, Request-Lock und persistente Cooldowns vollständig entfernt
- ungültige beziehungsweise gemischte HTTP/HTTPS-Gateway-URLs werden sichtbar validiert und nicht verwendet
- Cache-Größe und verständliche Backend-Bezeichnungen in der Oberfläche

### API- und Cache-Logik

- backend-unabhängiger kanonischer Suchcache für Schreibvarianten wie `Kinder Bueno` und `Kinderbueno`
- Canonical Cache wird vor jeder neuen API-Anfrage geprüft
- identische parallele GET-Anfragen werden zusammengeführt
- ein abgebrochener UI-Abonnent beendet den Shared Request nicht mehr
- sofortiger Retry kann deshalb denselben laufenden Request übernehmen
- gültige leere Suchantwort löst keine zweite öffentliche Suche aus
- Gateway-Upstream-Diagnosen verhindern doppelte Browser-Fallbacks
- Suchtexte werden auf 120 Zeichen begrenzt
- veraltete URL-Cache-Daten behalten beim Canonical-Snapshot ihr ursprüngliches Abrufdatum
- stale Daten werden nach einem fehlgeschlagenen Refresh nicht wieder als frisch markiert
- Gateway-Transportfelder werden vor dem Speichern entfernt
- Product-not-found wird zuverlässig als HTTP 404 klassifiziert
- Produkt-404 vom Gateway wird als autoritativ behandelt
- bereits abgebrochene UI-Operationen werden an allen asynchronen Cache-, Parser- und Produktgrenzen verworfen
- fehlende v3.6-Nährwerte werden innerhalb desselben Produktvorgangs genau einmal über v2 ergänzt
- nützliche v3.6-Teildaten bleiben bei einem transienten v2-Ausfall nutzbar, ohne einen doppelten Fallback im selben Vorgang

### Persistenz und Performance

- begrenzter Memory-Cache
- kanonischer `localStorage`-Fallback für Such- und Produkt-Snapshots
- wiederverwendete IndexedDB-Verbindung statt Öffnen und Schließen pro Transaktion
- IndexedDB-Transaktionen gelten erst nach `transaction.complete` als gespeichert
- Retry-Backoff nach blockierter oder fehlgeschlagener IndexedDB-Öffnung
- IndexedDB-API-Cache-Schreibvorgänge blockieren die Ergebnisanzeige nicht mehr
- API-Cache-Bereinigung und zusammengeführte Statistik über alle Speicherschichten
- Generationsschutz gegen verspätete IndexedDB-Hintergrundwrites nach bewusstem Cache-Leeren
- PWA-Bildcache auf v2.2 aktualisiert und bei Speicherknappheit bereinigbar

### Server-Gateway

- Search-a-licious serverseitig primär, Legacy-Suche nur nach technischem Fehler
- OFF API v3.6 primär und v2 als kompakter Produktfallback
- kanonische Keys auch für Suchbegriffe ohne ASCII-Zeichen
- begrenzter Fresh-/Stale-Cache und In-Flight-Deduplizierung
- tote `/api/document`-Route entfernt
- unbekannte `/api`-Routen liefern JSON 404 statt SPA-HTML
- sicherere CORS-Allowlist, Sicherheitsheader und Host-/Port-Validierung
- abgestufte statische Cache-Header für HTML, Service Worker und gehashte Assets
- CSP ohne `unsafe-inline` sowie getrennte Worker- und Manifest-Regeln
- transiente v2-Produktfallback-Fehler frieren Teildaten nur kurz statt für den normalen 24-Stunden-Zeitraum ein
- interne 500-Details werden im Produktionsmodus nicht offengelegt
- wiederverwendeter OpenAI-Client und Prompt, feste Zeitlimits und begrenzte Retry-Anzahl
- begrenzte und bereinigte KI-Rate-Limit-Buckets

### Stabilität und Qualität

- Race beim initialen Laden und Speichern der Einstellungen behoben
- Race zwischen älteren und neueren Produktladevorgängen behoben
- Cleanup laufender UI-Abonnenten beim Unmount
- 52 automatisierte Tests
- zusätzliche Tests für Shared-Request-Retry, Abort-vor-Cache-Rückgabe, Empty-Result-Sicherheit, Stale-Promotion, Gateway-Deduplizierung, Query-Limit, v3/v2-Produkt-Merge und Produkt-404
- Biome 2.5.3 als reproduzierbarer Lint-Schritt in `npm run check`
- `dotenv` auf 17.4.2 und React-Typdefinitionen auf 19.2.17 aktualisiert
- Node-Typdefinitionen bewusst auf der Node-22-Linie 22.20.1 ausgerichtet und Runtime-Mindestversion auf 22.12 passend zu Vite 8 präzisiert

## 2.1.0

- statischer Browser-Build verwendet zuerst den browserkompatiblen Open-Food-Facts-Suchweg
- Search-a-licious bleibt serverseitiger beziehungsweise einmaliger Erreichbarkeits-Fallback
- ausgewählte Produkte werden einmal per OFF API v3.6 hydratisiert, damit ausgelassene Mengen- und Portionsfelder wieder verfügbar sind
- Kinder-Bueno- und vergleichbare Multipack-Einzelportionen werden aus Angaben wie `2 × 21,5 g` abgeleitet
- universeller manueller Gesamtgewichts- beziehungsweise Gesamtmengen-Editor
- direkte Zahleneingabe und Schieberegler
- Einzelwägung und Gruppenwägung für zählbare Produkte
- aus einem gemessenen Gesamtgewicht wird automatisch ein lokales Einheitengewicht gespeichert
- manuelle Portionsoptionen werden bei erneuter Bearbeitung ersetzt statt dupliziert

## 2.0.0

- deterministische Einheiten-Beweishierarchie
- Gruppenwägung für fehlende Stückgewichte
- persönliche Stückgewichts-Kalibrierungen
- In-Flight-Request-Deduplizierung
- IndexedDB Fresh-/Stale-Cache
- lokale Budgets und blockierende Cooldowns nach Retry-After
- generische Standardpfade ohne Produktdetail-Fan-out
- optionaler OpenAI-Structured-Output-Parser
