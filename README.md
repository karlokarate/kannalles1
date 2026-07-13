# KH Checker v2.2.4

KH Checker ist eine installierbare Web-App zur nachvollziehbaren Kohlenhydratberechnung. Im Standardbetrieb auf GitHub Pages ruft der Browser Search-a-licious und Open Food Facts direkt auf. Ein versionierter Daten-Gateway bleibt als vollständig getrennte zweite Lane verfügbar. Manuelle Berechnung, App-Shell und lokale Daten funktionieren offline, soweit sie bereits auf dem Gerät vorhanden sind.

## Autoritäten

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) ist die Architektur- und Betriebsautorität.
- [contracts/source/search-api.contract.mjs](contracts/source/search-api.contract.mjs) ist die einzige manuell gepflegte Gateway-API-Quelle.
- `package.json` ist die Versions- und Scriptquelle.
- Generierte Dateien unter `contracts/generated`, `src/generated`, `server/generated`, `generated-tests` und `docs/generated` werden nicht manuell editiert.
- [docs/AUDIT-FIX-MATRIX.md](docs/AUDIT-FIX-MATRIX.md) verfolgt P0–P2-Funde und ihre Evidenz.

## Laufzeit

```text
React-PWA
  → typisierte Search/Result-State-Machine
  → Lane A (Default): Search-a-licious → OFF Legacy; OFF v3.6 → v2
  → Lane B (optional): generierter Client → /api/v1 → gemeinsamer Gateway-Core
  → versionierte lokale Repositories (Memory → IndexedDB → kontrollierter Fallback)
```

Die verbindliche Dual-Lane-Entscheidung und die objektiven Umschaltkriterien stehen in [docs/DECISION-DUAL-API-LANES.md](docs/DECISION-DUAL-API-LANES.md). Es gibt in keiner Lane einen OFF-Export oder einen eigenen Produktindex.

Im Settingsscreen kann optional ein persönliches Open-Food-Facts-Konto verbunden werden. Die App prüft Benutzername und Passwort direkt bei OFF, speichert sie nach erfolgreicher Prüfung lokal im Browserprofil und nutzt sie ausschließlich für direkte OFF Legacy-/Produktrequests. Search-a-licious und ein konfigurierter Gateway erhalten diese Zugangsdaten nicht. OFF-Reads funktionieren grundsätzlich auch ohne Konto; das Login erhöht keine Rate-Limits und ersetzt keinen anwendungsspezifischen `User-Agent`.

Kanonische Endpunkte:

- `GET /api/v1/health`
- `GET /api/v1/search?q=…&page_size=…&search_api=auto|search-index|search-a-licious|legacy`
- `GET /api/v1/product/{code}?known_carbs=0|1&product_api=hybrid|v3|v2`
- `POST /api/v1/ai/parse` (optional; lokaler Parser bleibt Standard)

Unversionierte `/api/...`-Pfade sind ausschließlich vorübergehende, deprecated Kompatibilitätsaliases.

## Lokale Entwicklung

Voraussetzung: Node.js `>=22.18.0` (Node 24 LTS empfohlen) und Python 3 für die reproduzierbare ZIP-/Releaseprüfung.

```sh
npm ci
npm run api:generate
npm run check
npm run test:e2e:install
npm run test:e2e
npm run audit
```

Die E2E-Suite läuft verpflichtend in Chromium Desktop/Android, Firefox Desktop und WebKit/iPhone. Die Scripts verwenden keine POSIX-Env-Zuweisung und laufen unter Windows, Linux und macOS.

## Optionale Gateway-Lane: Container/Self-host

```sh
cp .env.example .env
# OFF_USER_AGENT, OFF_CONTACT_EMAIL, GATEWAY_CLIENT_SALT, Origins und URLs setzen
docker compose up -d --build
curl --fail http://127.0.0.1:8787/api/v1/health
```

Diese Lane ist nicht für den aktuellen Pages-Betrieb erforderlich. Sie wird erst aktiviert, wenn die dokumentierten CORS-, Identifikations-, Limit- oder Verfügbarkeitsgrenzen der direkten Lane reproduzierbar überschritten werden.

Das finale Gateway-Image installiert ausschließlich den separaten Lock unter `deploy/runtime`: `dotenv`, Express, OpenAI, Redis und Zod. React/Lucide sind bereits gebundelte Frontend-Assets; Hono/OpenAPI und die Generatorwerkzeuge bleiben im Build-Stage. Der Server konsumiert dafür einen deterministisch generierten, eigenständigen Zod-Graphen statt der Hono-Contract-Datei zur Laufzeit.

