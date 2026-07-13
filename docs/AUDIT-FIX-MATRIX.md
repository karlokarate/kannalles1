# Offline-Cutover: Konsolidierungsmatrix

| Bereich | Owner | Konsolidierter Stand | Produktionsgate |
|---|---|---|---|
| Katalog-Domainmodell | Atlas | direkt von Projektion, Resolver, Rechner und UI verwendet | Contract- und Typprüfung |
| SQLite-WASM/OPFS | Forge | manifestgesteuerter Download, Prüfung, A/B-Aktivierung und Rollback | realer Browserkatalogtest |
| Resolver/Berechnung | Helix | katalogeigene Nährwert- und Einheitenevidenz ohne Legacyadapter | deterministische Unit-/Journeytests |
| Anwendung | Lumen | Suche, Berechnung, Status, Verlauf, Favoriten, Einstellungen | Accessibility-/Responsive-/Offline-Journeys |
| Qualitätsgrenzen | Sentinel | Onlinebaum verboten; Katalog-, Architektur-, Build- und Browsergates | `npm run check:all` |

## Geschlossene Konsolidierungsprobleme

- widersprüchliche Zwischenstände des Domainmodells wurden auf Atlas' finalen Exportvertrag vereinheitlicht,
- Forge-Status und A/B-Slotmodell werden vollständig bis in die UI transportiert,
- Helix konsumiert `CatalogProduct` direkt und erhält keine Legacy-DTOs,
- Bild-URLs entstehen ausschließlich in der UI-Schicht,
- Server-, API-, Gateway-, Container- und Generated-Client-Bäume wurden aus dem aktiven Produkt entfernt,
- der Produktionsbuild verwendet exakt die im Katalogmanifest benannte SQLite-Datei,
- Windows-Katalogprüfung und SQLite-Runtime-Installation sind plattformneutral,
- Startskripte bedienen nur noch das statische Offline-Artefakt.

## Noch vor Freigabe nachzuweisen

- vollständiges lokales Gate inklusive Lint, Build und Pages-Prüfung,
- echte Chromium-/Firefox-/WebKit-Ergebnisse gemäß Browser-Supportvertrag,
- installierter Offline-Reload mit echter SQLite-WASM-/OPFS-Datenbank,
- erfolgreicher GitHub-Pages-Testdeploy und Smoke-Test der veröffentlichten HTTPS-Origin.
