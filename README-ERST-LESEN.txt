FishIT KH CHECKER v2.4.1
=================

FishIT KH Checker ist eine installierbare Offline-Web-App. Suche, Nährwerte und
Berechnung verwenden ausschließlich den mitgelieferten SQLite-Produktkatalog.
Ein API-Server, Gateway oder Benutzerkonto ist nicht erforderlich.

ERSTER START
------------
Öffentliche App (kein Benutzerkonto erforderlich):
https://karlokarate.github.io/kannalles1/

1. Die Adresse oben in Chrome, Edge oder Safari öffnen.
2. Warten, bis der Katalog unter Einstellungen als bereit angezeigt wird.
3. Ein Produkt suchen, auswählen und eine Menge berechnen.
4. Die App über die Browserfunktion installieren.
5. Das Gerät offline schalten, die App neu laden und Suche/Berechnung erneut testen.

Beim ersten Start werden App, SQLite-WASM und rund 25 MB Katalogdaten geladen.
Danach bleiben der verifizierte Katalog, Verlauf, Favoriten und eigene Einträge
im lokalen Gerätespeicher. Ein fehlgeschlagenes Katalogupdate lässt den letzten
verifizierten A/B-Slot aktiv.

Die App nicht per file:// öffnen. Service Worker, OPFS und PWA-Installation
benötigen HTTPS oder localhost.

GESUNDHEITSHINWEIS
------------------
Katalog- und Etikettendaten können unvollständig oder falsch sein. Etikett
prüfen und Ergebnisse nicht ungeprüft für Therapie oder Insulindosierung nutzen.
