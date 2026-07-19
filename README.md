# FishIT KH Checker v2.4.1

FishIT KH Checker ist eine installierbare Kohlenhydrat-Rechenhilfe, die nach der Ersteinrichtung lokal und offline arbeitet. Produktsuche, Berechnungen, Favoriten, Verlauf, eigene Produkte, persönliche Einheiten und Einstellungen werden auf dem verwendeten Gerät verarbeitet und gespeichert.

## Aktuelle Version öffnen und installieren

### **[FishIT KH Checker – neuester GitHub-Deploy](https://karlokarate.github.io/kannalles1/)**

Dieser Link führt immer direkt zur aktuellsten über GitHub Pages veröffentlichten Version. Es ist keine Anmeldung und keine Installation aus einem App-Store erforderlich.

## Lokaler Offline-Produktkatalog

Beim ersten vollständigen Öffnen lädt die App einmalig den aktuellen DACH-Produktkatalog und speichert ihn lokal im privaten Speicherbereich des Browsers.

- Größe: rund **24 MiB** beziehungsweise **25,2 MB**
- Aktueller Umfang: **317.579 Produkte** und **60.682 Marken**
- Datenbasis: DACH-Produktdaten aus Open Food Facts
- Format: lokaler SQLite-Katalog
- Aktivierung erst nach Prüfung von Dateigröße, SHA-256-Prüfsumme, Schema und Datenbankintegrität

Für diesen ersten Download ist eine Internetverbindung erforderlich. Sobald die App den Katalog als bereit meldet, funktionieren Produktsuche, Produktauswahl, Einheitenauflösung und Kohlenhydratberechnung auch ohne Internetverbindung.

Bei einem späteren Katalogupdate wird die neue Version erneut geladen und erst nach erfolgreicher Prüfung aktiviert. Ein fehlerhafter oder unvollständiger Download ersetzt nicht den zuletzt funktionierenden Katalog.

Der Browser oder das Betriebssystem kann lokale Web-App-Daten löschen, etwa beim manuellen Löschen von Websitedaten, bei sehr knappem Gerätespeicher oder beim privaten Surfen. Danach muss der Katalog erneut heruntergeladen werden.

Produktbilder sind optional. Noch nicht lokal gespeicherte Bilder können eine Internetverbindung benötigen. Sie lassen sich in den Einstellungen vollständig ausblenden; Suche und Berechnung funktionieren unabhängig davon.

## Unterstützte Geräte

Die App wurde auf verschiedenen Geräten praktisch getestet, darunter:

- iPhone und iPad mit Safari
- Android-Smartphones und -Tablets mit aktuellen Chromium-Browsern
- Desktop-Systeme mit Chrome, Edge und Firefox

Für die zuverlässigste Offline-Nutzung sollte die App im normalen Browser geöffnet und anschließend zum Home-Bildschirm beziehungsweise als App installiert werden. Private Browserfenster und eingebettete Browser innerhalb anderer Apps sind nicht empfohlen.

## Installation auf iPhone und iPad