Production trennt die Redis-Rollen physisch. `REDIS_COORDINATION_URL` hält Single-Flight, Limiter und Circuit-State über mehrere Gateway-Instanzen, verwendet `noeviction` und bleibt bei Ausfall fail-closed. `REDIS_CACHE_URL` zeigt auf einen anderen Dienst, verwendet `allkeys-lru` und darf unabhängig fail-soft auf Memory degradieren. Dieselbe Redis-URL/DB für beide Rollen wird in Production abgelehnt. Prozesslokale Koordination ist dort nur mit `ALLOW_SINGLE_INSTANCE_COORDINATION=1` für einen bewusst genau einmal gestarteten, nicht autoskalierten Prozess zulässig. Der Search-a-licious-Eventstream besitzt zusätzlich einen eigenen Redis; sein `updater` wird erst mit `--profile search-updates` und einem tatsächlich angebundenen Product-Opener-Producer aktiviert.

Der optionale Paid-AI-Parser ist in Production nur aktiv, wenn sowohl `OPENAI_API_KEY` als auch ein zufälliger `AI_SAFETY_SALT` mit mindestens 32 Zeichen gesetzt sind. Ohne starken Salt bleibt `/api/v1/ai/parse` fail-closed und der Healthvertrag meldet die Capability als nicht verfügbar; der lokale Parser der Web-App bleibt nutzbar. Ein geeignetes Secret lässt sich beispielsweise mit `openssl rand -base64 32` erzeugen. Der geprüfte Default ist `OPENAI_MODEL=gpt-5.6-luna` mit maximal 512 Ausgabetokens und `reasoning.effort=none`; Modell, Tokenlimit (256–2048) und zulässiger Reasoning-Aufwand bleiben serverseitige Konfiguration. Zusätzlich gelten kombinierte globale/Nutzerbudgets: 30/6 Aufrufe pro Minute sowie rollierend 300/30 Aufrufe je 24 Stunden. Ein Request muss alle vier Budgets bestehen; damit kann ein kurzer Minutenburst das Tageskostenlimit nicht umgehen.

`GATEWAY_CLIENT_SALT` ist ein zweites, unabhängiges Production-Secret für pseudonyme Client-Budgets (standardmäßig 6 Suchen und 10 Produktaufrufe pro Minute). Es HMACt ausschließlich die vom Express-Trust-Proxy-Modell bestätigte Client-IP; Rohadressen werden nicht als Budget-Key abgelegt. Weil mehrere Personen hinter demselben NAT/VPN dieselbe öffentliche Adresse teilen, teilen sie auch dieses konservative Missbrauchsbudget und können sich gegenseitig kurz drosseln. Bei Klinik-/Schulnetzen die Werte kontrolliert erhöhen oder einen authentifizierten First-Party-Clientschlüssel ergänzen, jedoch niemals ungeprüfte Forwarded-Header vertrauen.

Vercel ist in Lane A keine Laufzeit- oder Deploymentabhängigkeit. Bei einem späteren vollständigen Wechsel auf Lane B wird Vercel bewusst als externer Serverdienst gepflegt; dünne Serverless-Routen müssen dann denselben Gateway-Core wie der Node/Express-Adapter verwenden.

## Statisches PWA-Deployment

Ein leerer `VITE_DATA_GATEWAY_URL`-Wert baut die direkte Pages-Lane mit globaler Suche. `VITE_DATA_GATEWAY_URL=https://gateway.example.org` schaltet alle Such- und Produktanfragen autoritativ auf Lane B. Releaseprofile heißen entsprechend `direct-pages` und `gateway`.

```sh
npm run build
npm run check:pages
npm run release
```

Der Pages-Workflow ist bewusst ein schlanker Deploymentpfad: Lockfile installieren, Produktions-PWA bauen, `dist/` hochladen und deployen. Er wiederholt weder Unit-/Browser-/Container-/Securitytests noch den separaten Releasebau. Ohne Repository-Variable `DATA_GATEWAY_URL` wird Lane A veröffentlicht; mit einer öffentlichen HTTPS-URL wird Lane B gebaut. Die alte Variable `VITE_DATA_GATEWAY_URL` wird vom Workflow nicht verwendet.

```sh
# Nur für den bewussten Wechsel auf Lane B:
gh variable set DATA_GATEWAY_URL --body https://gateway.example.org
gh workflow run build-deploy-pages.yml
```

