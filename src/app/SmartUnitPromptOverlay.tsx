import type { ChangeEvent } from 'react';
import type { SmartUnitPrompt } from '../lib/smartUnitPrompt';
import type { SmartCatalogController } from './useSmartCatalogController';
import '../smart-unit-prompts.css';

interface PromptCardProps {
  prompt: SmartUnitPrompt;
  testId: string;
  onChange: (value: string) => void;
  onConfirm: () => void;
  valid: boolean;
}

function unitLabel(prompt: SmartUnitPrompt): string {
  if (prompt.unit === 'bar') return 'Riegel';
  if (prompt.unit === 'slice') return 'Scheibe';
  if (prompt.unit === 'portion') return 'Portion';
  return 'Stück';
}

function PromptCard({ prompt, testId, onChange, onConfirm, valid }: PromptCardProps) {
  const label = unitLabel(prompt);
  const inputLabel = prompt.mode === 'whole-split'
    ? `${prompt.productName}: Anzahl Pizzastücke`
    : `${prompt.productName}: Gramm je ${label}`;
  return (
    <article
      className="smart-unit-prompt-card"
      data-testid={testId}
      data-prompt-mode={prompt.mode}
      data-default-value={prompt.defaultValue ?? ''}
      data-unit-kind={prompt.unit}
      data-base-value-g={prompt.baseValueG ?? ''}
    >
      <div className="smart-unit-prompt-card__copy">
        <span className="eyebrow">Einheitengröße prüfen</span>
        <h3>{prompt.productName}</h3>
        <strong>{prompt.question}</strong>
        <p>{prompt.explanation}</p>
      </div>
      <label className="field smart-unit-prompt-card__field">
        <span>{prompt.mode === 'whole-split' ? 'Stücke der ganzen Pizza' : `Gramm je ${label}`}</span>
        <input
          type="number"
          inputMode="decimal"
          min="0.01"
          step={prompt.mode === 'whole-split' ? '1' : 'any'}
          value={prompt.value}
          onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
          aria-label={inputLabel}
          data-testid={`${testId}-input`}
        />
      </label>
      <button
        type="button"
        className="button button--primary smart-unit-prompt-card__confirm"
        disabled={!valid}
        onClick={onConfirm}
        data-testid={`${testId}-confirm`}
      >
        Größe übernehmen
      </button>
    </article>
  );
}

export function SmartUnitPromptOverlay({ c }: { c: SmartCatalogController }) {
  const mealPrompts = c.mealItems.filter((item) => item.smartUnitPrompt !== null);
  const promptCount = (c.smartUnitPrompt ? 1 : 0) + mealPrompts.length + c.pendingSmartUnitItems.length;
  if (promptCount === 0) return null;

  return (
    <aside className="smart-unit-overlay" aria-labelledby="smart-unit-overlay-title" data-testid="smart-unit-overlay">
      <header className="smart-unit-overlay__header">
        <div>
          <span className="eyebrow">Nur wenn erforderlich</span>
          <h2 id="smart-unit-overlay-title">Einheitengröße bestätigen</h2>
          <p>Vorhandene Hersteller-, Stück-, Riegel- oder Serving-Angaben werden automatisch verwendet und hier nicht erneut abgefragt.</p>
        </div>
        <span className="smart-unit-overlay__count">{promptCount}</span>
      </header>

      <div className="smart-unit-overlay__list">
        {c.smartUnitPrompt && (
          <PromptCard
            prompt={c.smartUnitPrompt}
            testId="catalog-smart-unit-prompt"
            onChange={c.setCurrentSmartUnitPromptValue}
            onConfirm={c.confirmCurrentSmartUnitPrompt}
            valid={c.promptIsValid(c.smartUnitPrompt)}
          />
        )}

        {mealPrompts.map((item) => (
          <PromptCard
            key={`meal-${item.id}`}
            prompt={item.smartUnitPrompt!}
            testId={`meal-smart-unit-${item.id}`}
            onChange={(value) => c.updateMealItemSmartUnit(item.id, value)}
            onConfirm={() => c.confirmMealItemSmartUnit(item.id)}
            valid={c.promptIsValid(item.smartUnitPrompt!)}
          />
        ))}

        {c.pendingSmartUnitItems.map((item) => (
          <PromptCard
            key={`pending-${item.id}`}
            prompt={item.prompt}
            testId={`pending-smart-unit-${item.id}`}
            onChange={(value) => c.updatePendingSmartUnit(item.id, value)}
            onConfirm={() => c.confirmPendingSmartUnit(item.id)}
            valid={c.promptIsValid(item.prompt)}
          />
        ))}
      </div>
      {c.smartUnitMessage && <p className="inline-message smart-unit-overlay__message" role="status">{c.smartUnitMessage}</p>}
    </aside>
  );
}
