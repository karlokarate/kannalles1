KH CHECKER v2.2.4 – ERST LESEN
================================

DIESE ZIP IST DIREKT FÜR EUREN GITHUB-PAGES-WORKFLOW GEBAUT
------------------------------------------------------------
Die fertige PWA liegt direkt im ZIP-Stamm. Die ZIP nicht umpacken und nicht
vorher entpackt hochladen.

GITHUB
------
1. Aktuellen Source-Stand inklusive Lockfile einchecken.
2. Actions öffnen.
3. Workflow "Build, validate and deploy KH Checker PWA" ohne Eingaben starten.
4. Nur ein vollständig neu gebauter und validierter Kandidat wird veröffentlicht.
5. Nach erfolgreichem Workflow die ausgegebene Pages-Seite öffnen.

LAUFZEIT
--------
GitHub Pages liefert nur die statischen App-Dateien. Manuelle Berechnung und
lokale Daten funktionieren ohne Server. Neue globale Produktsuche läuft nur
über ein konfiguriertes Daten-Gateway; direkte Browserzugriffe auf OFF oder
Search-a-licious sind verboten. Primärbetrieb ist ein eigener Suchindex.

INSTALLATION
------------
iPhone/iPad:
Safari -> Teilen -> Zum Home-Bildschirm

Android:
Chrome -> App installieren / Zum Startbildschirm hinzufügen

Desktop:
Installationssymbol des Browsers verwenden.

WICHTIG
-------
index.html nicht als Produktionsweg direkt über file:// öffnen. Service Worker
und PWA-Installation benötigen einen sicheren HTTP(S)-Kontext. GitHub Pages
stellt diesen automatisch bereit.

FEHLER UND CACHE
----------------
Die App zeigt einen strukturierten, sicher bereinigten Endpunktfehler, sperrt
keinen manuellen Retry und nutzt im Auto-Modus den eigenen Index primär sowie
OFF Legacy kontrolliert als Reserve. Die öffentliche Search-a-licious-Instanz
ist nur ein expliziter Diagnosemodus. Bereits lokal gespeicherte Produkte,
Kalibrierungen und Berechnungen bleiben verfügbar.

DATENSCHUTZ
-----------
Suchbegriffe, Barcodes und Produktdaten-Anfragen gehen nur an das konfigurierte
Gateway. Produktbilder können direkt von images.openfoodfacts.org geladen
werden; das Bild-CDN sieht dabei technisch IP-Adresse und Bild-URL. Offline
verfügbar sind nur bereits gecachte App-Assets, Bilder und Daten.

ARTEFAKTE
---------
Das Komplett-ZIP enthält nur die deploybare PWA und Prüfnachweise.
ENTWICKLER-QUELLCODE-v2.2.4.zip wird separat ausgegeben und nicht nach Pages deployt.
