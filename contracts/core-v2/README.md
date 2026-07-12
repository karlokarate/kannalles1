# KH Checker – Core Contracts v2.0

Dieses Bundle definiert die verbindlichen Kernfunktionen der App.

## Harte Produktziele

1. **Jede Suche endet kontrolliert.**  
   Eine externe API kann technisch ausfallen. Die App muss trotzdem immer in
   einem verständlichen Zustand enden: Ergebnis, Produktauswahl, gespeicherter
   Fallback, kein Treffer, Kalibrierung nötig oder Datenquelle vorübergehend
   nicht erreichbar.

2. **Die kleinste belastbar belegte Verzehreinheit steht zuerst.**  
   Bei Kinder Bueno ist das beispielsweise ein Riegel und nicht die
   Doppelpackung. Eine Packung oder Herstellerportion darf eine vorhandene
   kleinere Einheit nicht verdrängen.

3. **Fehlt das Einzelgewicht, wird nicht geraten.**  
   Der Nutzer kann eine frei wählbare Anzahl kleinster Einheiten gemeinsam
   wiegen. Daraus werden Einzelgewicht, KH pro Einheit und KH der angefragten
   Menge deterministisch berechnet.

4. **Die Messung bleibt erhalten.**  
   Gespeichert wird primär das gemessene Gewicht einer Einheit. Bei späteren
   Suchen wird der aktuelle KH-Wert pro 100 g verwendet und die KH-Menge neu
   berechnet.

## Wichtig

„Suche funktioniert immer“ bedeutet nicht, dass eine fremde API immer
erreichbar ist. Es bedeutet, dass es **keine unbehandelte Fehlersituation**
gibt und dass die App jeden Ausfall eindeutig und handlungsorientiert
darstellt.

Bundle-Version: 2.0.0  
Erzeugt: 2026-07-11T11:27:49.990967+00:00
