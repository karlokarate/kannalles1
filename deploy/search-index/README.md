# Eigener Search-a-licious-/OFF-Export-Index

Der Produktionspfad verwendet einen selbst betriebenen Search-a-licious-Index. OFF Legacy ist die kontrollierte Suchreserve; die öffentliche Search-a-licious-Instanz wird nur explizit zur Diagnose ausgewählt.

## Gepinntes Setup

1. Search-a-licious aus dem offiziellen Repository neben dieses Repository klonen und auf einen geprüften Commit pinnen:

   ```sh
   git clone https://github.com/openfoodfacts/search-a-licious.git ../search-a-licious
   git -C ../search-a-licious checkout f7b32f29d6de5f17e2fe10bf6235de8e9ce7d32f
   ```

2. Die getrackte Search-a-licious-`.env` nicht verändern. Stattdessen eine nur für den Betreiber lesbare Kopie außerhalb des Checkouts gemäß offizieller Produktionsanleitung konfigurieren und deren absoluten Pfad exportieren. So kann der Supply-Chain-Preflight jede unerwartete Änderung am Checkout hart ablehnen. Insbesondere `RESTART_POLICY=always`, `MEM_LIMIT`, `STACK_VERSION=8.3.3`, `CLUSTER_NAME` und `COMMON_NET_NAME` setzen. `CONFIG_PATH=/opt/search/data/config/openfoodfacts.yml`, `ELASTICSEARCH_URL=http://es01:9200` und der Redis-DNS-Name werden im geprüften Overlay deterministisch gesetzt und nicht aus der Betreiberdatei übernommen. Der durch `docker/metadata-action` erzeugte Image-Tag enthält den Präfix `sha-`; verbindlich ist deshalb exakt (weder roher Commit noch `dev`/`latest`):

   ```sh
   install -m 600 ../search-a-licious/.env /etc/kh-checker/search-a-licious.env
   # /etc/kh-checker/search-a-licious.env anschließend kontrolliert bearbeiten
   export SEARCH_A_LICIOUS_ENV=/etc/kh-checker/search-a-licious.env
   ```

   In dieser externen Datei muss exakt stehen:

   ```dotenv
   TAG=sha-f7b32f29d6de5f17e2fe10bf6235de8e9ce7d32f
   ```

   Das dazu veröffentlichte Image
   `ghcr.io/openfoodfacts/search-a-licious/search_service_image:sha-f7b32f29d6de5f17e2fe10bf6235de8e9ce7d32f`
   wurde als Manifest-Digest
   `sha256:13ce9c2eeb13a3b4e75e1f79bcb4282733304bf0685111a7a255e3830cbd02ca`
   verifiziert. Der Preflight verlangt den exakten Tag aus der `.env`;
   `compose.production.yml` überschreibt `api` und `updater` zusätzlich mit
   genau der unveränderlichen Referenz
   `ghcr.io/openfoodfacts/search-a-licious/search_service_image:sha-f7b32f29d6de5f17e2fe10bf6235de8e9ce7d32f@sha256:13ce9c2eeb13a3b4e75e1f79bcb4282733304bf0685111a7a255e3830cbd02ca`.
   Unter Linux benötigt Elasticsearch
   `vm.max_map_count=262144`.

   Das veröffentlichte Image an diesem Tag ist ein Single-Platform-Image für
   `linux/amd64`. Auf ARM64-Servern ist es daher nicht nativ portabel: dort den
   exakt gepinnten Commit nach der offiziellen Anleitung mit `make build` lokal
   für ARM64 bauen, in eine kontrollierte Registry pushen, den dabei erhaltenen
   unveränderlichen `name@sha256:…`-Wert als `SEARCH_A_LICIOUS_API_IMAGE`
   setzen und vor Import/Start denselben Config-Preflight inklusive
   Länderfeld-Patch ausführen. Ein bloßer lokaler Tag ist kein ausreichender
   Produktions-Pin.
   Diese Serverplattform-Grenze betrifft nicht die Browser-/Geräteunterstützung
   der PWA.

   Der gepinnte Upstream-Commit enthält im OFF-Profil den Tippfehler
   `conutries_tags`. Vor jedem Import und Start muss deshalb der versionierte
   Preflight den Commit prüfen und exakt diese Zuordnung korrigieren:

   ```sh
   node deploy/search-index/preflight.mjs --fix
   node deploy/search-index/preflight.mjs
   ```

   Der zweite Lauf ist absichtlich read-only und muss im Deployment-Gate grün
   sein. Der Preflight akzeptiert ausschließlich einen ansonsten sauberen
   Checkout mit genau diesem einen Git-Diff an
   `data/config/openfoodfacts.yml`; jede weitere getrackte oder ungetrackte
   Datei/Änderung bricht den Start ab. Bei einem abweichenden Commit,
   Config-Shape oder Patch-Diff wird damit kein unkontrollierter Stack gebaut.

   Die Änderung ist zusätzlich als
   `deploy/search-index/openfoodfacts-countries-input.patch` versioniert. Der
   Preflight prüft die kanonischen SHA-256-Werte, bevor beziehungsweise nachdem
   er exakt diese eine Zeile korrigiert:

   - offizielles `openfoodfacts.yml` am gepinnten Commit:
     `3802d6ce3d3e4ca7123bbfbb14989b2e1adcc6af49ac392f71f2c1f698bf715d`
   - nach der Korrektur `conutries_tags` → `countries_tags`:
     `7f8e5b2f62a84861d3f15742696a5538dda2f530e071eaba5467e845abb68e2f`

   CI prüft Overlay, Patch, Commit und diese Nachweise ohne externen Checkout:

   ```sh
   node deploy/search-index/preflight.mjs --static
   ```