1. Den [aktuellen GitHub-Deploy](https://karlokarate.github.io/kannalles1/) in **Safari** öffnen.
2. Warten, bis der Produktkatalog vollständig geladen und als bereit angezeigt wird.
3. Im Safari-Browser zuerst auf den **Teilen-Button** tippen. Das Symbol ist ein Quadrat mit einem nach oben zeigenden Pfeil.
4. Im geöffneten Teilen-Menü nach unten scrollen und **Zum Home-Bildschirm** auswählen.
5. Den vorgeschlagenen Namen prüfen und oben rechts auf **Hinzufügen** tippen.
6. Die App künftig über das neue Symbol auf dem Home-Bildschirm starten.

Der Weg führt also ausdrücklich über **Safari → Teilen → Zum Home-Bildschirm → Hinzufügen**.

## Installation auf Android

1. Den [aktuellen GitHub-Deploy](https://karlokarate.github.io/kannalles1/) in Chrome, Edge oder einem kompatiblen Browser öffnen.
2. Den ersten Katalogdownload vollständig abschließen lassen.
3. Das Browsermenü öffnen.
4. **App installieren** oder **Zum Startbildschirm hinzufügen** auswählen.
5. Die Installation bestätigen und die App anschließend über das neue App-Symbol öffnen.

Je nach Browser kann bereits in der Adressleiste oder als Hinweis innerhalb der Seite eine Installationsschaltfläche erscheinen.

## Verwendung im Desktop-Browser

1. Den [aktuellen GitHub-Deploy](https://karlokarate.github.io/kannalles1/) öffnen.
2. Den ersten Katalogdownload abschließen lassen.
3. In Chrome oder Edge das Installationssymbol in der Adressleiste oder den Menüpunkt **App installieren** verwenden.
4. In Firefox kann die App direkt als Webseite verwendet werden; die angebotene Installationsart hängt vom Betriebssystem und der Browserversion ab.

## Erste Berechnung

1. Im Bereich **Rechner** einen Produktnamen oder Barcode eingeben.
2. Auf **Suchen** tippen.
3. Einen eindeutigen Treffer öffnen oder aus mehreren Treffern die richtige Produktvariante auswählen.
4. Menge und passende Einheit festlegen.
5. Das Ergebnis in Gramm Kohlenhydrate prüfen.
6. Das Produkt bei Bedarf zur Gesamtrechnung hinzufügen, als Favorit merken oder im Verlauf speichern.

Die App berechnet intern ohne Zwischenrundung. Die gewünschte Anzahl angezeigter Nachkommastellen wird separat in den Einstellungen gewählt.

## Produktsuche

Die Suche arbeitet mit dem lokal gespeicherten SQLite-Katalog. Möglich sind:

- Suche nach Produktname
- Suche nach Marke
- Suche nach Barcode
- Auswahl zwischen ähnlichen Produktvarianten
- Eingabe von Menge und Einheit zusammen mit dem Produktnamen, zum Beispiel `3 Riegel Kinder Bueno`
- natürliche Bruchmengen in Text und Sprache, zum Beispiel `ein halbes Brötchen`, `dreiviertel Brötchen`, `½ Brötchen` oder `null komma fünf Brötchen`
- erkannte Mengen bleiben als eine zentrale Request-Quelle bei Favoritenpriorisierung, Produktvarianten und persönlicher Kalibrierung erhalten
- Spracheingabe für ein einzelnes Produkt
- Spracheingabe für mehrere Bestandteile einer Mahlzeit

Ein mögliches Sprachbeispiel ist: `2 Scheiben Brot mit 20 Gramm Nutella und eine Sprite`.

Die Verfügbarkeit und Offline-Fähigkeit der Spracherkennung hängt vom Browser und Betriebssystem ab. Die normale Texteingabe bleibt jederzeit verfügbar.

Wird kein passendes Produkt gefunden, setzt die App nicht unbemerkt ein anderes Produkt ein. Stattdessen kann ein generischer Eintrag, ein Klinikwert oder ein eigenes Produkt verwendet werden.

## Produktvarianten

Sind mehrere passende Produkte vorhanden, zeigt die App eine Trefferliste mit Produktname, Marke, Barcode und Kohlenhydratwert. Der passendste Treffer kann vorausgewählt werden; alle gefundenen Varianten bleiben direkt umschaltbar.

Vor der Berechnung sollte immer geprüft werden, ob Produktname, Marke, Packungsvariante und Nährwert zum tatsächlich verwendeten Produkt passen.

## Mengen und Einheiten

Je nach vorhandenen Produktdaten werden unter anderem folgende Einheiten angeboten:

- Gramm
- Milliliter
- Stück
- Riegel
- Scheibe
- Portion

Ist eine belastbare kleinste Einheit vorhanden, wird sie bevorzugt angeboten. Bei Gramm und Millilitern steht zusätzlich ein Schieberegler zur schnellen Mengenauswahl zur Verfügung.

## Eigene Standard-Einheit abwiegen

Fehlt für Stück, Riegel, Scheibe oder Portion ein zuverlässiges Einzelgewicht, kann es selbst bestimmt werden:

1. Beim geöffneten Produkt den Bereich **Serving-Einheit selbst abwiegen** öffnen.
2. Die gewünschte Einheit auswählen.
3. Eine frei wählbare Anzahl gemeinsam wiegen.
4. Anzahl und Gesamtgewicht eintragen.
5. Das automatisch berechnete Gewicht je Einheit und die Kohlenhydrate je Einheit prüfen.

Die App speichert diese persönliche Kalibrierung lokal, wählt sie sofort aus und verwendet sie bei späteren Suchen desselben Produkts als Standard. Bereits gespeicherte Werte können jederzeit neu bestimmt werden.

## Gesamtrechnungen und Mahlzeiten

Mehrere Produkte lassen sich zu einer gemeinsamen Mahlzeit zusammenstellen:

1. Das erste Produkt berechnen.
2. **Zur Gesamtrechnung** auswählen.
3. Über **Weiteres Produkt** die nächste Suche starten.
4. Weitere Produkte hinzufügen.
5. Mengen und Einheiten einzelner Positionen direkt in der Übersicht ändern.
6. Die Gesamtsumme der Kohlenhydrate prüfen.

Gesamtrechnungen werden automatisch im Verlauf gespeichert. Dort können sie später erneut geöffnet, verändert und wiederverwendet werden.

## Verlauf

Der Bereich **Verlauf** enthält:

- gespeicherte Gesamtrechnungen
- optional gespeicherte Einzelberechnungen
- Datum und Uhrzeit
- verwendete Menge und Einheit
- berechnete Kohlenhydrate

Gesamtrechnungen können erneut geöffnet oder einzeln gelöscht werden. Der gesamte Verlauf lässt sich über die Verlaufseite oder die Einstellungen löschen.

## Favoriten

Ein geöffnetes Katalogprodukt kann über **Merken** als Favorit gespeichert werden. Favoriten erscheinen im eigenen Bereich und lassen sich von dort direkt wieder für eine Berechnung öffnen.

Favoriten werden ausschließlich lokal auf dem jeweiligen Gerät gespeichert.

## Eigene Produkte und manuelle Berechnung

Über den Umschalter **Manuell** können Produkte angelegt werden, die nicht im Katalog vorhanden sind:

1. Bezeichnung eingeben.
2. Kohlenhydrate pro 100 g oder 100 ml vom Etikett übernehmen.
3. Gewünschte Menge eintragen.
4. Bezugsart Gewicht oder Volumen auswählen.
5. Optional ein Produktfoto aufnehmen oder auswählen.
6. Das Produkt lokal speichern.

Gespeicherte eigene Produkte können später geladen, geändert, neu berechnet oder gelöscht werden. Fotos und Produktdaten bleiben auf dem Gerät.

## Eigene Produktfotos

Bei einem Katalogprodukt ohne brauchbares Bild kann ein eigenes Foto aufgenommen oder ausgewählt werden. Das Foto wird lokal dem Produkt zugeordnet und kann später ersetzt werden.

Beim Löschen aller lokalen Nutzerdaten werden auch diese Fotos entfernt.

## Klinik-Katalogmodus

In den Einstellungen stehen drei Suchmodi zur Verfügung:

- **Hybrid – Klinik bevorzugt + großer Katalog:** passende Klinikwerte werden bevorzugt, der große Produktkatalog bleibt zusätzlich verfügbar.
- **Klinik Only – nur Klinikum Leverkusen:** ausschließlich die lokal eingebundenen Einträge der Kohlenhydrat-Austauschtabelle werden durchsucht und können vollständig durchgeblättert werden.
- **Klinik Off – nur großer SQLite-Katalog:** die Klinikdatei wird bei der Suche vollständig ignoriert.

Ein Klinikwert kann als direkter Kohlenhydratwert je Stück hinterlegt sein. Fehlt ein belastbarer Wert oder ist eine Prüfung der Verpackung erforderlich, weist die App darauf hin, statt eine nicht belegte Masse abzuleiten.

## Optionale Bolus-Rechenhilfe

In den Einstellungen kann ein **Diabetikerprofil** mit Bolus-Rechenhilfe aktiviert werden. Konfigurierbar sind:

- persönliches Kohlenhydratverhältnis in g KH je Insulineinheit
- persönlicher Korrekturfaktor in mg/dL je Insulineinheit
- persönlicher Zielblutzucker in mg/dL
- voneinander unabhängige Tageszeitsegmente für alle drei Faktoren
- persönliche Insulin-Wirkdauer
- optionale manuelle Erfassung des letzten Pen-Bolus mit Uhrzeit und Einheiten

Die Rechenhilfe zeigt KH-Bolus, Korrekturanteil und eine rechnerische Gesamtsumme. Bei wiederverwendeten Mahlzeiten wird ein aktueller Blutzuckerwert neu abgefragt.

**Wichtiger medizinischer Warnhinweis:** Diese Funktion ist nur eine Rechenhilfe und kein Medizinprodukt, keine Therapieempfehlung und keine Freigabe einer Insulindosis. Sie darf nur mit persönlichen Werten verwendet werden, die mit dem behandelnden Diabetes-Team festgelegt wurden. Frühere Bolusgaben, Basalinsulin, Glukosetrends, Bewegung, Krankheit, Alkohol, verzögerte Verdauung, Messfehler und weitere medizinisch relevante Einflüsse können unberücksichtigt bleiben. Bei Unsicherheit darf auf Grundlage der App keine Insulindosis abgegeben werden.

## Einstellungen im Überblick

### Design

- **Bunt & Comic**
- **Modern & ruhig**

### Katalogmodus

- Hybrid
- Klinik Only
- Klinik Off

### Diabetikerprofil

- Bolus-Rechenhilfe ein- oder ausschalten
- Faktoren nach Tageszeit konfigurieren
- Zeitsegmente hinzufügen, verschieben oder entfernen
- Insulin-Wirkdauer einstellen
- letzten Pen-Bolus optional berücksichtigen

### Berechnung

- 0, 1 oder 2 Nachkommastellen
- maximal 10, 15 oder 20 Suchtreffer

### Lokale Speicherung

- Einzelberechnungen im Verlauf speichern oder nicht speichern
- letzte Ansicht mit Suche, Produktcode, Menge und Einheit wiederherstellen

Gesamtrechnungen werden unabhängig vom Schalter für Einzelberechnungen automatisch gespeichert.

### Produktbilder

- vorhandene Bilder laden
- Bilder immer ausblenden

### Lokale Nutzerdaten

Die App zeigt die Anzahl gespeicherter Kalibrierungen, Verlaufseinträge, Favoriten, eigener Produkte und Produktfotos. Möglich sind:

- Verlauf löschen
- gespeicherte Ansicht löschen
- alle lokalen Nutzerdaten löschen

Das Löschen lokaler Nutzerdaten kann nicht automatisch rückgängig gemacht werden. Vorher sollte bei Bedarf eine Übertragungsdatei exportiert werden.

## Daten auf ein anderes Gerät übertragen

Die App kann eine Übertragungsdatei erstellen. Sie enthält je nach Nutzung:

- Verlauf und gespeicherte Gesamtrechnungen
- persönliche Kalibrierungen und Einheiten
- Diabeteseinstellungen
- weitere lokale Nutzereinstellungen

Mögliche Aktionen:

- Datei herunterladen
- über die Teilen-Funktion des Geräts weitergeben
- Datei auf einem anderen Gerät importieren

Beim Import werden Verlauf und persönliche Einheiten zusammengeführt; die Diabeteseinstellungen aus der Datei werden übernommen.

**Datenschutzwarnung:** Eine Übertragungsdatei kann sensible Gesundheits- und Nutzungsdaten enthalten. Sie sollte nur auf vertrauenswürdigen Geräten gespeichert und ausschließlich über sichere Wege weitergegeben werden.

## Datenschutz

- Suchbegriffe, Mengen, Favoriten, Verlauf, Kalibrierungen, eigene Produkte, persönliche Fotos und Einstellungen bleiben lokal auf dem Gerät.
- Für die Nutzung ist kein Benutzerkonto erforderlich.
- Der Produktkatalog wird beim ersten Öffnen und bei Katalogupdates von derselben veröffentlichten GitHub-Pages-Adresse geladen.
- Produktbilder können optional von den im Katalog referenzierten Bildadressen geladen werden.
- Die App sollte nicht im privaten Browsermodus verwendet werden, wenn Daten dauerhaft erhalten bleiben sollen.
- Übertragungsdateien werden nur auf ausdrückliche Aktion des Nutzers erstellt, geteilt oder importiert.

## Datenqualität und Sicherheit

Produkt-, Portions- und Nährwertdaten können unvollständig, veraltet, falsch zugeordnet oder fehlerhaft erfasst sein. Verpackungen, Rezepturen und Portionsgrößen können sich ändern.

Vor jeder gesundheitlich relevanten Verwendung sollten mindestens folgende Angaben mit der aktuellen Verpackung oder einer anderen verlässlichen Quelle verglichen werden:

- exakte Produktvariante
- Kohlenhydrate pro 100 g oder 100 ml
- Portions- oder Stückgewicht
- verwendete Menge
- Einheit und Bezugsbasis

Persönlich abgewogene Einheiten gelten nur für das konkret verwendete Produkt und die konkret gewogene Ausführung. Sie können bei Rezeptur-, Größen- oder Verpackungsänderungen unzutreffend werden.

## Medizinischer Haftungsausschluss

FishIT KH Checker dient der Information und rechnerischen Unterstützung. Die App ersetzt keine ärztliche Beratung, Diagnose, Therapieplanung, Schulung durch Diabetes-Fachpersonal oder Kontrolle der Produktverpackung.

Ergebnisse dürfen nicht ungeprüft für Therapieentscheidungen, Insulindosierungen oder andere medizinische Maßnahmen verwendet werden. Bei ungewöhnlichen Werten, Unter- oder Überzuckerung, Krankheit, Schwangerschaft, Kindern oder anderen besonderen Situationen ist professionelle medizinische Hilfe maßgeblich.

In einem medizinischen Notfall ist der örtliche Notruf zu verwenden.

## Lizenzen und Quellenhinweise

### Programmcode

Der Programmcode dieses Repositorys steht unter der **MIT License**. Die vollständigen Bedingungen stehen in der Datei [LICENSE](LICENSE).

Die MIT-Lizenz gilt nicht automatisch für eingebundene Datenbestände, Produktbilder, Marken, Logos, Klinikunterlagen oder Inhalte anderer Rechteinhaber.

### Open Food Facts

Der lokale DACH-Produktkatalog basiert auf Daten von **Open Food Facts**.

- Datenbank: Open Database License 1.0 (**ODbL 1.0**)
- einzelne Datenbankinhalte: Database Contents License (**DbCL 1.0**)
- Produktbilder: Creative Commons Attribution-ShareAlike 3.0 (**CC BY-SA 3.0**), soweit nicht zusätzliche Rechte entgegenstehen

Quellen und Lizenztexte:

- [Open Food Facts](https://world.openfoodfacts.org/)
- [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/)
- [DbCL 1.0](https://opendatacommons.org/licenses/dbcl/1-0/)
- [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)
- [Nutzungs- und Weiterverwendungsbedingungen von Open Food Facts](https://world.openfoodfacts.org/terms-of-use)

Open Food Facts ist ein gemeinschaftlich gepflegtes Projekt. Die dort bereitgestellten Angaben werden freiwillig erfasst; Vollständigkeit, Richtigkeit und Aktualität sind nicht gewährleistet.

### Klinikum-Leverkusen-Referenzwerte

Die lokal eingebundenen Klinikwerte nennen als Quelle die **Kohlenhydrat-Austauschtabelle „gKH Tabelle 2026“ des Klinikums Leverkusen**. Die Bezeichnung dient ausschließlich der Quellenangabe. Dieses Projekt ist nicht mit dem Klinikum Leverkusen verbunden und wird von diesem nicht unterstützt oder geprüft.

Rechte an der ursprünglichen Tabelle, ihrer Gestaltung, Bezeichnungen, Logos und sonstigen geschützten Bestandteilen verbleiben bei den jeweiligen Rechteinhabern und werden nicht durch die MIT-Lizenz dieses Repositorys erfasst.

### Marken und Produktdarstellungen

Produktnamen, Marken, Logos, Verpackungen und Abbildungen gehören ihren jeweiligen Rechteinhabern. Ihre Anzeige dient ausschließlich der Identifikation des jeweiligen Produkts. Es besteht keine Verbindung, Empfehlung oder Freigabe durch die genannten Hersteller oder Markeninhaber.

## Gewährleistung und Haftung

Die Software wird im Rahmen der MIT-Lizenz **wie besehen und ohne ausdrückliche oder stillschweigende Gewährleistung** bereitgestellt, soweit dies gesetzlich zulässig ist.

Es wird insbesondere keine Gewähr übernommen für:

- unterbrechungsfreien oder fehlerfreien Betrieb
- dauerhafte Verfügbarkeit der veröffentlichten Seite
- dauerhafte Speicherung durch den Browser oder das Betriebssystem
- Richtigkeit, Vollständigkeit oder Aktualität von Produkt- und Klinikdaten
- korrekte Produktzuordnung bei ähnlichen Varianten
- Eignung für einen bestimmten medizinischen oder sonstigen Zweck

Eine Haftung der Entwickler und Mitwirkenden für Schäden aus der Nutzung oder Nichtverfügbarkeit der Software ist im gesetzlich zulässigen Umfang ausgeschlossen. Zwingende gesetzliche Haftungsregelungen bleiben unberührt.

## Fehler, Probleme und Funktionswünsche melden

Kontakt zum Entwickler:

**[fishit.apps@gmail.com](mailto:fishit.apps@gmail.com)**

Hilfreich für eine schnelle Prüfung sind:

- verwendetes Gerät und Betriebssystem
- Browser und möglichst genaue Browserversion
- sichtbare App-Version
- genaue Schritte bis zum Problem
- erwartetes und tatsächliches Verhalten
- betroffener Produktname oder Barcode
- Screenshot der Meldung, jedoch ohne unnötige persönliche oder medizinische Daten
- Angabe, ob das Gerät online oder offline war

Bitte keine Passwörter, vollständigen Gesundheitsakten oder andere unnötige sensible Daten mitsenden.

## Lokale Entwicklung und Qualitätssicherung

Voraussetzungen: Node.js 22.18 oder neuer sowie Python 3 für die Katalogprüfung.

```bash
npm ci
npm run check:catalog
npm run dev
```

Vollständige Prüfungen:

```bash
npm run check          # Typprüfung, Linting, Tests, Katalog-, Build- und Architekturprüfungen
npm run test:e2e       # Browser-End-to-End-Tests
npm run audit          # Abhängigkeitsprüfung
npm run check:all      # vollständiges lokales Release-Gate
```

Zur Qualitätssicherung verwendet das Projekt unter anderem TypeScript, Vitest, Playwright, axe-core, Biome, Dependency Cruiser, Knip und npm audit.

Die technische Runtime-Architektur ist in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) dokumentiert.
