# KH Checker – normative Zielarchitektur

Dieses Dokument ist die einzige Architekturautorität. README, OpenAPI und Deployment-Dokumente müssen hiermit übereinstimmen.

## Invarianten

1. Eine leere Gateway-URL aktiviert Lane A: der Browser spricht direkt mit Search-a-licious und OFF. Eine gültige Gateway-URL aktiviert Lane B für die gesamte Nutzeraktion; es gibt keinen stillen Cross-Lane-Fallback.
2. Beide Lanes bieten globale Suche und Produkthydrierung. App-Shell, manuelle Berechnung und bereits lokal gespeicherte Daten bleiben bei Netzausfall nutzbar.
3. Alle Such-, Empty-, Offline-, Konfigurations- und Produktfehler enden in einem typisierten UI-Zustand. Retry bleibt sofort möglich.
4. Die kanonische API ist URL-versioniert unter `/api/v1`. Unversionierte Pfade sind deprecated Aliases und werden nicht vom generierten Client verwendet.
5. `contracts/source/search-api.contract.mjs` erzeugt Transport, Typen, Laufzeitvalidierung, Mocks und Dokumentation für Lane B. Lane A verwendet ausschließlich fest kodierte offizielle HTTPS-Origins und denselben gehärteten OFF-Projektionsadapter wie der Gateway-Core.
6. Jede Lane hat begrenzte serielle Deadlines und höchstens zwei Such- beziehungsweise Produktversuche pro Nutzeraktion.
7. Cachealter und ursprüngliches `fetchedAt` bleiben über Gateway- und Browsercaches erhalten; ein fehlgeschlagener Refresh macht stale Daten nicht frisch.
8. Der optionale Paid-AI-Parser ist in Production nur mit API-Key und einem mindestens 32 Zeichen langen geheimen Safety-Salt aktiv. Ohne diesen Salt bleibt der Endpunkt fail-closed; der lokale Parser bleibt verfügbar.
9. Eine Production-Gateway-Lane benötigt verteilte Koordination. Ein prozesslokaler Memory-Fallback ist dort nur mit dem expliziten `ALLOW_SINGLE_INSTANCE_COORDINATION=1` für einen garantiert einzelnen, nicht autoskalierten Prozess erlaubt; Compose erzwingt mit `REQUIRE_DISTRIBUTED_COORDINATION=1` Redis.
10. Koordinationszustand und Antwortcache verwenden in Production niemals dieselbe Redis-Storage-Identity. Koordination ist fail-closed/noeviction; Cache ist separat und fail-soft/allkeys-lru.
11. Production verlangt pseudonyme Per-Client-Budgets. Der HMAC-Salt bleibt serverseitig; ungeprüfte Forwarded-Header dürfen keine Clientidentität erzeugen.
12. Paid-AI benötigt gleichzeitig globale und pseudonyme Nutzerbudgets pro Minute und über rollierende 24 Stunden; kein erfolgreicher Aufruf darf nur von einem einzelnen Limiter geschützt sein.
13. Nutzer dürfen im Settingsscreen ein persönliches OFF-Konto lokal speichern. Diese Zugangsdaten sind ausdrücklich erlaubte Laufzeitdaten, keine Build-/Betreibersecrets; sie dürfen nur an `world.openfoodfacts.org`, niemals an Search-a-licious, Gateway, Diagnose oder API-Cache gehen.

## Komponenten

```text
React UI
  → SearchWorkflowState (home/candidates/result × idle/pending/empty/failed)
  → Lane A: öffentliche HTTPS-APIs
      → Search-a-licious → OFF Legacy
      → OFF v3.6 Nutrition Adapter → OFF v2 Compatibility Adapter
      → optional: persönliches OFF-Konto aus lokalem Settings-Repository
  → Lane B: generated createGatewayClient → Gateway API v1
      → runtime-neutraler Gateway-Core
          → konfigurierter Suchdienst → OFF Legacy
          → OFF v3.6 Nutrition Adapter
          → OFF v2 Compatibility Adapter
          → Redis-Koordination: Single-Flight + Limiter + Circuits
          → separater Redis-Antwortcache
          → absolute Deadline + stale-if-error
      → Node/Express Adapter (containerfähig)
  → lokale versionierte Repositories
      → begrenztes Memory
      → IndexedDB
      → kontrollierter, validierter Fallback
```

