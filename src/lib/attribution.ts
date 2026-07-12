import type { CalculationResult } from '../types';

export function resultDataAttribution(
  result: Pick<CalculationResult, 'mode' | 'sourceLabel'>
): string {
  if (result.mode === 'manual') {
    return 'Datenquelle: eigene Eingabe beziehungsweise Etikettwert; es wurden keine Open-Food-Facts-Nährwerte verwendet.';
  }
  if (result.sourceLabel.startsWith('BLS 4.0')) {
    return 'Generische Referenz: Bundeslebensmittelschlüssel BLS 4.0, Max Rubner-Institut 2025, CC BY 4.0. Zubereitung und konkrete Produkte können abweichen.';
  }
  return 'Produktdaten: Open Food Facts (gemeinschaftlich gepflegte Daten, ODbL). Angaben können unvollständig oder fehlerhaft sein.';
}