Die veröffentlichte URL ist `https://karlokarate.github.io/kannalles1/` und wird zusätzlich in der Deployment-Zusammenfassung des Workflows ausgegeben.

## Browser- und Geräte-Support

Der Kern ist progressiv und benötigt JavaScript, Fetch, IndexedDB und einen sicheren HTTPS-/Loopback-Kontext. Verbindlich getestet werden:

Die ausgelieferte Kompatibilitätsbaseline ist Chrome/Android/Edge 84, Firefox 67 sowie Safari 14.1/iOS 14.5 oder neuer. Sie entspricht bewusst auch dem CSS-Vertrag (unter anderem Flex-Gap), statt nur JavaScript für ältere Browser zu transpiliieren und dort ein unzuverlässiges Layout zu versprechen.

| Familie | CI-Profil | Erwartung |
|---|---|---|
| Chromium | Desktop Chrome, Pixel 7 | vollständige Kernfunktion und PWA |
| WebKit | iPhone 15 Pro | vollständige Kernfunktion; Installation über „Zum Home-Bildschirm“ |
| Firefox | Desktop Firefox | vollständige Kernfunktion; PWA-Installation je Browserangebot |

Zusätzlich gelten 320-px-Reflow (entspricht 400 % Zoom bei 1280 px Ausgangsbreite), 200 % Textvergrößerung, Landscape, primäre 44-px-Touchziele und tatsächlich reduzierte Animationen als UX-Gates. Sehr alte oder eingebettete Browser ohne die Mindest-APIs erhalten eine verständliche Unsupported-/Fallback-Anzeige; „jeder beliebige Browser“ ist keine technisch ehrliche Garantie.

## Datenschutz, Lizenz und Sicherheit

- In Lane A gehen Suchbegriffe an Search-a-licious beziehungsweise OFF Legacy und Barcodes an OFF; diese Dienste sehen die öffentliche Client-IP. In Lane B gehen diese Daten an den konfigurierten Gatewaybetreiber.
- Produktbilder können derzeit direkt von `images.openfoodfacts.org` geladen werden. Dabei erhält das OFF-Bild-CDN technisch IP-Adresse und angeforderte Bild-URL; vollständig drittanbieterfreier Betrieb erfordert einen eigenen Bild-Proxy. Offline erscheinen nur bereits gecachte Bilder und Daten.
- Verlauf, Favoriten, Kalibrierungen und API-Cache sind getrennte lokale Datenbereiche und können unabhängig gelöscht werden.
- Keine Betreiber-Credentials für OFF, Redis oder OpenAI dürfen `VITE_*` heißen oder im statischen Bundle landen. Persönliche, im Settingsscreen eingegebene OFF-Zugangsdaten sind ausdrücklich erlaubte lokale Laufzeitdaten; sie werden weder eingebaut noch an Search-a-licious/Gateway oder Diagnose-/API-Caches weitergegeben.
- CORS ist keine Authentifizierung: Der kostenpflichtige AI-Endpunkt benötigt in Production zusätzlich den geheimen `AI_SAFETY_SALT`, damit globale und pseudonyme Nutzerbudgets immer gemeinsam greifen.
- Produktdaten stammen von Open Food Facts und stehen unter ODbL; Bilder können abweichende Einzel-Lizenzen haben. Quellen- und Altersangaben müssen im Ergebnis sichtbar bleiben. Siehe [OFF API-Dokumentation](https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/).
- Search-a-licious ist AGPL-3.0; beim Self-hosting gelten dessen Lizenz- und Source-Angebotspflichten. Siehe [offizielles Repository](https://github.com/openfoodfacts/search-a-licious).
- Produktdaten sind nutzergeneriert und können unvollständig oder falsch sein. Etikett prüfen; KH-Ergebnisse nicht ungeprüft für Therapie- oder Insulindosierungsentscheidungen verwenden.

## API- und Generatorpflege

```sh
npm run api:generate   # OpenAPI, Orval, Zod, MSW/Faker, Docs
npm run api:check      # deterministische Regeneration/Drift
npm run api:verify     # kanonische SHA-256-Prüfung, CRLF/LF-neutral
npm run check:gateway  # optionales Live-Health-Gate
```

Die ausführbaren Core-Vertragstests importieren Produktionsmodule. Historische Referenzalgorithmen sind nur Migrationskontext und dürfen nicht als Ersatz für Produktionsverifikation dienen.
