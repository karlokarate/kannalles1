import { useEffect, useState, type ChangeEvent } from 'react';
import './QuantityStepper.css';

interface QuantityStepperProps {
  readonly value: number;
  readonly onChange: (value: number) => void;
  readonly ariaLabel: string;
  readonly min?: number;
  readonly max?: number;
  readonly inputStep?: number | 'any';
  readonly buttonStep?: number;
  readonly testId?: string;
}

function valid(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}

export function QuantityStepper({
  value,
  onChange,
  ariaLabel,
  min = 0.01,
  max = 10_000,
  inputStep = 'any',
  buttonStep = 1,
  testId
}: QuantityStepperProps) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = (next: number) => {
    const clamped = Math.min(max, Math.max(min, next));
    const normalized = Number(clamped.toFixed(6));
    setDraft(String(normalized));
    onChange(normalized);
  };

  const step = (direction: 1 | -1) => {
    const parsed = Number(draft);
    commit((valid(parsed, min, max) ? parsed : value) + direction * buttonStep);
  };

  const change = (event: ChangeEvent<HTMLInputElement>) => {
    const nextDraft = event.target.value;
    setDraft(nextDraft);
    if (nextDraft === '') return;
    const parsed = Number(nextDraft);
    if (valid(parsed, min, max)) onChange(parsed);
  };

  return <div className="quantity-stepper" data-testid={testId ? `${testId}-stepper` : undefined}>
    <button type="button" className="quantity-stepper__button" onClick={() => step(1)} disabled={value >= max} aria-label={`${ariaLabel} um 1 erhöhen`} data-testid={testId ? `${testId}-increment` : undefined}>+</button>
    <input type="number" min={min} max={max} step={inputStep} value={draft} aria-label={ariaLabel} onChange={change} onBlur={() => { const parsed = Number(draft); if (!valid(parsed, min, max)) setDraft(String(value)); }} data-testid={testId} />
    <button type="button" className="quantity-stepper__button" onClick={() => step(-1)} disabled={value <= min} aria-label={`${ariaLabel} um 1 verringern`} data-testid={testId ? `${testId}-decrement` : undefined}>−</button>
  </div>;
}
