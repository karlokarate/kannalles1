import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { activeDiabetesFactors, activeInsulinFromClockTime, calculateBolus } from '../lib/diabetesProfile';
import type { OfflineAppSettings } from '../lib/settings';
import '../diabetes-quick-access.css';

interface DiabetesBolusPanelProps {
  settings: OfflineAppSettings;
  carbohydratesG: number | null;
  currentGlucose: string;
  onCurrentGlucoseChange: (value: string) => void;
  lastBolusTime: string;
  lastBolusUnits: string;
  onLastBolusTimeChange: (value: string) => void;
  onLastBolusUnitsChange: (value: string) => void;
  focusRequest?: number;
}

function dose(value: number | null, signed = false): string {
  if (value === null || !Number.isFinite(value)) return '–';
  const prefix = signed && value > 0 ? '+' : '';
  return `${prefix}${value.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} E`;
}

function optionalBolusUnits(value: string): number | null {
  const parsed = Number(value.replace(',', '.'));
  return value !== '' && Number.isFinite(parsed) && parsed > 0 && parsed <= 100 ? parsed : null;
}

export function DiabetesBolusPanel({ settings, carbohydratesG, currentGlucose, onCurrentGlucoseChange, lastBolusTime, lastBolusUnits, onLastBolusTimeChange, onLastBolusUnitsChange, focusRequest = 0 }: DiabetesBolusPanelProps) {
  const [now, setNow] = useState(() => new Date());
  const [detailsOpen, setDetailsOpen] = useState(false);
  const glucoseInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (focusRequest <= 0) return;
    const frame = requestAnimationFrame(() => { glucoseInputRef.current?.focus(); glucoseInputRef.current?.select(); });
    return () => cancelAnimationFrame(frame);
  }, [focusRequest]);
  const factors = activeDiabetesFactors(settings.diabetesFactorSegments, now);
  const parsedGlucose = Number(currentGlucose);
  const glucose = currentGlucose !== '' && Number.isFinite(parsedGlucose) && parsedGlucose >= 20 && parsedGlucose <= 600 ? parsedGlucose : null;
  const bolusUnits = optionalBolusUnits(lastBolusUnits);
  const activeInsulin = settings.manualBolusTrackingEnabled && bolusUnits !== null
    ? activeInsulinFromClockTime(lastBolusTime, bolusUnits, settings.insulinActivityDurationHours, now)
    : null;
  const result = calculateBolus(carbohydratesG, glucose, factors, activeInsulin?.units ?? 0);
  const configured = factors.carbohydrateRatioG !== null && factors.correctionFactorMgDl !== null && factors.targetGlucoseMgDl !== null;
  const bolusEntryStarted = lastBolusTime !== '' || lastBolusUnits !== '';

  return (
    <section className="diabetes-bolus-panel" aria-label="Diabetiker-Bolus-Rechenhilfe" data-testid="diabetes-bolus-panel" data-collapsed={String(!detailsOpen)}>
      <div className="diabetes-quick-access" data-testid="diabetes-quick-access">
        <label className="field diabetes-glucose-input"><span>Aktueller Blutzucker</span><span className="input-with-unit"><input ref={glucoseInputRef} type="number" min="20" max="600" step="1" inputMode="decimal" enterKeyHint="done" value={currentGlucose} onChange={(event: ChangeEvent<HTMLInputElement>) => onCurrentGlucoseChange(event.target.value)} placeholder="Wert eingeben" data-testid="current-glucose-input" /><b>mg/dL</b></span></label>
        <output className="diabetes-total-bolus" aria-live="polite" data-testid="quick-total-bolus" data-calculation-ready={String(result.totalBolus !== null)}>
          <span>Gesamtbolus</span>
          <strong>{dose(result.totalBolus)}</strong>
          <small>Aktuell berechnet</small>
        </output>
      </div>
      <details className="calibration-card diabetes-bolus-details" open={detailsOpen} onToggle={(event) => setDetailsOpen(event.currentTarget.open)} data-testid="diabetes-bolus-details">
        <summary data-testid="diabetes-bolus-toggle"><span><span className="eyebrow">Aktives Diabetikerprofil</span><strong>Bolus-Rechenhilfe</strong></span><small>{detailsOpen ? 'Details einklappen' : 'Details aufklappen'}</small></summary>
        <div className="calibration-card__body">
          {settings.manualBolusTrackingEnabled && <section className="pen-bolus-entry" aria-labelledby="pen-bolus-title" data-testid="pen-bolus-entry">
            <header><div><span className="eyebrow">Optional für Pen-Nutzung</span><h3 id="pen-bolus-title">Letzter Bolus</h3></div>{bolusEntryStarted && <button type="button" className="button button--ghost" onClick={() => { onLastBolusTimeChange(''); onLastBolusUnitsChange(''); }}>Löschen</button>}</header>
            <div className="pen-bolus-inputs">
              <label className="field"><span>Uhrzeit</span><input type="time" value={lastBolusTime} onChange={(event) => onLastBolusTimeChange(event.target.value)} data-testid="last-bolus-time" /></label>
              <label className="field"><span>Insulinmenge</span><span className="input-with-unit"><input type="text" inputMode="decimal" enterKeyHint="done" autoComplete="off" pattern="[0-9]*[.,]?[0-9]*" value={lastBolusUnits} onChange={(event) => onLastBolusUnitsChange(event.target.value)} placeholder="z. B. 4,5" aria-invalid={lastBolusUnits !== '' && bolusUnits === null} data-testid="last-bolus-units" /><b>E</b></span></label>
            </div>
            {!bolusEntryStarted && <small>Uhrzeit und Insulineinheiten eintragen, wenn ein vorheriger Bolus noch wirken könnte.</small>}
            {bolusEntryStarted && activeInsulin === null && <p className="inline-message">Bitte eine gültige Uhrzeit und eine Insulinmenge zwischen 0 und 100 E eingeben.</p>}
            {activeInsulin && <p className="inline-message" data-testid="active-insulin-summary">Von {bolusUnits?.toLocaleString('de-DE')} E sind nach {activeInsulin.elapsedHours.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} Stunden rechnerisch noch {activeInsulin.units.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} E aktiv.</p>}
            <small>Erfasst nur diesen letzten Bolus. Frühere Bolusgaben, Basalinsulin, Bewegung, Krankheit und Glukosetrends sind nicht enthalten.</small>
          </section>}
          {!configured && <p className="inline-message">Für die aktuell aktiven Zeitsegmente fehlen persönliche Werte. Bitte KH-Verhältnis, Korrekturfaktor und Zielwert in den Einstellungen eintragen.</p>}
          <dl className="bolus-values">
            <div><dt>KH-Bolus</dt><dd data-testid="carbohydrate-bolus">{dose(result.carbohydrateBolus)}</dd><small>{carbohydratesG === null ? 'Sobald KH berechnet sind' : factors.carbohydrateRatioG === null ? 'KH-Verhältnis fehlt' : `${carbohydratesG.toLocaleString('de-DE')} g KH ÷ ${factors.carbohydrateRatioG.toLocaleString('de-DE')}`}</small></div>
            <div><dt>Korrekturbolus</dt><dd data-testid="correction-bolus">{dose(result.correctionBolus, true)}</dd><small>{glucose === null ? 'Blutzucker eingeben' : factors.correctionFactorMgDl === null || factors.targetGlucoseMgDl === null ? 'Korrekturfaktor oder Zielwert fehlt' : `(${glucose.toLocaleString('de-DE')} − ${factors.targetGlucoseMgDl.toLocaleString('de-DE')}) ÷ ${factors.correctionFactorMgDl.toLocaleString('de-DE')}`}</small></div>
            {settings.manualBolusTrackingEnabled && <div><dt>Laufendes Insulin</dt><dd data-testid="active-insulin">{activeInsulin ? `−${dose(activeInsulin.units)}` : '–'}</dd><small>{activeInsulin ? `${(activeInsulin.fraction * 100).toLocaleString('de-DE', { maximumFractionDigits: 0 })} % des letzten Bolus · ${settings.insulinActivityDurationHours.toLocaleString('de-DE')} h Wirkdauer` : 'Letzten Bolus vollständig eingeben'}</small></div>}
            <div className="bolus-values__total"><dt>{activeInsulin ? 'Gesamt nach laufendem Insulin' : 'Gesamtbolus'}</dt><dd data-testid="total-bolus">{dose(result.totalBolus)}</dd><small>{activeInsulin && result.unadjustedTotalBolus !== null ? `Vor Abzug: ${dose(result.unadjustedTotalBolus)}` : 'Nie kleiner als 0 E; auf eine Nachkommastelle angezeigt'}</small></div>
          </dl>
          {result.correctionBolus !== null && result.correctionBolus < 0 && <p className="bolus-subtraction">Der negative Korrekturwert wird vom KH-Bolus abgezogen. Ohne KH-Bolus wird keine negative Dosis vorgeschlagen.</p>}
          {activeInsulin && <p className="bolus-subtraction">Das geschätzte laufende Insulin wird vom bisherigen Gesamtwert abgezogen, um eine zusätzliche Bolusgabe nicht unbemerkt zu stapeln.</p>}
          <p className="medical-disclaimer">Rechenhilfe, keine Dosierfreigabe. Laufendes Insulin wird nur aus der manuell erfassten letzten Bolusgabe geschätzt. Ergebnis vor jeder Anwendung mit dem persönlichen Therapieplan prüfen.</p>
        </div>
      </details>
    </section>
  );
}
