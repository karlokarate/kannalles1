import { useEffect, useState, type ChangeEvent } from 'react';
import { activeDiabetesSegment, calculateBolus, minuteToTimeInput } from '../lib/diabetesProfile';
import type { OfflineAppSettings } from '../lib/settings';

interface DiabetesBolusPanelProps {
  settings: OfflineAppSettings;
  carbohydratesG: number | null;
  currentGlucose: string;
  onCurrentGlucoseChange: (value: string) => void;
}

function dose(value: number | null, signed = false): string {
  if (value === null || !Number.isFinite(value)) return '–';
  const prefix = signed && value > 0 ? '+' : '';
  return `${prefix}${value.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} E`;
}

export function DiabetesBolusPanel({ settings, carbohydratesG, currentGlucose, onCurrentGlucoseChange }: DiabetesBolusPanelProps) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const segment = activeDiabetesSegment(settings.diabetesSegments, now);
  const parsedGlucose = Number(currentGlucose);
  const glucose = currentGlucose !== '' && Number.isFinite(parsedGlucose) && parsedGlucose >= 20 && parsedGlucose <= 600 ? parsedGlucose : null;
  const result = calculateBolus(carbohydratesG, glucose, segment);
  const configured = segment.carbohydrateRatioG !== null && segment.correctionFactorMgDl !== null && segment.targetGlucoseMgDl !== null;

  return (
    <section className="diabetes-bolus-panel" aria-labelledby="diabetes-bolus-title" data-testid="diabetes-bolus-panel">
      <div className="section-title-row"><div><span className="eyebrow">Aktives Diabetikerprofil</span><h2 id="diabetes-bolus-title">Bolus-Rechenhilfe</h2></div><span>{minuteToTimeInput(segment.startMinute)}–{minuteToTimeInput(segment.endMinute)} Uhr</span></div>
      <label className="field diabetes-glucose-input"><span>Aktueller Blutzucker</span><span className="input-with-unit"><input type="number" min="20" max="600" step="1" inputMode="numeric" value={currentGlucose} onChange={(event: ChangeEvent<HTMLInputElement>) => onCurrentGlucoseChange(event.target.value)} placeholder="Wert eingeben" data-testid="current-glucose-input" /><b>mg/dL</b></span></label>
      {!configured && <p className="inline-message">Für das aktuelle Zeitsegment fehlen persönliche Werte. Bitte KH-Verhältnis, Korrekturfaktor und Zielwert in den Einstellungen eintragen.</p>}
      <dl className="bolus-values">
        <div><dt>KH-Bolus</dt><dd data-testid="carbohydrate-bolus">{dose(result.carbohydrateBolus)}</dd><small>{carbohydratesG === null ? 'Sobald KH berechnet sind' : segment.carbohydrateRatioG === null ? 'KH-Verhältnis fehlt' : `${carbohydratesG.toLocaleString('de-DE')} g KH ÷ ${segment.carbohydrateRatioG.toLocaleString('de-DE')}`}</small></div>
        <div><dt>Korrekturbolus</dt><dd data-testid="correction-bolus">{dose(result.correctionBolus, true)}</dd><small>{glucose === null ? 'Blutzucker eingeben' : segment.correctionFactorMgDl === null || segment.targetGlucoseMgDl === null ? 'Korrekturfaktor oder Zielwert fehlt' : `(${glucose.toLocaleString('de-DE')} − ${segment.targetGlucoseMgDl.toLocaleString('de-DE')}) ÷ ${segment.correctionFactorMgDl.toLocaleString('de-DE')}`}</small></div>
        <div className="bolus-values__total"><dt>Gesamtbolus</dt><dd data-testid="total-bolus">{dose(result.totalBolus)}</dd><small>Nie kleiner als 0 E; auf eine Nachkommastelle angezeigt</small></div>
      </dl>
      {result.correctionBolus !== null && result.correctionBolus < 0 && <p className="bolus-subtraction">Der negative Korrekturwert wird vom KH-Bolus abgezogen. Ohne KH-Bolus wird keine negative Dosis vorgeschlagen.</p>}
      <p className="medical-disclaimer">Rechenhilfe, keine Dosierfreigabe. Aktives Insulin und weitere Therapieeinflüsse werden nicht berücksichtigt. Ergebnis vor jeder Anwendung mit dem persönlichen Therapieplan prüfen.</p>
    </section>
  );
}