3. Gateway-Identität setzen und den vollständigen Stack starten:

   ```sh
   export OFF_USER_AGENT='KH-Checker/2.2.4 (+https://example.invalid; contact: ops@example.invalid)'
   export OFF_CONTACT_EMAIL='ops@example.invalid'
   export GATEWAY_CLIENT_SALT="$(openssl rand -base64 32)"
   docker compose -f compose.yml -f compose.production.yml up -d --build
   ```

`compose.production.yml` bindet die offizielle Compose-Definition ein und setzt im Gateway `SEARCH_INDEX_URL=http://api:8000/search`. Weil Production externe Klartext-Endpunkte standardmäßig ablehnt, setzt das Overlay für genau diesen privaten Compose-DNS-Host zusätzlich `SEARCH_INDEX_ALLOW_INSECURE_HTTP=1`. Diese Ausnahme darf niemals für einen öffentlichen oder anderweitig nicht vertrauenswürdigen HTTP-Host übernommen werden. Der Index ist damit intern erreichbar und muss nicht öffentlich exponiert werden.

Im Standardprofil laufen Gateway, zwei physisch getrennte Gateway-Redis-Dienste, Search-a-licious API, deren eigener Eventstream-Redis und die beiden benötigten Elasticsearch-Knoten. Der Gateway-Koordinationsdienst verwendet `noeviction` und ist fail-closed; der getrennte Antwortcache verwendet `allkeys-lru` und darf fail-soft degradieren. Search-a-licious erhält ausschließlich `REDIS_HOST=search-updates-redis` im gemeinsamen Product-Opener-Netz und kann dadurch niemals versehentlich Limiter-, Circuit- oder Cache-Keyspaces des Gateways verwenden.

Der Search-a-licious-`updater` ist im Standardprofil absichtlich aus. Er wird nur mit `--profile search-updates` gestartet, nachdem eine Product-Opener-Instanz nachweislich den in `openfoodfacts.yml` benannten Redis-Stream in genau diesen separaten Redis schreibt. Ohne diesen Producer würde der Daemon lediglich blockierend auf einen leeren/falschen Stream warten und eine nicht vorhandene Aktualität vortäuschen. Die Search-a-licious-Browseroberfläche (`--profile search-ui`) und Elasticvue (`--profile search-admin`) sind ebenfalls deaktiviert. Das optionale amd64-Frontend verwendet `ghcr.io/openfoodfacts/search-a-licious/search_front_image:sha-f7b32f29d6de5f17e2fe10bf6235de8e9ce7d32f@sha256:62a710612af99adcb64359d53346e6658b683b9cfbe7058629a6b785798fd1ef`; das Admin-Profil ist kein freigegebener Produktionsbestandteil und darf erst nach einem eigenen Image-/Zugriffsschutz-Audit aktiviert werden. Die Elasticsearch-Knoten verwenden den Multi-Arch-Index `docker.elastic.co/elasticsearch/elasticsearch:8.3.3@sha256:caef7887384d9c77f309508ce72722bf21c7991d5fe81f23eaf843d1ca891fe4`.

