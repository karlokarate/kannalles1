import { useEffect, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import { addDiabetesSegment, changeSegmentBoundary, minuteToTimeInput, removeDiabetesSegment, timeInputToMinute } from '../lib/diabetesProfile';
import type { DiabetesTimeSegment } from '../lib/diabetesProfile';

interface DiabetesSettingsProps {
  enabled: boolean;
  segments: DiabetesTimeSegment[];
  onEnabledChange: (enabled: boolean) => void;
  onSegmentsChange: (segments: DiabetesTimeSegment[]) => void;
}

type FactorKey = 'carbohydrateRatioG' | 'correctionFactorMgDl' | 'targetGlucoseMgDl';

interface FactorDefinition {
  key: FactorKey;
  title: string;
  description: string;
  fieldLabel: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  placeholder: string;
  testId: string;
}

const FACTORS: readonly FactorDefinition[] = [
  { key: 'carbohydrateRatioG', title: 'KH-Verhältnis', description: 'Wie viele Gramm KH deckt eine Einheit Insulin?', fieldLabel: '1 Einheit Insulin reicht für', unit: 'g KH', min: 1, max: 150, step: 0.1, placeholder: 'z. B. 10', testId: 'carbohydrate-ratio-input' },
  { key: 'correctionFactorMgDl', title: 'Korrekturfaktor', description: 'Um wie viel mg/dL senkt eine Einheit Insulin?', fieldLabel: '1 Einheit Insulin senkt um', unit: 'mg/dL', min: 1, max: 400, step: 1, placeholder: 'z. B. 50', testId: 'correction-factor-input' },
  { key: 'targetGlucoseMgDl', title: 'Zielwert', description: 'Welcher persönliche Blutzucker-Zielwert gilt?', fieldLabel: 'Persönlicher Zielblutzucker', unit: 'mg/dL', min: 40, max: 300, step: 1, placeholder: 'Vom Behandlungsteam', testId: 'target-glucose-input' }
] as const;

function optionalNumber(value: string, min: number, max: number): number | null | undefined {
  if (value === '') return null;
  const number = Number(value.replace(',', '.'));
  return Number.isFinite(number) && number >= min && number <= max ? number : undefined;
}

interface EditableNumberFieldProps {
  id: string;
  label: string;
  unit: string;
  value: number | null;
  min: number;
  max: number;
  step: number;
  placeholder: string;
  testId: string;
  advanceLabel: string;
  onValueChange: (value: number | null) => void;
  onAdvance: () => void;
}

function EditableNumberField({ id, label, unit, value, min, max, step, placeholder, testId, advanceLabel, onValueChange, onAdvance }: EditableNumberFieldProps) {
  const [draft, setDraft] = useState(value === null ? '' : String(value));

  useEffect(() => {
    setDraft((current) => optionalNumber(current, min, max) === value ? current : value === null ? '' : String(value));
  }, [max, min, value]);

  const parsed = optionalNumber(draft, min, max);
  const invalid = parsed === undefined;
  const advance = () => { if (!invalid) onAdvance(); };
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => { if (event.key === 'Enter') { event.preventDefault(); advance(); } };
  const handleChange = (raw: string) => {
    setDraft(raw);
    const next = optionalNumber(raw, min, max);
    if (next !== undefined) onValueChange(next);
  };
  const handleBlur = () => { if (invalid) setDraft(value === null ? '' : String(value)); };

  return <div className="field factor-value-field">
    <label htmlFor={id}>{label}</label>
    <span className="input-with-unit"><input id={id} type="text" inputMode="decimal" enterKeyHint={advanceLabel === 'Fertig' ? 'done' : 'next'} autoComplete="off" pattern="[0-9]*[.,]?[0-9]*" data-step={step} value={draft} onChange={(event) => handleChange(event.target.value)} onKeyDown={handleKeyDown} onBlur={handleBlur} placeholder={placeholder} data-testid={testId} aria-invalid={invalid} aria-describedby={`${id}-range`} /><b>{unit}</b></span>
    <small id={`${id}-range`} className="factor-input-range">Erlaubt: {min.toLocaleString('de-DE')} bis {max.toLocaleString('de-DE')}</small>
    <button type="button" className="button button--secondary factor-next-button" onClick={advance} disabled={invalid}>{advanceLabel}</button>
  </div>;
}

function FactorGroup({ definition, segments, defaultOpen, onSegmentsChange }: { definition: FactorDefinition; segments: DiabetesTimeSegment[]; defaultOpen: boolean; onSegmentsChange: (segments: DiabetesTimeSegment[]) => void }) {
  const [open, setOpen] = useState(defaultOpen);
  const updateValue = (index: number, value: number | null) => onSegmentsChange(segments.map((segment, current) => current === index ? { ...segment, [definition.key]: value } : segment));
  const updateBoundary = (boundaryIndex: number, event: ChangeEvent<HTMLInputElement>) => {
    const minute = timeInputToMinute(event.target.value);
    if (minute !== null) onSegmentsChange(changeSegmentBoundary(segments, boundaryIndex, minute));
  };
  const advance = (index: number) => {
    const next = document.getElementById(`${definition.key}-${index + 1}`) as HTMLInputElement | null;
    if (next) { next.focus(); next.select(); }
    else (document.activeElement as HTMLElement | null)?.blur();
  };
  const configured = segments.filter((segment) => segment[definition.key] !== null).length;

  return <details className="diabetes-factor-group" open={open} onToggle={(event) => setOpen(event.currentTarget.open)} data-testid={`diabetes-factor-${definition.key}`}>
    <summary><span><strong>{definition.title}</strong><small>{definition.description}</small></span><span>{configured}/{segments.length} gesetzt</span></summary>
    <div className="diabetes-factor-body">
      <div className="diabetes-segment-list">{segments.map((segment, index) => <article className="diabetes-segment diabetes-segment--factor" key={segment.id} data-testid="diabetes-segment">
        <header><strong>Segment {index + 1}</strong><span>{minuteToTimeInput(segment.startMinute)}–{minuteToTimeInput(segment.endMinute)} Uhr</span></header>
        <div className="diabetes-factor-grid">
          {index === 0 ? <div className="field"><span>Von</span><output>00:00</output></div> : <label className="field"><span>Von</span><input type="time" aria-label={`${definition.title}, Segment ${index + 1}: von`} value={minuteToTimeInput(segment.startMinute)} min={minuteToTimeInput(segments[index - 1].startMinute + 1)} max={minuteToTimeInput(segment.endMinute - 1)} onChange={(event) => updateBoundary(index, event)} /></label>}
          {index === segments.length - 1 ? <div className="field"><span>Bis</span><output>24:00</output></div> : <label className="field"><span>Bis</span><input type="time" aria-label={`${definition.title}, Segment ${index + 1}: bis`} value={minuteToTimeInput(segment.endMinute)} min={minuteToTimeInput(segment.startMinute + 1)} max={minuteToTimeInput(segments[index + 1].endMinute - 1)} onChange={(event) => updateBoundary(index + 1, event)} /></label>}
          <EditableNumberField id={`${definition.key}-${index}`} label={definition.fieldLabel} unit={definition.unit} value={segment[definition.key]} min={definition.min} max={definition.max} step={definition.step} placeholder={definition.placeholder} testId={definition.testId} advanceLabel={index < segments.length - 1 ? 'Weiter →' : 'Fertig'} onValueChange={(value) => updateValue(index, value)} onAdvance={() => advance(index)} />
          {segments.length > 1 && <button type="button" className="button button--ghost factor-remove-button" onClick={() => onSegmentsChange(removeDiabetesSegment(segments, index))}>Segment entfernen</button>}
        </div>
      </article>)}</div>
      <button type="button" className="button button--secondary" disabled={segments.length >= 12} onClick={() => onSegmentsChange(addDiabetesSegment(segments))}>Zeitsegment hinzufügen</button>
    </div>
  </details>;
}

export function DiabetesSettings({ enabled, segments, onEnabledChange, onSegmentsChange }: DiabetesSettingsProps) {
  return <fieldset className="settings-card settings-card--wide diabetes-settings" data-testid="diabetes-settings">
    <legend>Diabetikerprofil</legend>
    <label className="switch-row"><span><strong>Bolus-Rechenhilfe aktivieren</strong><small>Zeigt KH-, Korrektur- und Gesamtbolus auf dem Rechner.</small></span><input type="checkbox" checked={enabled} onChange={(event) => onEnabledChange(event.target.checked)} data-testid="diabetes-profile-toggle" /></label>
    <p className="settings-note diabetes-warning"><strong>Wichtig:</strong> Nur mit den persönlichen, vom Behandlungsteam festgelegten Werten verwenden. Die Rechenhilfe berücksichtigt kein aktives Insulin, keine Trendpfeile, Bewegung, Krankheit oder verzögerte Mahlzeitenwirkung und gibt keine Insulindosis frei.</p>
    <div className="section-title-row"><div><span className="eyebrow">Getrennt und übersichtlich</span><h2>Faktoren nach Zeitsegment</h2></div><span>{segments.length} Segmente</span></div>
    <p className="settings-note">Enter oder „Weiter“ übernimmt den Wert und springt zum nächsten Zeitsegment derselben Faktorgruppe. Geänderte Zeitgrenzen gelten synchron für alle drei Gruppen.</p>
    <div className="diabetes-factor-list">{FACTORS.map((definition, index) => <FactorGroup key={definition.key} definition={definition} segments={segments} defaultOpen={index === 0} onSegmentsChange={onSegmentsChange} />)}</div>
  </fieldset>;
}