## Suchstrategie

- Lane A: Search-a-licious primär; OFF Legacy genau einmal als Reserve bei Fehler oder leerem Ergebnis.
- Lane B `search_api=auto`: der Gateway wählt seinen konfigurierten Primärdienst und die kontrollierte Reserve.
- `search_api=search-index`: ein explizit konfigurierter Gateway-Index strikt, keine öffentliche Reserve.
- `search_api=search-a-licious`: öffentlicher Dienst explizit zu Diagnose-/Reservezwecken.
- `search_api=legacy`: OFF Legacy explizit zu Diagnose-/Reservezwecken.
- Eine Nutzeraktion erzeugt höchstens zwei serielle Suchversuche und niemals parallelen Browser-Fan-out.
- Freie Suchtexte werden als Literale behandelt beziehungsweise Lucene-sicher escaped.

## Produktstrategie

- `product_api=hybrid`: OFF API v3.6 primär; v2 nur bei fehlenden vertraglich benötigten Kompatibilitätsfeldern.
- `product_api=v3`: strikt v3.6; erreichbare Antwort ohne Produkt endet als 404 und darf v2 nicht aufrufen.
- `product_api=v2`: expliziter Kompatibilitätsmodus.
- v3 `nutrition.aggregated_set` wird in das interne, versionsstabile Nutriments-DTO abgebildet. Externe DTOs gelangen nicht ungeprüft ins UI.
- Barcodes werden zentral nach OFF-Regeln normalisiert; ungültige Eingaben werden vor Netzwerkzugriff abgelehnt.

## Persönliches OFF-Konto in Lane A

- Der Settingsscreen verlangt OFF-`user_id` (Benutzername, nicht E-Mail) und Passwort und prüft beides per `POST https://world.openfoodfacts.org/cgi/auth.pl`.
- Nach erfolgreicher Prüfung werden die Zugangsdaten auf ausdrückliche Nutzeraktion im versionierten lokalen Settings-Repository gespeichert und können dort wieder vollständig entfernt werden.
- OFFs bevorzugtes Session-Cookie kann von einer Pages-PWA nicht browserübergreifend verwendet werden: OFF liefert Wildcard-CORS ohne `Access-Control-Allow-Credentials`, das Cookie selbst ist `SameSite=Lax`.
- Daher nutzt Lane A für direkte OFF Legacy-/v3.6-/v2-Reads die vom Product-Opener-Server unterstützten Parameter `user_id`, `password` und `no_log=1`. Das ist ein bewusst genehmigter Kompromiss zur öffentlichen OFF-Empfehlung, Credentials nicht auf GET zu legen; die URL kann in OFF-Request-Logs erscheinen.
- Search-a-licious und Lane B erhalten diese Daten nie. Diagnose, Fehlerobjekte, Single-Flight-Identität und API-Cache enthalten stets nur die credential-freie kanonische URL.
- OFF-Reads benötigen laut offizieller Dokumentation kein Login. Das Konto erhöht weder Rate-Limits noch ersetzt es OFFs empfohlene App-Identifikation per `User-Agent`, die Browser-JavaScript nicht setzen darf.

## Cache- und Koordinationssemantik

`api_meta.cacheStatus` beschreibt die Ende-zu-Ende-Frische. `cacheLayer` nennt die konkret ausliefernde Schicht; `gatewayCacheStatus` bewahrt Gateway-Frische, wenn ein Browsercache die Antwort umschließt.

| Ebene | Aufgabe |
|---|---|
| Browser Memory | kurze, begrenzte Hot-Reads |
| Browser IndexedDB | versionierte Search/Product-Datensätze und stale Reserve |
| Gateway Coordination Redis | Single-Flight, Limiter und Circuit-State; fail-closed/noeviction |
| Gateway Cache Redis | verteilter Antwortcache; fail-soft/allkeys-lru |
| Search Update Redis | separater Product-Opener-Eventstream für Search-a-licious |
| Gateway Memory | ausdrücklich degradierter Single-Instance-Fallback |

Cachekeys enthalten Provider, API-/Schema-/Projection-Version, Query-Token, Seitengröße und Produktmodus. Produktcachekeys enthalten mindestens Barcode und Produktmodus. Fehlerantworten werden nicht als Erfolg gecacht.

