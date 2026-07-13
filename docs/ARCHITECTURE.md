# Architektur: Offline-SQLite-Produktion

## Verbindliche Autorität

Die einzige Produktdatenquelle der Web-App ist `Catalog/kh-checker-dach-v1.sqlite`. Es gibt keinen alternativen API-, Gateway-, Server- oder Remote-AI-Pfad. Der Build übernimmt den im Manifest genannten Dateinamen unverändert und prüft alle katalogrelevanten Artefakte vor der Ausgabe.

```text
Produktionsmanifest + SQLite + Codecs + Bildschlüssel
  → Installer: Download, Hash-/Metadatenprüfung, Staging
  → OPFS A/B-Slots: verified → active, vorheriger Slot als Rollback
  → Web Worker + SQLite-WASM
  → katalogeigenes Domainmodell
  → Resolver/Berechnung
  → React-Anwendung
```

## Grenzen

- `src/lib/catalog/catalog.worker.ts` besitzt SQLite und führt Suche sowie Produktzugriff aus.
- `catalogInstaller.ts` besitzt Download, Prüfung, A/B-Slots und Aktivierung.
- `catalogProjection.ts` projiziert Daten verlustfrei in das von Atlas definierte Modell.
- Helix-Resolver und Rechner konsumieren dieses Modell direkt; Kompatibilitätsadapter sind verboten.
- Die UI darf aus `imageReference` eine optionale Bild-URL bilden. Bilder sind keine Produkt- oder Berechnungsautorität.
- UI und Worker tauschen nur strukturierte, serialisierbare Status-/Fehlerdaten aus.

## Persistenz und Update

Ein Katalog wird zunächst in den inaktiven Slot geschrieben. Erst nach erfolgreicher SHA-256-, Größen-, SQLite-, Schema- und Probeabfrageprüfung erhält er den Zustand `verified` und kann atomar `active` werden. Der vorherige aktive Slot bleibt als `rollbackSlot` erhalten. Staging- oder ungültige Dateien werden niemals als suchbar gemeldet.

## Offline- und PWA-Verhalten

Die App-Shell und die unveränderliche SQLite-WASM-Runtime werden vom Service Worker verwaltet. Der große, versionierte Katalog liegt bewusst außerhalb des Workbox-Precaches, weil der Installer seinen A/B-Lebenszyklus kontrolliert. Nach erfolgreicher Installation müssen App-Reload, Suche, Auswahl und Berechnung ohne Netzwerk funktionieren.

OPFS und Service Worker erfordern einen sicheren Kontext. Produktion läuft deshalb über HTTPS; localhost ist nur für Entwicklung und Tests vorgesehen. Chromium Desktop/Android und Firefox bestehen die integrierte OPFS-Matrix. WebKit/iPhone fehlt im getesteten Stand `FileSystemSyncAccessHandle`; die App meldet dort einen erklärten Unsupported-Status und weicht nicht auf Online-Produktdaten aus.

## Release-Gates

Ein deploybares Artefakt benötigt:

1. vollständige Katalogintegrität und manifestgetreue Dateinamen,
2. grüne Unit-, Contract-, Typ-, Lint-, Architektur- und Dead-Code-Gates,
3. einen reproduzierbaren Produktionsbuild und eine bestandene Pages-Artefaktprüfung,
4. echte SQLite-WASM-/OPFS-Browserjourneys ohne gemockte Produktdaten,
5. einen Offline-Reload gegen den bereits installierten Katalog.

Der Pages-Deploy hängt sowohl vom Build- als auch vom Browsergate ab.
