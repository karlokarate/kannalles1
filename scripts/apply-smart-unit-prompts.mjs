import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

function write(relative, content) {
  fs.writeFileSync(path.join(root, relative), content);
}

function replaceOnce(relative, before, after) {
  const current = read(relative);
  if (current.includes(after)) return;
  if (!current.includes(before)) throw new Error(`Patch anchor missing in ${relative}: ${before.slice(0, 100)}`);
  write(relative, current.replace(before, after));
}

function appendOnce(relative, marker, addition) {
  const current = read(relative);
  if (current.includes(marker)) return;
  write(relative, `${current.trimEnd()}\n\n${addition.trim()}\n`);
}

replaceOnce(
  'src/lib/resolution/catalogResolution.ts',
  "  | 'direct_volume'\n  | 'unresolved';",
  "  | 'direct_volume'\n  | 'app_default'\n  | 'unresolved';"
);
replaceOnce(
  'src/lib/resolution/catalogResolution.ts',
  "  direct_volume: 100,\n  unresolved: 5",
  "  direct_volume: 100,\n  app_default: 50,\n  unresolved: 5"
);
replaceOnce(
  'src/app/catalogViewModel.ts',
  "    case 'direct_volume':\n      return 'direct-volume';\n    case 'unresolved':",
  "    case 'direct_volume':\n      return 'direct-volume';\n    case 'app_default':\n      return 'editable-default';\n    case 'unresolved':"
);
replaceOnce(
  'src/session.test.ts',
  "    expect(parseCatalogQuery('2 Scheiben Mehrkornbrot')).toMatchObject({ amount: 2, unit: 'slice', catalogQuery: 'Mehrkornbrot' });",
  "    expect(parseCatalogQuery('2 Scheiben Mehrkornbrot')).toMatchObject({ amount: 2, unit: 'slice', catalogQuery: 'Mehrkornbrot' });\n    expect(parseCatalogQuery('zwei Stücke Pizza')).toMatchObject({ amount: 2, unit: 'piece', catalogQuery: 'Pizza' });"
);

