# Changelog

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
