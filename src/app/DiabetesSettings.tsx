import type { ChangeEvent } from 'react';
import { addDiabetesSegment, changeSegmentBoundary, minuteToTimeInput, removeDiabetesSegment, timeInputToMinute } from '../lib/diabetesProfile';
import type { DiabetesTimeSegment } from '../lib/diabetesProfile';

interface DiabetesSettingsProps {
  enabled: boolean;
  segments: DiabetesTimeSegment[];
  onEnabledChange: (enabled: boolean) => void;
  onSegmentsChange: (segments: DiabetesTimeSegment[]) => void;
}

function optionalNumber(value: string, min: number, max: number): number | null | undefined {
  if (value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : undefined;
}

export function DiabetesSettings({ enabled, segments, onEnabledChange, onSegmentsChange }: DiabetesSettingsProps) {
  const updateValue = (index: number, key: 'carbohydrateRatioG' | 'correctionFactorMgDl' | 'targetGlucoseMgDl', raw: string, min: number, max: number) => {
    const value = optionalNumber(raw, min, max);
    if (value === undefined) return;
    onSegmentsChange(segments.map((segment, current) => current === index ? { ...segment, [key]: value } : segment));
  };
  const updateBoundary = (boundaryIndex: number, event: ChangeEvent<HTMLInputElement>) => {
    const minute = timeInputToMinute(event.target.value);
    if (minute !== null) onSegmentsChange(changeSegmentBoundary(segments, boundaryIndex, minute));
  };

  return (
    <fieldset className="settings-card settings-card--wide diabetes-settings" data-testid="diabetes-settings">
      <legend>Diabetikerprofil</legend>
      <label className="switch-row"><span><strong>Bolus-Rechenhilfe aktivieren</strong><small>Zeigt KH-, Korrektur- und Gesamtbolus auf dem Rechner.</small></span><input type="checkbox" checked={enabled} onChange={(event) => onEnabledChange(event.target.checked)} data-testid="diabetes-profile-toggle" /></label>
      <p className="settings-note diabetes-warning"><strong>Wichtig:</strong> Nur mit den persönlichen, vom Behandlungsteam festgelegten Werten verwenden. Die Rechenhilfe berücksichtigt kein aktives Insulin, keine Trendpfeile, Bewegung, Krankheit oder verzögerte Mahlzeitenwirkung und gibt keine Insulindosis frei.</p>
      <div className="section-title-row"><div><span className="eyebrow">24 Stunden ohne Überschneidung</span><h2>Zeitsegmente</h2></div><span>{segments.length} Segmente</span></div>
      <div className="diabetes-segment-list">
        {segments.map((segment, index) => <article className="diabetes-segment" key={segment.id} data-testid="diabetes-segment">
          <header><strong>Segment {index + 1}</strong>{segments.length > 1 && <button type="button" className="button button--ghost" onClick={() => onSegmentsChange(removeDiabetesSegment(segments, index))}>Entfernen</button>}</header>
          <div className="diabetes-segment-grid">
            {index === 0 ? <div className="field"><span>Von</span><output>00:00</output></div> : <label className="field"><span>Von</span><input type="time" value={minuteToTimeInput(segment.startMinute)} min={minuteToTimeInput(segments[index - 1].startMinute + 1)} max={minuteToTimeInput(segment.endMinute - 1)} onChange={(event) => updateBoundary(index, event)} /></label>}
            {index === segments.length - 1 ? <div className="field"><span>Bis</span><output>24:00</output></div> : <label className="field"><span>Bis</span><input type="time" value={minuteToTimeInput(segment.endMinute)} min={minuteToTimeInput(segment.startMinute + 1)} max={minuteToTimeInput(segments[index + 1].endMinute - 1)} onChange={(event) => updateBoundary(index + 1, event)} /></label>}
            <label className="field"><span>1 Einheit Insulin reicht für</span><span className="input-with-unit"><input type="number" min="1" max="150" step="0.1" value={segment.carbohydrateRatioG ?? ''} onChange={(event) => updateValue(index, 'carbohydrateRatioG', event.target.value, 1, 150)} placeholder="z. B. 10" data-testid="carbohydrate-ratio-input" /><b>g KH</b></span></label>
            <label className="field"><span>1 Einheit Insulin senkt um</span><span className="input-with-unit"><input type="number" min="1" max="400" step="1" value={segment.correctionFactorMgDl ?? ''} onChange={(event) => updateValue(index, 'correctionFactorMgDl', event.target.value, 1, 400)} placeholder="z. B. 50" data-testid="correction-factor-input" /><b>mg/dL</b></span></label>
            <label className="field"><span>Persönlicher Zielblutzucker</span><span className="input-with-unit"><input type="number" min="40" max="300" step="1" value={segment.targetGlucoseMgDl ?? ''} onChange={(event) => updateValue(index, 'targetGlucoseMgDl', event.target.value, 40, 300)} placeholder="Vom Behandlungsteam" data-testid="target-glucose-input" /><b>mg/dL</b></span></label>
          </div>
        </article>)}
      </div>
      <div className="button-row"><button type="button" className="button button--secondary" disabled={segments.length >= 12} onClick={() => onSegmentsChange(addDiabetesSegment(segments))}>Zeitsegment hinzufügen</button></div>
    </fieldset>
  );
}
