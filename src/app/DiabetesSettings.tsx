import { useEffect, useState } from 'react';
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

interface EditableNumberFieldProps {
  label: string;
  unit: string;
  value: number | null;
  min: number;
  max: number;
  step: number;
  placeholder: string;
  testId: string;
  onValueChange: (value: number | null) => void;
}

function EditableNumberField({ label, unit, value, min, max, step, placeholder, testId, onValueChange }: EditableNumberFieldProps) {
  const [draft, setDraft] = useState(value === null ? '' : String(value));

  useEffect(() => {
    setDraft(value === null ? '' : String(value));
  }, [value]);

  const parsed = optionalNumber(draft, min, max);
  const invalid = parsed === undefined;

  const handleChange = (raw: string) => {
    setDraft(raw);
    const next = optionalNumber(raw, min, max);
    if (next !== undefined) onValueChange(next);
  };

  const handleBlur = () => {
    if (optionalNumber(draft, min, max) === undefined) {
      setDraft(value === null ? '' : String(value));
    }
  };

  return (
    <label className="field">
      <span>{label}</span>
      <span className="input-with-unit">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={draft}
          onChange={(event) => handleChange(event.target.value)}
          onBlur={handleBlur}
          placeholder={placeholder}
          data-testid={testId}
          aria-invalid={invalid}
        />
        <b>{unit}</b>
      </span>
    </label>
  );
}

export function DiabetesSettings({ enabled, segments, onEnabledChange, onSegmentsChange }: DiabetesSettingsProps) {
  const updateValue = (index: number, key: 'carbohydrateRatioG' | 'correctionFactorMgDl' | 'targetGlucoseMgDl', value: number | null) => {
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
            <EditableNumberField label="1 Einheit Insulin reicht für" unit="g KH" value={segment.carbohydrateRatioG} min={1} max={150} step={0.1} placeholder="z. B. 10" testId="carbohydrate-ratio-input" onValueChange={(value) => updateValue(index, 'carbohydrateRatioG', value)} />
            <EditableNumberField label="1 Einheit Insulin senkt um" unit="mg/dL" value={segment.correctionFactorMgDl} min={1} max={400} step={1} placeholder="z. B. 50" testId="correction-factor-input" onValueChange={(value) => updateValue(index, 'correctionFactorMgDl', value)} />
            <EditableNumberField label="Persönlicher Zielblutzucker" unit="mg/dL" value={segment.targetGlucoseMgDl} min={40} max={300} step={1} placeholder="Vom Behandlungsteam" testId="target-glucose-input" onValueChange={(value) => updateValue(index, 'targetGlucoseMgDl', value)} />
          </div>
        </article>)}
      </div>
      <div className="button-row"><button type="button" className="button button--secondary" disabled={segments.length >= 12} onClick={() => onSegmentsChange(addDiabetesSegment(segments))}>Zeitsegment hinzufügen</button></div>
    </fieldset>
  );
}
