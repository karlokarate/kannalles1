# Changelog

## 2.2.4

### Reproduzierbarer Pages-Build

- kombinierter Source-/Release-ZIP-Workflow mit strikter automatischer Moduserkennung
- Build/Validierung ohne Pages-Schreibrecht, separater OIDC-Deploy-Job
- Version aus `package.json` für App, Server, Workbox und Release-Namen
- `OFF_USER_AGENT` aus dem statischen Frontend-Build entfernt
- statische AI- und Gateway-Endpunkte standardmäßig leer; optionale URLs über öffentliche Repository-Variablen

### PWA- und Paket-Härtung

- Apple-Touch-Icon verbindlich im Precache
- `navigateFallbackDenylist` und `purgeOnQuotaError` verbindlich geprüft
- CSP- und Referrer-Metadaten für GitHub Pages
- deploybares Komplett-ZIP ohne eingebetteten Quellcode oder weitere ZIP-Dateien
- separates Entwickler-Quellcode-ZIP und Repo-Integrationspaket
- sichere ZIP-Extraktion, Symlink-/Traversal-/Quellcode-/Secret-Prüfung und vollständige SHA-256-Verifikation

### Browser- und UX-Gates

- Playwright-Tests für Desktop und mobilen Viewport
- axe-core Accessibility-Smoke
- deterministische manuelle KH-Berechnung ohne Netzwerk
- Suchbutton bleibt während laufender Anfrage sofort erneut bedienbar
- mobile Breiten- und Hauptnavigation-Prüfung

## 2.2.4

### Pages-first-PWA

- GitHub Pages wieder als statischer Hauptbetrieb ohne erforderlichen Node- oder Gateway-Server
- automatische Same-Origin-Gateway-Erkennung und `/api/health`-Probe entfernt
- Search-a-licious in jeder HTTP(S)-PWA-Laufzeit als primäre Volltextsuche
- OFF Legacy Search genau einmal nach technischem Primärfehler oder gültiger Null-Treffer-Antwort
- manuell konfigurierte Gateway-URL bleibt als optionale Kompatibilität erhalten

### Contract- und Cache-Fixes

- maximal zwei Suchbackends pro Benutzeraktion
- Fresh Canonical Cache vor Netzwerk und backend-unabhängige Query-Deduplizierung
- Stale URL-Cache darf einen erforderlichen zweiten Backend-Versuch nicht mehr abbrechen
- Stale Canonical Cache erst nach Scheitern beider öffentlichen Suchquellen
- zwei erreichbare Null-Treffer-Antworten werden als typisierter, kurz gecachter Leerzustand geliefert
- Primärfehler bleibt in der Diagnose erhalten, wenn Legacy einen Treffer liefert
- sofortiger manueller Retry ohne lokalen Cooldown oder Request-Zähler

### Produkt und Diagnose

- ausgewählter Suchtreffer liefert Nährwert-Seed für die Barcode-Hydrierung
- OFF v2 nur, wenn Seed plus v3.6 weiterhin keine Kohlenhydratdaten enthalten
- Such- und Produktdetailversuche bleiben gemeinsam sichtbar
- optionale Server-Suche folgt derselben Null-Treffer-Fallback-Regel wie der Client

### Release und Qualität

- Komplett-ZIP mit `index.html` direkt am ZIP-Stamm für den vorhandenen Pages-Workflow
- relative App-, Manifest-, Service-Worker- und Icon-Pfade für GitHub-Pages-Unterpfade
- neuer `npm run check:pages` prüft Pflichtdateien, Unterpfade, Scope, Start-URL und Icons
- 67 automatisierte Tests plus TypeScript, Biome, Server-Syntax und PWA-Produktionsbuild

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
