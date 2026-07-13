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
3. Workflow "Build and deploy KH Checker to Pages" ohne Eingaben starten.
4. Der Workflow baut die PWA aus Source und Lockfile und veröffentlicht sie.
5. Nach erfolgreichem Workflow die ausgegebene Pages-Seite öffnen.

LAUFZEIT
--------
GitHub Pages liefert die statischen App-Dateien. Ohne Gateway nutzt der Browser
Search-a-licious direkt und OFF Legacy als einmalige Reserve; Produktdetails
kommen aus OFF v3.6 und bei Bedarf v2. Eine Gateway-URL aktiviert die getrennte
zweite Lane für die gesamte Anfrage.

Optional kannst du unter Einstellungen dein persönliches Open-Food-Facts-Konto
verbinden. Benutzername und Passwort werden nach erfolgreicher OFF-Prüfung lokal
in diesem Browserprofil gespeichert und nur bei direkten OFF-Anfragen verwendet.
Search-a-licious und ein konfigurierter Gateway erhalten diese Daten nicht.

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
keinen manuellen Retry und nutzt Search-a-licious primär sowie OFF Legacy
kontrolliert als Reserve. Bereits lokal gespeicherte Produkte,
Kalibrierungen und Berechnungen bleiben verfügbar.

DATENSCHUTZ
-----------
Im Direktbetrieb gehen Suchbegriffe und Barcodes an die offiziellen OFF-Dienste;
mit Gateway gehen sie an dessen Betreiber. Produktbilder werden von images.openfoodfacts.org geladen
werden; das Bild-CDN sieht dabei technisch IP-Adresse und Bild-URL. Offline
verfügbar sind nur bereits gecachte App-Assets, Bilder und Daten.

ARTEFAKTE
---------
Das Komplett-ZIP enthält nur die deploybare PWA und Prüfnachweise.
ENTWICKLER-QUELLCODE-v2.2.4.zip wird separat ausgegeben und nicht nach Pages deployt.
