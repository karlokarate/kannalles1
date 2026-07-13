# Changelog

## 2.3.1 – Editierbare persönliche Therapiewerte

- kontrollierte Zahlenfelder im Diabetikerprofil erlauben jetzt vollständiges Löschen und ziffernweise Neueingabe,
- gültige Werte werden weiterhin sofort gespeichert; unvollständige Werte bleiben während der Eingabe als Entwurf sichtbar,
- ungültige Entwürfe werden beim Verlassen des Feldes auf den letzten gültigen Wert zurückgesetzt,
- Browser-Regressionstest für das Editieren des persönlichen Zielblutzuckers ergänzt.

## 2.2.4 – Offline-SQLite-Cutover

- produktive Datenautorität auf den versionierten lokalen SQLite-Katalog umgestellt,
- Atlas-Domainmodell, Forge-Runtime, Helix-Berechnung und Lumen-Anwendung ohne Legacyadapter konsolidiert,
- Kataloginstallation mit SHA-256-/SQLite-Prüfung, OPFS-A/B-Slots und Rollback ergänzt,
- Suche, Produktauswahl, Berechnung, Verlauf, Favoriten und Einstellungen auf den Offlinepfad umgestellt,
- API-, Gateway-, Server-, Container- und generierte Online-Clientpfade entfernt,
- manifestgetreuen Build für `kh-checker-dach-v1.sqlite` und SQLite-WASM eingeführt,
- Architektur-, Dead-Code-, Katalog-, Bundle-, Pages- und echte Browsergates ergänzt,
- Start- und Deploymentpfade auf die statische PWA vereinheitlicht.

Historische Übergabeprotokolle der abgelösten Onlinearchitektur liegen ausschließlich unter `docs/v3/archive/`.
