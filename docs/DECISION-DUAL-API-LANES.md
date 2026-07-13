# Entscheidung: zwei API-Lanes ohne OFF-Export

Status: angenommen am 13.07.2026

## Gemeinsame Leitplanken

- Es gibt keinen OFF-Datenexport, keinen importierten Produktdump und keinen eigenen Suchindex.
- API-Schlüssel oder andere Betreiber-/Servergeheimnisse dürfen nie in das Browserbundle gelangen. Davon getrennt darf ein Nutzer sein persönliches OFF-Konto im Settingsscreen ausdrücklich lokal hinterlegen; diese Laufzeitdaten sind kein Build-Secret.
- Eine Nutzeraktion löst höchstens zwei Such-Upstreams beziehungsweise zwei Produktversionen aus.
- Ist ein Gateway konfiguriert, ist es für diese Anfrage autoritativ. Nach einem Gatewayfehler fällt der Browser nicht heimlich auf direkte Drittanbieteraufrufe zurück.

## Lane A – direkter Browserbetrieb (aktueller Standard)

Eine leere `dataGatewayUrl` bedeutet:

- Suche: Search-a-licious zuerst, OFF Legacy einmalig als Reserve bei Fehler oder leerem Ergebnis.
- Produkt: OFF API v3.6 zuerst, OFF API v2 nur als Kompatibilitätsergänzung oder Reserve.
- Browsercache, Single-Flight, Abbruch, Deadlines und stale Ausfallreserve bleiben lokal.
- Ein persönliches OFF-Konto ist optional. Die App prüft es per POST an OFFs Auth-API und verwendet es ausschließlich für direkte Requests an `world.openfoodfacts.org`; Search-a-licious und ein Gateway erhalten es nie.
- GitHub Pages ist der einzige von uns gepflegte Laufzeithost; Vercel ist keine Produktionsabhängigkeit.

Diese Lane nutzt die von Search-a-licious und OFF veröffentlichten CORS-Schnittstellen. OFFs bevorzugtes Session-Cookie ist cross-site nicht portabel (`SameSite=Lax`, Wildcard-CORS ohne Credential-Freigabe); deshalb verwendet die optionale Kontoanbindung OFFs Request-Parameter-Kompatibilität und entfernt Passwort-URLs aus Diagnose- und Cachemetadaten. Ein Browser kann den von OFF empfohlenen anwendungsspezifischen `User-Agent` weiterhin nicht setzen; außerdem bleiben CORS und die Verfügbarkeit der öffentlichen Dienste außerhalb unserer Kontrolle.

## Lane B – vollständiger Gatewaybetrieb (vorbereiteter Ausweichpfad)

Eine gültige Same-Origin- oder HTTPS-`dataGatewayUrl` schaltet Suche und Produktabruf vollständig auf die versionierte API unter `/api/v1` um. Der vorhandene gemeinsame Gateway-Core und der Express-Adapter bleiben dafür gepflegt. Falls Lane B aktiviert wird, wird ein dünner Vercel-Serverless-Adapter auf denselben Core gesetzt; Vercel übernimmt dann die Serverausführung, ist also bewusst eine externe Laufzeitabhängigkeit.

## Umschaltkriterien auf Lane B

Wir wechseln vollständig auf Vercel, sobald mindestens eines davon im produktiven Geräte-/Browser-Smoke-Test reproduzierbar ist:

1. Search-a-licious und OFF Legacy sind wegen CORS in einem unterstützten Browser beide nicht lesbar, obwohl sie außerhalb des Browsers valide antworten.
2. OFF lehnt Browseranfragen dauerhaft ab, weil eine anwendungsspezifische Serveridentifikation zwingend durchgesetzt wird.
3. Browserdirekte Limits oder Upstreamausfälle verhindern trotz Cache und genau einem Fallback eine verlässliche Kernnutzung.
4. Eine benötigte Funktion verlangt Servergeheimnisse, zentrale Missbrauchsbudgets oder globale Koordination.

Ein einzelner temporärer 5xx-Fehler löst den Wechsel nicht aus. Die Entscheidung stützt sich auf wiederholbare Tests in Chromium/Android, Firefox und WebKit/iOS sowie auf die offiziellen API-Verträge.