Jeder Redis besitzt ein explizites `maxmemory` unterhalb des Containerlimits. Koordination nutzt `noeviction`, weil Rate-Limiter, Locks und Circuit-Zustände sicherheitsrelevant sind; ein Schreibfehler folgt der fail-closed-Readiness-Policy. Der physisch getrennte Antwortcache nutzt `allkeys-lru` und darf unabhängig fail-soft degradieren. Search-a-licious nutzt weder davon einen: API und optionaler Updater zeigen ausschließlich auf `search-updates-redis` im Product-Opener-Netz.

Globale Providerbudgets werden zusätzlich mit HMAC-pseudonymisierten Clientbudgets kombiniert (`6` Suchen, `10` Produktaufrufe pro Minute als Default). Die Eingabe ist nur `req.ip` nach Express-Trust-Proxy-Regeln; der Salt bleibt ein mindestens 32 Zeichen langes Backend-Secret. NAT/VPN-Nutzer teilen dabei absichtlich ein Budget. Das schützt ohne Tracking-Cookie, kann aber große Klinik-, Schul- oder Firmennetze kollektiv drosseln; solche Betreiber müssen Limits kapazitätsbasiert anheben oder später eine authentifizierte First-Party-Identität einführen.

Der optionale Paid-AI-Pfad besitzt zusätzlich vier gemeinsam erforderliche Tokenbudgets: global 30/min und 300/rollierende 24 h, pro pseudonymem Nutzer 6/min und 30/rollierende 24 h. Diese Zustände liegen in der fail-closed Koordinations-Redis; ein Redis-Ausfall oder fehlender Production-Salt öffnet den kostenpflichtigen Pfad nicht.

Der AI-Aufruf ist zusätzlich ausgabeseitig begrenzt: Default `gpt-5.6-luna`, 512 Ausgabetokens und `reasoning.effort=none`. Zulässige Betreiberwerte werden vor dem SDK-Aufruf normalisiert (`256..2048` Tokens; nur die für GPT-5.6 freigegebenen Reasoning-Stufen), sodass freie Umgebungswerte keine unbeschränkte Kosten- oder Payloadfläche öffnen.

## Health und Betrieb

`GET /api/v1/health` ist upstream-unabhängig. Es meldet App-/API-Version, Build, Readiness, Capabilities, Komponenten, Circuits, Limiter und requested/effective Cachebackend ohne Secrets.

- HTTP 200: ready, entweder `healthy` oder kontrolliert `degraded`.
- HTTP 503: Prozess lebt, ist aber nicht ready (`unhealthy`).
- Ein ausdrücklich erlaubter Single-Instance-Memory-Fallback ist `degraded`, nicht fälschlich `healthy`; ohne diesen bewussten Override ist Production bei fehlender Redis-Koordination nicht ready.
- Eine gesetzte `OPENAI_API_KEY` ohne ausreichend starken `AI_SAFETY_SALT` deaktiviert in Production die AI-Capability und wird mit explizitem Komponenten-Grund gemeldet.
- Das `gateway`-Deployment-Gate verlangt HTTP 200/`ready=true` und die für dessen konkrete Production-Konfiguration notwendigen Koordinations- und Suchkomponenten. Das `direct-pages`-Profil benötigt keinen Gateway-Healthcheck.

## Deployment

Lane A besteht ausschließlich aus der statischen PWA auf GitHub Pages und den offiziellen öffentlichen APIs. Lane B besitzt einen portablen Node/Express-Adapter; falls die Umschaltkriterien aus [DECISION-DUAL-API-LANES.md](DECISION-DUAL-API-LANES.md) eintreten, wird derselbe Core über dünne Vercel-Serverless-Routen betrieben. Es gibt keinen OFF-Export und keinen eigenen Produktindex.

Das Runtime-Image besitzt einen separaten, gelockten Dependency-Satz. Hono/OpenAPI, Orval, TypeScript sowie React/Lucide verbleiben im Build; der Server erhält aus demselben OpenAPI-Graph einen eigenständigen generierten Zod-ESM-Validator und installiert zur Laufzeit nur `dotenv`, Express, OpenAI, Redis und Zod. Das verhindert, dass reine Generator- oder bereits gebundelte Browserabhängigkeiten die Produktions-Angriffsfläche vergrößern.