replaceOnce(
  'src/app/useCatalogController.ts',
  "import type { MealCalculationItem } from '../lib/mealCalculation';\nimport { inferredCalibrationUnit, selectDefaultCatalogCandidate } from './catalogViewModel';",
  "import type { MealCalculationItem } from '../lib/mealCalculation';\nimport { resolveSmartUnitState, smartUnitPromptCalibration, updateSmartUnitPromptValue } from '../lib/smartUnitPrompt';\nimport type { SmartUnitPrompt } from '../lib/smartUnitPrompt';\nimport { inferredCalibrationUnit, selectDefaultCatalogCandidate } from './catalogViewModel';"
);
replaceOnce(
  'src/app/useCatalogController.ts',
  `function resolveProductUnits(product: CatalogProduct, request: CatalogUnitRequest) {
  if (isClinicCatalogProduct(product)) {
    const direct = directClinicResolution(product);
    if (direct) return direct;
  }
  const matches = isGenericCatalogProduct(product) || (isClinicCatalogProduct(product) && product.clinic.directCarbohydratesPerUnit !== null) ? [] : productCalibrations(product).map(toMatchingUnitCalibration);
  return resolveCatalogUnits(product, request, matches);
}`,
  `function resolveProductUnitState(product: CatalogProduct, request: CatalogUnitRequest, valueOverride?: string) {
  if (isClinicCatalogProduct(product)) {
    const direct = directClinicResolution(product);
    if (direct) return { resolution: direct, prompt: null };
  }
  const matches = isClinicCatalogProduct(product) && product.clinic.directCarbohydratesPerUnit !== null
    ? []
    : productCalibrations(product).map(toMatchingUnitCalibration);
  return resolveSmartUnitState(product, request, resolveCatalogUnits(product, request, matches), valueOverride);
}
function resolveProductUnits(product: CatalogProduct, request: CatalogUnitRequest) {
  return resolveProductUnitState(product, request).resolution;
}
function smartUnitKey(product: CatalogProduct, prompt: SmartUnitPrompt): string {
  return \`${'${product.productId}:${prompt.unit}'}\`;
}`
);
replaceOnce(
  'src/app/useCatalogController.ts',
  "  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);\n  const [revision, setRevision] = useState(0);",
  "  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);\n  const [smartUnitValues, setSmartUnitValues] = useState<Record<string, string>>({});\n  const [smartUnitMessage, setSmartUnitMessage] = useState<string | null>(null);\n  const [revision, setRevision] = useState(0);"
);
replaceOnce(
  'src/app/useCatalogController.ts',
  `  const resolution = useMemo(() => {
    void revision;
    if (!product) return null;
    return resolveProductUnits(product, request);
  }, [product, request, revision]);`,
  `  const productUnitState = useMemo(() => {
    void revision;
    if (!product) return null;
    const initial = resolveProductUnitState(product, request);
    const override = initial.prompt ? smartUnitValues[smartUnitKey(product, initial.prompt)] : undefined;
    return override === undefined ? initial : resolveProductUnitState(product, request, override);
  }, [product, request, revision, smartUnitValues]);
  const resolution = productUnitState?.resolution ?? null;
  const smartUnitPrompt = productUnitState?.prompt ?? null;`
);
replaceOnce(
  'src/app/useCatalogController.ts',
  `  const changeCalibrationUnit = (unit: CatalogCalibrationUnit) => {
    setCalibrationUnit(unit);
    if (!product) return;
    const saved = findMatchingCatalogCalibrations(identity(product), unit, false)[0];
    setCalibrationCount(saved ? String(saved.measurement.measuredCount) : '10');
    setCalibrationWeight(saved ? String(saved.measurement.measuredTotalWeightG) : '');
    setCalibrationMessage(saved ? 'Persönliche Einheit geladen.' : null);
  };

  const executeProductInput`,
  `  const changeCalibrationUnit = (unit: CatalogCalibrationUnit) => {
    setCalibrationUnit(unit);
    if (!product) return;
    const saved = findMatchingCatalogCalibrations(identity(product), unit, false)[0];
    setCalibrationCount(saved ? String(saved.measurement.measuredCount) : '10');
    setCalibrationWeight(saved ? String(saved.measurement.measuredTotalWeightG) : '');
    setCalibrationMessage(saved ? 'Persönliche Einheit geladen.' : null);
  };

  const persistSmartUnitPrompt = (target: CatalogProduct, prompt: SmartUnitPrompt): boolean => {
    const measurement = smartUnitPromptCalibration(prompt);
    if (!measurement) { setSmartUnitMessage('Bitte einen gültigen positiven Wert eingeben.'); return false; }
    const record = createCatalogCalibration({
      calibrationId: createLocalId('cal'),
      scope: 'catalog-product',
      identity: identity(target),
      unit: prompt.unit,
      measuredCount: measurement.measuredCount,
      measuredTotalWeightG: measurement.measuredTotalWeightG,
      smallestEdibleUnit: prompt.unit !== 'portion',
      now: new Date().toISOString()
    });
    if (!record || !saveCatalogCalibration(record)) { setSmartUnitMessage('Die Einheitengröße konnte nicht gespeichert werden.'); return false; }
    const key = smartUnitKey(target, prompt);
    setSmartUnitValues((current) => { const next = { ...current }; delete next[key]; return next; });
    setSmartUnitMessage(`${prompt.productName}: Einheitengröße gespeichert.`);
    refreshLocalData();
    return true;
  };
  const setCurrentSmartUnitPromptValue = (value: string) => {
    if (!product || !smartUnitPrompt) return;
    setSmartUnitValues((current) => ({ ...current, [smartUnitKey(product, smartUnitPrompt)]: value }));
    setSmartUnitMessage(null);
  };
  const confirmCurrentSmartUnitPrompt = () => { if (product && smartUnitPrompt) persistSmartUnitPrompt(product, smartUnitPrompt); };

  const executeProductInput`
);
replaceOnce(
  'src/app/useCatalogController.ts',
  "          const nextResolution = resolveProductUnits(candidate, nextRequest);\n          item = createMealCalculationItem(createLocalId('meal'), candidate, nextRequest, nextResolution, nextResolution.selectedOptionId);",
  "          const nextState = resolveProductUnitState(candidate, nextRequest);\n          item = createMealCalculationItem(createLocalId('meal'), candidate, nextRequest, nextState.resolution, nextState.resolution.selectedOptionId, nextState.prompt);"
);
replaceOnce(
  'src/app/useCatalogController.ts',
  "      setMealMessage(`${added.length} ${added.length === 1 ? 'Produkt wurde' : 'Produkte wurden'} aus der Eingabe zur Gesamtrechnung hinzugefügt.${failures.length > 0 ? ` Noch zu prüfen: ${failures.join(', ')}.` : ''}`);",
  "      const promptCount = added.filter((item) => item.smartUnitPrompt !== null).length;\n      setMealMessage(`${added.length} ${added.length === 1 ? 'Produkt wurde' : 'Produkte wurden'} aus der Eingabe zur Gesamtrechnung hinzugefügt.${promptCount > 0 ? ` Bitte prüfe ${promptCount === 1 ? 'die vorgeschlagene Einheitengröße' : `die ${promptCount} vorgeschlagenen Einheitengrößen`}.` : ''}${failures.length > 0 ? ` Noch zu prüfen: ${failures.join(', ')}.` : ''}`);"
);
replaceOnce(
  'src/app/useCatalogController.ts',
  "    const item = createMealCalculationItem(id, product, request, resolution, selectedOptionId);",
  "    const item = createMealCalculationItem(id, product, request, resolution, selectedOptionId, smartUnitPrompt);"
);
replaceOnce(
  'src/app/useCatalogController.ts',
  "    setSelectedOptionId(item.resolution.selectedOptionId);\n    dispatch({ type: 'resolve', query: item.product.displayName, product: item.product, candidates: [] });",
  "    setSelectedOptionId(item.resolution.selectedOptionId);\n    if (item.smartUnitPrompt) setSmartUnitValues((current) => ({ ...current, [smartUnitKey(item.product, item.smartUnitPrompt!)]: item.smartUnitPrompt!.value }));\n    dispatch({ type: 'resolve', query: item.product.displayName, product: item.product, candidates: [] });"
);
replaceOnce(
  'src/app/useCatalogController.ts',
  "  const updateMealItem = (id: string, amount: number, optionId?: string) => setMealItems((current) => current.map((item) => item.id === id ? updateMealCalculationItem(item, amount, optionId) : item));",
  `  const updateMealItem = (id: string, amount: number, optionId?: string) => setMealItems((current) => current.map((item) => item.id === id ? updateMealCalculationItem(item, amount, optionId) : item));
  const updateMealItemSmartUnit = (id: string, value: string) => setMealItems((current) => current.map((item) => {
    if (item.id !== id || !item.smartUnitPrompt) return item;
    const prompt = updateSmartUnitPromptValue(item.smartUnitPrompt, value);
    const state = resolveProductUnitState(item.product, item.request, value);
    return createMealCalculationItem(item.id, item.product, item.request, state.resolution, state.resolution.selectedOptionId, state.prompt ?? prompt) ?? { ...item, smartUnitPrompt: prompt };
  }));
  const confirmMealItemSmartUnit = (id: string) => {
    const item = mealItems.find((candidate) => candidate.id === id);
    if (!item?.smartUnitPrompt || !persistSmartUnitPrompt(item.product, item.smartUnitPrompt)) return;
    const state = resolveProductUnitState(item.product, item.request);
    const next = createMealCalculationItem(item.id, item.product, item.request, state.resolution, state.resolution.selectedOptionId, state.prompt);
    if (next) setMealItems((current) => current.map((candidate) => candidate.id === id ? next : candidate));
  };`
);
replaceOnce(
  'src/app/useCatalogController.ts',
  "    if (mealItems.length === 0) return;",
  "    if (mealItems.length === 0 || mealItems.some((item) => item.calculation.status !== 'calculated')) return;"
);
replaceOnce(
  'src/app/useCatalogController.ts',
  "calibrationPreview, calibrationMessage, productPhotoMessage",
  "calibrationPreview, calibrationMessage, smartUnitPrompt, smartUnitMessage, setCurrentSmartUnitPromptValue, confirmCurrentSmartUnitPrompt, productPhotoMessage"
);
replaceOnce(
  'src/app/useCatalogController.ts',
  "openMealItem, updateMealItem, removeMealItem",
  "openMealItem, updateMealItem, updateMealItemSmartUnit, confirmMealItemSmartUnit, removeMealItem"
);

