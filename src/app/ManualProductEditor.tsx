import { useEffect, useState, type ChangeEvent, type ReactNode } from 'react';
import { manualProductCode, manualProductToCatalogProduct } from '../lib/manualCatalog';
import { createCatalogCalibration } from '../lib/resolution/catalogCalibration';
import type { CatalogCalibrationIdentity, CatalogCalibrationUnit, CatalogUnitCalibration } from '../lib/resolution/catalogCalibration';
import { formatCarbohydrates } from '../lib/settings';
import {
  createLocalId,
  findMatchingCatalogCalibrations,
  saveCatalogCalibration,
  saveCatalogProductPhoto,
  saveManualProduct
} from '../lib/userDataStore';
import type { ManualProduct } from '../lib/userDataStore';
import { QuantityStepper } from './QuantityStepper';
import type { CatalogController } from './useCatalogController';

type ManualReferenceMode = 'per100' | 'per-unit';

const MANUAL_UNITS: readonly CatalogCalibrationUnit[] = ['piece', 'bar', 'slice', 'portion'];

function positiveNumber(value: string): number | null {
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function unitLabel(unit: CatalogCalibrationUnit): string {
  if (unit === 'bar') return 'Riegel';
  if (unit === 'slice') return 'Scheibe';
  if (unit === 'portion') return 'Portion';
  return 'Stück';
}

function calibrationIdentity(item: ManualProduct): CatalogCalibrationIdentity {
  const product = manualProductToCatalogProduct(item);
  return {
    catalogProductId: product.productId,
    barcode: null,
    canonicalName: product.displayName,
    brandCanonical: product.brand,
    genericFoodKey: null
  };
}

function storedManualCalibration(item: ManualProduct): CatalogUnitCalibration | null {
  return MANUAL_UNITS
    .flatMap((unit) => findMatchingCatalogCalibrations(calibrationIdentity(item), unit, false))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
}

interface ManualProductEditorProps {
  c: CatalogController;
  diabetesPanel: ReactNode;
}

export function ManualProductEditor({ c, diabetesPanel }: ManualProductEditorProps) {
  const [referenceMode, setReferenceMode] = useState<ManualReferenceMode>('per100');
  const [servingUnit, setServingUnit] = useState<CatalogCalibrationUnit>('piece');
  const [carbohydratesPerUnit, setCarbohydratesPerUnit] = useState('');
  const [unitWeightG, setUnitWeightG] = useState('');
  const [unitCount, setUnitCount] = useState('1');
  const [definitionMessage, setDefinitionMessage] = useState<string | null>(null);

  const directCarbohydrates = positiveNumber(carbohydratesPerUnit);
  const servingWeight = positiveNumber(unitWeightG);
  const servingCount = positiveNumber(unitCount);
  const derivedCarbohydratesPer100 = directCarbohydrates !== null && servingWeight !== null
    ? directCarbohydrates * 100 / servingWeight
    : null;
  const directCalculation = directCarbohydrates !== null && servingCount !== null
    ? directCarbohydrates * servingCount
    : null;
  const displayedCalculation = referenceMode === 'per-unit' ? directCalculation : c.manualCalculation;

  useEffect(() => {
    if (referenceMode !== 'per-unit' || derivedCarbohydratesPer100 === null || servingWeight === null || servingCount === null) return;
    const carbohydrates = String(derivedCarbohydratesPer100);
    const amount = String(servingWeight * servingCount);
    c.setManual((current) => current.carbohydratesPer100 === carbohydrates && current.amount === amount && current.basis === 'mass'
      ? current
      : { ...current, carbohydratesPer100: carbohydrates, amount, basis: 'mass' });
  }, [c.setManual, derivedCarbohydratesPer100, referenceMode, servingCount, servingWeight]);

  const resetPortionFields = () => {
    setReferenceMode('per100');
    setServingUnit('piece');
    setCarbohydratesPerUnit('');
    setUnitWeightG('');
    setUnitCount('1');
  };

  const saveDefinition = () => {
    const label = c.manual.label.trim();
    const existing = c.manual.id ? c.manualProducts.find((item) => item.id === c.manual.id) : null;
    const now = new Date().toISOString();
    const id = c.manual.id ?? createLocalId('manual-product');
    let carbohydratesPer100 = positiveNumber(c.manual.carbohydratesPer100);

    if (referenceMode === 'per-unit') {
      if (directCarbohydrates === null || servingWeight === null || derivedCarbohydratesPer100 === null) {
        setDefinitionMessage('Bitte KH je Einheit und das reale Gewicht dieser Einheit eingeben.');
        return;
      }
      carbohydratesPer100 = derivedCarbohydratesPer100;
    }

    if (!label || carbohydratesPer100 === null || carbohydratesPer100 > (c.manual.basis === 'mass' ? 100 : 200)) {
      setDefinitionMessage(referenceMode === 'per-unit'
        ? 'Die Angaben ergeben keinen gültigen KH-Wert pro 100 g. Bitte KH und Einheitsgewicht prüfen.'
        : 'Bitte Name und gültigen KH-Wert eintragen.');
      return;
    }

    const saved = saveManualProduct({
      schemaVersion: 1,
      id,
      label,
      carbohydratesPer100,
      basis: referenceMode === 'per-unit' ? 'mass' : c.manual.basis,
      imageDataUrl: c.manual.imageDataUrl,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    });
    if (!saved) {
      setDefinitionMessage('Das Produkt konnte nicht lokal gespeichert werden.');
      return;
    }

    if (referenceMode === 'per-unit' && servingWeight !== null) {
      const calibration = createCatalogCalibration({
        calibrationId: createLocalId('cal'),
        scope: 'catalog-product',
        identity: calibrationIdentity(saved),
        unit: servingUnit,
        measuredCount: 1,
        measuredTotalWeightG: servingWeight,
        smallestEdibleUnit: servingUnit !== 'portion',
        now
      });
      if (!calibration || !saveCatalogCalibration(calibration)) {
        setDefinitionMessage('Das Produkt wurde gespeichert, die Einheitengröße aber nicht. Bitte die Detailseite erneut öffnen.');
        c.refreshLocalData();
        return;
      }
    }

    if (saved.imageDataUrl) saveCatalogProductPhoto(manualProductCode(saved.id), saved.imageDataUrl);
    c.setManual((current) => ({ ...current, id: saved.id, carbohydratesPer100: String(carbohydratesPer100), basis: saved.basis }));
    setDefinitionMessage(referenceMode === 'per-unit'
      ? `${saved.label}: ${carbohydratesPerUnit} g KH je ${unitLabel(servingUnit)} mit ${unitWeightG} g gespeichert.`
      : 'Produkt automatisch lokal gespeichert.');
    c.refreshLocalData();
  };

  const loadDefinition = (item: ManualProduct) => {
    c.loadManualDefinition(item);
    const calibration = storedManualCalibration(item);
    if (!calibration) {
      resetPortionFields();
      setDefinitionMessage('Gespeichertes Produkt geladen.');
      return;
    }
    const weight = calibration.measurement.measuredTotalWeightG / calibration.measurement.measuredCount;
    setReferenceMode('per-unit');
    setServingUnit(calibration.unit);
    setUnitWeightG(String(weight));
    setCarbohydratesPerUnit(String(item.carbohydratesPer100 * weight / 100));
    setUnitCount('1');
    setDefinitionMessage('Produkt mit gespeicherter Einheit geladen.');
  };

  const openDetails = (item: ManualProduct) => {
    if (item.imageDataUrl) saveCatalogProductPhoto(manualProductCode(item.id), item.imageDataUrl);
    const baseProduct = manualProductToCatalogProduct(item);
    const calibration = storedManualCalibration(item);
    const product = calibration
      ? {
          ...baseProduct,
          unitEvidence: {
            ...baseProduct.unitEvidence,
            defaultUnitKind: calibration.unit
          }
        }
      : baseProduct;
    c.setManualMode(false);
    c.setQuery(item.label);
    c.setRequest(calibration
      ? { amount: 1, unit: calibration.unit, unitExplicit: false }
      : { amount: 100, unit: item.basis === 'mass' ? 'g' : 'ml', unitExplicit: false });
    c.dispatch({ type: 'resolve', query: item.label, product, candidates: [{ ...product, resultIndex: 0 }] });
  };

  const newDefinition = () => {
    c.setManual({ id: null, label: '', carbohydratesPer100: '', amount: '100', basis: 'mass', imageDataUrl: null });
    resetPortionFields();
    setDefinitionMessage(null);
  };

  return (
    <section className="manual-card" aria-labelledby="manual-title">
      <span className="eyebrow">Eigene Produkte · nur auf diesem Gerät</span>
      <h2 id="manual-title">Produkt manuell anlegen</h2>
      <p>Hinterlege entweder den KH-Wert pro 100 g/100 ml oder einen direkten KH-Wert je Stück, Riegel, Scheibe oder Portion samt realem Einheitsgewicht.</p>

      <fieldset className="mode-switch" aria-label="Bezugswert des eigenen Produkts" data-testid="manual-reference-mode">
        <button type="button" className={referenceMode === 'per100' ? 'is-active' : ''} aria-pressed={referenceMode === 'per100'} onClick={() => { setReferenceMode('per100'); setDefinitionMessage(null); }}>Pro 100 g / 100 ml</button>
        <button type="button" className={referenceMode === 'per-unit' ? 'is-active' : ''} aria-pressed={referenceMode === 'per-unit'} onClick={() => { setReferenceMode('per-unit'); c.setManual((current) => ({ ...current, basis: 'mass' })); setDefinitionMessage(null); }}>Direkt je Einheit</button>
      </fieldset>

      <div className="manual-photo-row">
        {c.manual.imageDataUrl ? <img src={c.manual.imageDataUrl} alt="Foto des eigenen Produkts" className="manual-product-photo" /> : <span className="manual-product-photo manual-product-photo--empty" aria-hidden="true">▧</span>}
        <div className="button-row"><label className="button button--secondary manual-photo-button">Foto aufnehmen oder auswählen<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event: ChangeEvent<HTMLInputElement>) => { setDefinitionMessage(null); void c.setManualPhoto(event.target.files?.[0] ?? null); event.target.value = ''; }} data-testid="manual-product-photo" /></label>{c.manual.imageDataUrl && <button type="button" className="button button--ghost" onClick={() => c.setManual((current) => ({ ...current, imageDataUrl: null }))}>Foto entfernen</button>}</div>
      </div>

      <div className="manual-grid">
        <label className="field field--wide"><span>Bezeichnung</span><input value={c.manual.label} onChange={(event: ChangeEvent<HTMLInputElement>) => c.setManual((current) => ({ ...current, label: event.target.value }))} data-testid="manual-product-label" /></label>
        {referenceMode === 'per100' ? <>
          <label className="field"><span>KH pro 100 {c.manual.basis === 'mass' ? 'g' : 'ml'}</span><input type="number" min="0" step="any" value={c.manual.carbohydratesPer100} onChange={(event: ChangeEvent<HTMLInputElement>) => c.setManual((current) => ({ ...current, carbohydratesPer100: event.target.value }))} data-testid="manual-product-carbs" /></label>
          <label className="field" htmlFor="manual-product-amount"><span>Menge in {c.manual.basis === 'mass' ? 'g' : 'ml'}</span><QuantityStepper value={positiveNumber(c.manual.amount) ?? 100} min={0.01} max={10_000} onChange={(amount) => c.setManual((current) => ({ ...current, amount: String(amount) }))} ariaLabel={`Menge in ${c.manual.basis === 'mass' ? 'Gramm' : 'Milliliter'}`} testId="manual-product-amount" /></label>
          <label className="field"><span>Bezugsart</span><select value={c.manual.basis} onChange={(event: ChangeEvent<HTMLSelectElement>) => c.setManual((current) => ({ ...current, basis: event.target.value as 'mass' | 'volume' }))}><option value="mass">Gewicht</option><option value="volume">Volumen</option></select></label>
        </> : <>
          <label className="field"><span>Einheit</span><select value={servingUnit} onChange={(event) => setServingUnit(event.target.value as CatalogCalibrationUnit)} data-testid="manual-serving-unit"><option value="piece">Stück</option><option value="bar">Riegel</option><option value="slice">Scheibe</option><option value="portion">Portion</option></select></label>
          <label className="field"><span>KH je {unitLabel(servingUnit)}</span><input type="number" min="0.01" step="any" value={carbohydratesPerUnit} onChange={(event) => setCarbohydratesPerUnit(event.target.value)} placeholder="z. B. 12" data-testid="manual-carbs-per-unit" /></label>
          <label className="field"><span>Gewicht je {unitLabel(servingUnit)} in g</span><input type="number" min="0.01" max="5000" step="any" value={unitWeightG} onChange={(event) => setUnitWeightG(event.target.value)} placeholder="z. B. 30" data-testid="manual-unit-weight" /></label>
          <label className="field"><span>Anzahl {unitLabel(servingUnit)}</span><QuantityStepper value={servingCount ?? 1} min={0.01} max={10_000} onChange={(amount) => setUnitCount(String(amount))} ariaLabel={`Anzahl ${unitLabel(servingUnit)}`} testId="manual-unit-count" /></label>
          {derivedCarbohydratesPer100 !== null && <output className="field field--wide" data-testid="manual-derived-per100"><span>Abgeleiteter KH-Wert</span><strong>{derivedCarbohydratesPer100.toLocaleString('de-DE')} g KH / 100 g</strong><small>Nur aus deinen beiden Angaben berechnet; kein Gewicht wird geschätzt.</small></output>}
        </>}
      </div>

      <div className="button-row"><button type="button" className="button button--primary" onClick={saveDefinition} data-testid="manual-product-save">{c.manual.id ? 'Änderungen speichern' : 'Produkt lokal speichern'}</button><button type="button" className="button button--secondary" onClick={newDefinition}>Neues Produkt</button></div>
      {(definitionMessage ?? c.manualMessage) && <p className="inline-message" role="status">{definitionMessage ?? c.manualMessage}</p>}
      <section className="calculation-result" aria-live="polite" data-testid="manual-calculation"><span>Kohlenhydrate gesamt</span><strong>{formatCarbohydrates(displayedCalculation, c.settings.decimalPlaces)} g KH</strong>{c.settings.saveHistory && displayedCalculation !== null && <button type="button" className="button button--secondary" onClick={c.saveManual}>Im Verlauf speichern</button>}</section>
      {diabetesPanel}

      {c.manualProducts.length > 0 && <section className="saved-manual-products" aria-labelledby="saved-manual-title"><div className="section-title-row"><div><span className="eyebrow">Lokal gespeichert</span><h3 id="saved-manual-title">Eigene Produkte</h3></div><span>{c.manualProducts.length}</span></div><div className="result-list">{c.manualProducts.map((item) => {
        const calibration = storedManualCalibration(item);
        return <article className="saved-manual-product" key={item.id}>{item.imageDataUrl ? <img src={item.imageDataUrl} alt="" /> : <span className="manual-product-photo manual-product-photo--empty" aria-hidden="true">▧</span>}<div><strong>{item.label}</strong><small>{item.carbohydratesPer100.toLocaleString('de-DE')} g KH / 100 {item.basis === 'mass' ? 'g' : 'ml'}{calibration ? ` · ${unitLabel(calibration.unit)} ${((calibration.measurement.measuredTotalWeightG / calibration.measurement.measuredCount)).toLocaleString('de-DE')} g` : ''}</small></div><button type="button" className="button button--secondary" onClick={() => loadDefinition(item)}>Bearbeiten</button><button type="button" className="button button--secondary" onClick={() => openDetails(item)} data-testid={`manual-product-open-${item.id}`}>Im Rechner öffnen</button><button type="button" className="button button--ghost" onClick={() => c.removeManualDefinition(item.id)} aria-label={`${item.label} löschen`}>Löschen</button></article>;
      })}</div></section>}
    </section>
  );
}