Ein externer Suchindex muss in Production per HTTPS angebunden werden. Klartext-HTTP benötigt `SEARCH_INDEX_ALLOW_INSECURE_HTTP=1` und ist ausschließlich für ein nachweislich privates Container-/Loopback-Netz zulässig; das Compose-Overlay nutzt diese Ausnahme explizit für den internen Host `api`.

Node-Runtime und Redis sind im Default nicht nur per Tag, sondern per verifiziertem OCI-Digest gepinnt. Auch Search-a-licious API/Updater und die benötigten Elasticsearch-Knoten werden im Produktions-Overlay mit Tag und Digest fixiert. `updater` (`search-updates`), `search_frontend` (`search-ui`) und `elasticvue` (`search-admin`) sind explizite, nicht zum Produktionsdefault gehörende Profile. Der Updater darf erst laufen, wenn Product Opener den konfigurierten Stream im separaten Event-Redis tatsächlich produziert. Betreiber können die Redis-Referenz bewusst per `REDIS_IMAGE` überschreiben; ARM64-Betreiber müssen das Search-a-licious-Image aus dem exakt gepinnten Commit bauen und dessen eigenen Registry-Digest über `SEARCH_A_LICIOUS_API_IMAGE` setzen. CI prüft die Repository-Defaults und baut/startet das tatsächliche Gateway-Image.

CI-Actions referenzieren ausschließlich vollständige Commit-SHAs; lesbare Major-Versionen stehen nur als Kommentare daneben. Der Workflow-Gate lehnt mutable Tags ab. Dependabot bündelt kontrollierte Update-PRs für GitHub Actions, npm und Docker, die dieselben Prüfungen erneut bestehen müssen.

Der statische PWA-Host kann GitHub Pages, ein CDN oder ein beliebiger HTTPS-Webserver sein. Artefakte tragen eines von zwei Profilen: `direct-pages` ohne App-Server oder `gateway` mit öffentlichem HTTPS-Gateway. `main` deployt derzeit `direct-pages`; `DATA_GATEWAY_URL` ist nur beim bewussten Lane-Wechsel zu setzen.

## Lokale Daten und Datenschutz

- Settings, Session, Verlauf, Favoriten, Kalibrierungen und API-Cache besitzen eigene Versions-/Validierungsgrenzen.
- Korrupte Einträge werden isoliert verworfen; Persistenzfehler dürfen ein korrekt berechnetes Ergebnis nicht zurücknehmen.
- Verlaufseinwilligung steuert nicht implizit Session oder API-Cache. Jede Kategorie wird transparent erklärt und separat löschbar.
- API-Cache-Löschen entfernt niemals den Workbox-App-Shell-Precache.
- Lane A sendet Suchbegriffe an Search-a-licious beziehungsweise OFF Legacy und Barcodes an OFF; Lane B sendet diese Daten an den Gatewaybetreiber. Produktbilder werden direkt von `images.openfoodfacts.org` geladen. Offline sind nur bereits gecachte Bilder/Assets/Daten verfügbar.
- Ein ausdrücklich verbundenes persönliches OFF-Konto liegt im lokalen Settings-Repository. Es wird nur an direkte `world.openfoodfacts.org`-Requests angehängt und separat über „Konto entfernen“ gelöscht.

## Browser-/UX-Gates

Chromium Desktop/Android, Firefox Desktop und WebKit/iPhone sind Pflichtprojekte. E2E deckt Erfolg, Empty, Error, Product, Offline-App-Shell, Back/History, Fokus, 320 px und axe WCAG A/AA ab. Manuelle Realgeräte-Smokes ergänzen, ersetzen diese Gates aber nicht.

## Lizenz- und Safety-Gates

OFF-Attribution, ODbL-/Bildhinweis, Quelle und Datenalter erscheinen beim Ergebnis. Die App weist nahe am Ergebnis darauf hin, Etiketten zu prüfen und das Ergebnis nicht ungeprüft für Therapie/Insulindosierung zu verwenden. Self-hosted Search-a-licious bleibt unter AGPL-3.0; Deploymentdokumentation muss die entsprechenden Pflichten nennen.
