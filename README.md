# KH Checker v2.0

Installierbare PWA zur deterministischen Berechnung von Kohlenhydraten für konkrete und generische Lebensmittel.

## Web-App

Nach erfolgreichem GitHub-Pages-Deployment:

**https://karlokarate.github.io/kannalles1/**

Auf iPhone oder iPad in Safari öffnen und anschließend **Teilen → Zum Home-Bildschirm** wählen.

## Architektur

- statische PWA auf GitHub Pages
- direkte Produktsuche über Search-a-licious
- konkrete Produktdaten über Open Food Facts
- deterministische Portions- und Mengenberechnung
- lokaler Verlauf, Favoriten und persönliche Stückgewichte
- kein eigener Datenserver erforderlich
- optionaler OpenAI-Port bleibt getrennt und benötigt bei Aktivierung ein sicheres Backend

## Deployment

Die gebaute App liegt komprimiert in nummerierten Fragmenten unter `payload/`. GitHub Actions rekonstruiert daraus das statische App-Verzeichnis und veröffentlicht es automatisch über GitHub Pages.

Jeder Push auf `main` startet die Veröffentlichung erneut.