Der Default `GATEWAY_BIND=127.0.0.1` exponiert den Dienst nur lokal und `TRUST_PROXY=0` ignoriert vom Client gesetzte Forwarded-Header. Für Geräte im Netz darf `GATEWAY_BIND=0.0.0.0` ausschließlich hinter einem kontrollierten HTTPS-Reverse-Proxy mit restriktivem CORS verwendet werden; erst dann darf `TRUST_PROXY=1` gesetzt werden. Der Proxy muss eingehende `Forwarded`-/`X-Forwarded-*`-Header entfernen und selbst neu setzen. Same-Origin-Auslieferung von PWA und `/api/v1` ist bevorzugt.

Der Stack setzt `REQUIRE_DISTRIBUTED_COORDINATION=1`: `REDIS_COORDINATION_URL` ist damit für Readiness, verteilte Limits, Single-Flight und Circuits zwingend. `REDIS_CACHE_URL` zeigt auf einen anderen Dienst und eine andere Datenhaltung. `ALLOW_SINGLE_INSTANCE_COORDINATION=1` ist nur für einen bewusst einzelnen, nicht autoskalierten Production-Prozess außerhalb dieses Compose-Stacks vorgesehen und darf niemals als Mehrinstanz-Fallback dienen.

Production verlangt außerdem `GATEWAY_CLIENT_SALT` mit mindestens 32 zufälligen Zeichen. Daraus entstehen HMAC-pseudonymisierte Budget-IDs aus der vertrauenswürdig ermittelten Client-IP; die Rohadresse wird nicht als Redis-Key gespeichert. Die Defaults sind 6 Suchen und 10 Produktabrufe pro Minute. Mehrere Geräte hinter demselben NAT/VPN teilen dieses Budget. In großen Klinik-/Schulnetzen Limits kontrolliert anheben oder eine authentifizierte First-Party-Identität ergänzen; niemals öffentliche `X-Forwarded-For`-Werte ohne kontrollierten Proxy vertrauen.

## Initialer OFF-Export-Import

Den JSONL-Export von Open Food Facts in das in Search-a-licious eingebundene `data/`-Verzeichnis legen. Danach Taxonomien und Daten importieren:

```sh
docker compose -f compose.yml -f compose.production.yml run --rm api python3 -m app import-taxonomies
docker compose -f compose.yml -f compose.production.yml run --rm api \
  python3 -m app import /opt/search/data/products.jsonl --skip-updates
```

Für periodische Vollimporte erneut ohne `--partial` importieren; Search-a-licious erstellt dafür einen neuen Index mit umschaltbarem Alias. Partielle Exporte verwenden ausdrücklich `--partial --skip-updates`. Kontinuierliche Updates erst nach Anbindung des Product-Opener-Producers aktivieren:

```sh
docker compose --profile search-updates -f compose.yml -f compose.production.yml up -d updater
```

Vorher muss der Producer im `COMMON_NET_NAME`-Netz `search-updates-redis:6379` erreichen und den konfigurierten OFF-Stream befüllen. Ein laufender Container allein ist kein Aktualitätsnachweis; Stream-Lag und jüngster erfolgreich in Elasticsearch übernommener Event-Zeitpunkt gehören ins Betriebsmonitoring.

## Readiness und Smoke

```sh
docker compose -f compose.yml -f compose.production.yml exec gateway node -e \
  "fetch('http://api:8000/health').then(r=>{if(!r.ok)process.exit(1)})"
docker compose -f compose.yml -f compose.production.yml exec gateway node -e \
  "fetch('http://api:8000/search',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({q:'Haferflocken',langs:['de','main'],page:1,page_size:1,fields:['code','product_name_de','countries']})}).then(r=>{if(!r.ok)process.exit(1)})"
curl --fail http://127.0.0.1:8787/api/v1/health
curl --get --fail http://127.0.0.1:8787/api/v1/search --data-urlencode 'q=Haferflocken' --data 'search_api=search-index'
```

Der Gateway-Healthvertrag muss `capabilities.searchIndex=true` und `components.searchIndex.status=ready` melden. Import, Health und eine echte Suche gehören vor Traffic-Umschaltung in den Deployment-Gate.

Autoritative Betriebsdetails: [Search-a-licious Installation](https://openfoodfacts.github.io/search-a-licious/users/how-to-install/), [Index-Updates](https://openfoodfacts.github.io/search-a-licious/users/how-to-update-index/) und [CLI-Referenz](https://openfoodfacts.github.io/search-a-licious/devs/ref-python/cli.html).
