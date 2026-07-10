# KH Checker deployment repository

Dieses Repository enthält nur den GitHub-Pages-Workflow und die auswählbaren Release-ZIPs.

## Neue Version hochladen

1. Die fertige App-ZIP unter `releases/` hochladen.
2. In GitHub **Actions** öffnen.
3. **Deploy selected KH Checker ZIP to GitHub Pages** wählen.
4. **Run workflow** starten.
5. Bei `zip_path` den vollständigen Pfad angeben, zum Beispiel:

```text
releases/kh-checker-v2.1-komplett.zip
```

Der Workflow entpackt die gewählte ZIP immer in ein vollständig neues Veröffentlichungsverzeichnis. Dateien einer älteren Version werden nicht übernommen.

## Erwartete ZIP-Struktur

Die ZIP darf die App entweder direkt auf oberster Ebene enthalten:

```text
index.html
manifest.webmanifest
sw.js
assets/
icons/
```

oder in genau einem gemeinsamen Hauptordner.

Vor dem Deployment werden ZIP-Integrität und die drei Pflichtdateien geprüft.