replaceOnce(
  'src/app/CalculatorScreen.tsx',
  "import { QuantityStepper } from './QuantityStepper';\nimport type { CatalogController } from './useCatalogController';",
  "import { QuantityStepper } from './QuantityStepper';\nimport type { SmartUnitPrompt } from '../lib/smartUnitPrompt';\nimport type { CatalogController } from './useCatalogController';"
);
replaceOnce(
  'src/app/CalculatorScreen.tsx',
  `function FloatingMealControls({ c }: { c: CatalogController }) {`,
  `function SmartUnitPromptEditor({ prompt, onChange, onConfirm, testId }: { prompt: SmartUnitPrompt; onChange: (value: string) => void; onConfirm: () => void; testId: string }) {
  const numeric = Number(prompt.value.replace(',', '.'));
  const valid = Number.isFinite(numeric) && numeric > 0 && (prompt.mode !== 'whole-split' || Number.isInteger(numeric));
  const unitLabel = prompt.unit === 'bar' ? 'Riegel' : prompt.unit === 'slice' ? 'Scheibe' : prompt.unit === 'portion' ? 'Portion' : 'Stück';
  return <section className="smart-unit-prompt" data-testid={testId} data-prompt-mode={prompt.mode} data-default-value={prompt.defaultValue ?? ''}>
    <div><span className="eyebrow">Einheitengröße prüfen</span><strong>{prompt.question}</strong><p>{prompt.explanation}</p></div>
    <label className="field"><span>{prompt.mode === 'whole-split' ? 'Stücke der ganzen Pizza' : `Gramm je ${unitLabel}`}</span><input type="number" min="0.01" step={prompt.mode === 'whole-split' ? '1' : 'any'} inputMode="decimal" value={prompt.value} onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)} aria-label={`${prompt.productName}: ${prompt.mode === 'whole-split' ? 'Anzahl Pizzastücke' : `Gramm je ${unitLabel}`}`} data-testid={`${testId}-input`} /></label>
    <button type="button" className="button button--primary" disabled={!valid} onClick={onConfirm} data-testid={`${testId}-confirm`}>Größe übernehmen</button>
  </section>;
}

function FloatingMealControls({ c }: { c: CatalogController }) {`
);
replaceOnce(
  'src/app/CalculatorScreen.tsx',
  `        <label className="field meal-item__unit"><span>Einheit</span><select value={item.resolution.selectedOptionId ?? ''} aria-label={\`${'${item.product.displayName}: Einheit'}\`} onChange={(event: ChangeEvent<HTMLSelectElement>) => c.updateMealItem(item.id, item.request.amount, event.target.value)}>{item.resolution.options.map((option) => <option key={option.id} value={option.id} disabled={option.baseValue === null}>{option.label}{option.baseValue === null ? ' – Gewicht fehlt' : ''}</option>)}</select></label>
        <strong className="meal-item__carbs">{formatCarbohydrates(item.calculation.carbohydratesG, c.settings.decimalPlaces)} g KH</strong>`,
  `        <label className="field meal-item__unit"><span>Einheit</span><select value={item.resolution.selectedOptionId ?? ''} aria-label={\`${'${item.product.displayName}: Einheit'}\`} onChange={(event: ChangeEvent<HTMLSelectElement>) => c.updateMealItem(item.id, item.request.amount, event.target.value)}>{item.resolution.options.map((option) => <option key={option.id} value={option.id} disabled={option.baseValue === null}>{option.label}{option.baseValue === null ? ' – Gewicht fehlt' : ''}</option>)}</select></label>
        {item.smartUnitPrompt && <SmartUnitPromptEditor prompt={item.smartUnitPrompt} onChange={(value) => c.updateMealItemSmartUnit(item.id, value)} onConfirm={() => c.confirmMealItemSmartUnit(item.id)} testId={\`meal-smart-unit-${'${item.id}'}\`} />}
        <strong className="meal-item__carbs">{item.calculation.carbohydratesG === null ? '–' : `${'${formatCarbohydrates(item.calculation.carbohydratesG, c.settings.decimalPlaces)} g KH'}`}</strong>`
);
replaceOnce(
  'src/app/CalculatorScreen.tsx',
  "          </div>\n\n          {calculation?.status === 'calculated'",
  "          </div>\n\n          {c.smartUnitPrompt && <SmartUnitPromptEditor prompt={c.smartUnitPrompt} onChange={c.setCurrentSmartUnitPromptValue} onConfirm={c.confirmCurrentSmartUnitPrompt} testId=\"catalog-smart-unit-prompt\" />}\n          {c.smartUnitMessage && <p className=\"inline-message\" role=\"status\">{c.smartUnitMessage}</p>}\n\n          {calculation?.status === 'calculated'"
);

appendOnce(
  'src/styles.css',
  '.smart-unit-prompt {',
  `.smart-unit-prompt {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(150px, 220px) auto;
  gap: 0.8rem;
  align-items: end;
  padding: 1rem;
  border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border));
  border-radius: 1rem;
  background: color-mix(in srgb, var(--accent) 7%, var(--surface));
}
.smart-unit-prompt p { margin: 0.35rem 0 0; }
.meal-item .smart-unit-prompt { grid-column: 1 / -1; }
@media (max-width: 720px) {
  .smart-unit-prompt { grid-template-columns: 1fr; align-items: stretch; }
}`
);

console.log('Smart unit prompt source transform complete.');
