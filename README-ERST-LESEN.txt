KH CHECKER v2.2.4 – ERST LESEN
================================

DIESE ZIP IST DIREKT FÜR EUREN GITHUB-PAGES-WORKFLOW GEBAUT
------------------------------------------------------------
Die fertige PWA liegt direkt im ZIP-Stamm. Die ZIP nicht umpacken und nicht
vorher entpackt hochladen.

GITHUB
------
1. Datei im Repository ablegen als:
   releases/kh-checker-v2.2.4-komplett.zip
2. Actions öffnen.
3. Workflow "Build, validate and deploy KH Checker PWA" starten.
4. mode = release_zip und zip_path = releases/kh-checker-v2.2.4-komplett.zip wählen.
5. Bei einem normalen Push dieses einzelnen neuen Release-ZIPs erfolgt die Auswahl automatisch.
6. Nach erfolgreichem Workflow die ausgegebene Pages-Seite öffnen.

LAUFZEIT
--------
GitHub Pages liefert nur die statischen App-Dateien. Das ist beabsichtigt.
Die installierte PWA fragt vom jeweiligen Gerät direkt ab:

1. Search-a-licious als primäre Volltextsuche
2. OFF Legacy Search genau einmal bei Fehler oder null Treffern
3. OFF API v3.6 für das ausgewählte Produkt
4. OFF API v2 nur, wenn danach noch Kohlenhydratdaten fehlen

Ein eigener Server ist für den normalen Betrieb nicht erforderlich.

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
Die App zeigt den originalen Endpunktfehler, sperrt keinen manuellen Retry und
verwendet Reserve-Daten erst nach dem Scheitern beider Suchbackends. Bereits
lokal gespeicherte Produkte, Kalibrierungen und Berechnungen bleiben verfügbar.

ARTEFAKTE
---------
Das Komplett-ZIP enthält nur die deploybare PWA und Prüfnachweise.
ENTWICKLER-QUELLCODE-v2.2.4.zip wird separat ausgegeben und nicht nach Pages deployt.
