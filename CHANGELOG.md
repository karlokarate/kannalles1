# Changelog

## 2.5.0 – Durchgängige Suchseiten und generische Portionssemantik

- breite Katalogsuchen zeigen fest 20 Treffer pro Seite und bleiben über Seite 2, 3 und weitere Seiten vollständig erreichbar,
- ein einundzwanzigster Treffer wird ausschließlich als Look-ahead verwendet und nie zusätzlich auf der aktuellen Seite angezeigt,
- die frühere Einstellung „Maximale Suchtreffer“ begrenzt die Ergebnismenge nicht mehr,
- Mehrprodukteingaben ohne ausdrücklich genannte Einheit werden generisch als Portion interpretiert,
- `ein halbes Brötchen mit Nutella` bedeutet `0,5 Portion Brötchen` plus `1 Portion Nutella`,
- fehlt für eines der Produkte eine belastbare Portion, wird die Portionsgröße über den vorhandenen Smart-Unit-Dialog abgefragt,
- ausdrücklich eingegebene Einheiten wie `15 g Nutella` bleiben unverändert maßgeblich.

## 2.4.2 – Persönliche Standard-Einheiten bei jeder Suche

- mengenexplizite Eingaben ohne Einheit, zum Beispiel `13 Salzstangen`, verwenden automatisch die gespeicherte persönliche Standard-Einheit des ausgewählten Produkts,
- eine persönliche Portion von `0,4 g` ergibt bei Menge 13 exakt `5,2 g` Gesamtgewicht,
- implizite Einheiten folgen immer der aktuellen Resolver-Empfehlung statt einer veralteten Gramm-Auswahl,
- Standard- und Smart-Controller verwenden dieselbe Auswahl-Autorität,
- ausdrücklich eingegebene Einheiten bleiben weiterhin maßgeblich.

## 2.4.1 – Erkannte Mengen als zentrale Request-Quelle

- behebt den Mengenverlust bei asynchroner Favoritenpriorisierung, zum Beispiel `24 Salzstangen`,
- die kanonische Produktabfrage wird nicht mehr erneut als neue Mengeneingabe geparst,
- initiale Produktdefaults, Mehrprodukteingaben und Variantenwechsel verwenden eine gemeinsame Request-Policy,
- Produktvarianten und bestätigte Einheitskalibrierungen behalten die erkannte Menge,
- echte SQLite-WASM-Browsertests reproduzieren den Favoritenfall und prüfen die vollständige Berechnung.

## 2.4.0 – Natürliche Bruchmengen und verlässliche App-Updates

- deutsche Bruchmengen wie `ein halbes`, `anderthalb`, `dreiviertel`, `½` und `1 1/2` werden deterministisch erkannt,
- die vollständige Mengenphrase wird vor der Produktsuche entfernt, sodass nach `Brötchen` statt nach `halbes Brötchen` gesucht wird,
- Dezimal- und Mehrprodukteingaben bleiben kompatibel,
- installierte Apps prüfen den aktuellen Deploy und bieten Updates benutzergesteuert an,
- automatisch gespeicherte Gesamtrechnungen zeigen ihren vollständigen Berechnungszeitpunkt.

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
