import type { ChangeEvent, FormEvent } from 'react';
import { catalogProductEligibility } from '../lib/resolution/catalogResolution';
import { formatCarbohydrates } from '../lib/settings';
import { autoSelectionEligibility, semanticUnitProvenance, toResolutionProduct, unitLabel } from './catalogViewModel';
import type { CatalogController } from './useCatalogController';

function subtitle(brand: string | null, code: string): string { return [brand, code].filter(Boolean).join(' · '); }

export function CalculatorScreen({ c }: { c: CatalogController }) {
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void c.executeSearch(c.query); };
  const product = c.product;
  const resolution = c.resolution;
  const calculation = c.calculation;
  const selected = c.selectedOption;
  const eligibleCount = c.search.candidates.filter((hit) => catalogProductEligibility(toResolutionProduct(hit)).eligible).length;

  return (
    <section className="screen calculator-screen" aria-labelledby="calculator-title">
      <header className="screen-heading">
        <div><span className="eyebrow">Verifizierter SQLite-Katalog</span><h1 id="calculator-title">Kohlenhydrate berechnen</h1></div>
        <div className="mode-switch" role="group" aria-label="Berechnungsart">
          <button type="button" className={!c.manualMode ? 'is-active' : ''} aria-pressed={!c.manualMode} onClick={() => c.setManualMode(false)}>Produkt</button>
          <button type="button" className={c.manualMode ? 'is-active' : ''} aria-pressed={c.manualMode} onClick={() => c.setManualMode(true)}>Manuell</button>
        </div>
      </header>

      {!c.manualMode ? <>
        <form className="search-card" onSubmit={submit} role="search" data-search-phase={c.search.phase}>
          <label htmlFor="catalog-search-input">Produktname oder Barcode</label>
          <div className="search-row">
            <input id="catalog-search-input" data-testid="catalog-search-input" type="search" inputMode="search" autoComplete="off" maxLength={120} placeholder="z. B. 3 Riegel Kinder Bueno" value={c.query} onChange={(event: ChangeEvent<HTMLInputElement>) => c.setQuery(event.target.value)} />
            <button type="submit" className="button button--primary" data-testid="catalog-search-submit">{c.search.phase === 'searching' ? 'Neu suchen' : 'Suchen'}</button>
          </div>
          <small>Die Suche startet nur nach deiner Aktion und bleibt vollständig lokal.</small>
        </form>

        {c.search.validationMessage && <div className="inline-message" role="alert">{c.search.validationMessage}</div>}
        {c.search.phase === 'not_found' && <section className="empty-state" data-search-outcome="not_found"><strong>Kein passendes Produkt gefunden</strong><p>Es wird kein fremdes Ersatzprodukt eingesetzt.</p></section>}

        {c.search.phase === 'needs_product_choice' && <section className="results-panel" aria-labelledby="results-title" data-testid="catalog-search-results" data-result-count={c.search.candidates.length} data-order-authority="sqlite">
          <div className="section-title-row"><div><span className="eyebrow">SQLite-Reihenfolge</span><h2 id="results-title">Produkt auswählen</h2></div><span>{c.search.candidates.length} Treffer</span></div>
          <div className="result-list">{c.search.candidates.map((hit, index) => {
            const eligible = catalogProductEligibility(toResolutionProduct(hit)).eligible;
            const auto = autoSelectionEligibility(hit, c.search.query, eligible, eligibleCount);
            return <button key={`${hit.productId}-${hit.resultIndex}`} type="button" className="product-result" data-testid="catalog-search-result" data-result-index={hit.resultIndex} data-rank-ordinal={hit.rankOrdinal} data-auto-select-eligible={String(auto.eligible)} data-catalog-eligible={String(eligible)} onClick={() => c.selectCandidate(hit)}>
              <span className="result-position">{index + 1}</span><span className="result-copy"><strong>{hit.displayName}</strong><small>{subtitle(hit.brand, hit.code) || 'Ohne Markenangabe'}</small></span><span className="result-nutrition">{hit.carbohydratesPer100.toLocaleString('de-DE')} g KH / 100 {hit.nutritionBasis === 'mass' ? 'g' : 'ml'}</span>
            </button>;
          })}</div>
        </section>}

        {product && resolution && <article className="product-card" data-testid="catalog-product" data-product-id={product.productId} data-gtin={product.code} data-amount={c.request.amount} data-carbs-per-100-g={product.nutritionBasis === 'mass' ? product.carbohydratesPer100 : ''} data-carbs-per-100-ml={product.nutritionBasis === 'volume' ? product.carbohydratesPer100 : ''} data-nutrition-basis={product.nutritionBasis} data-unit-resolution-status={resolution.status}>
          <div className="product-card__header">
            {c.settings.productImageMode === 'remote' && product.image && <img src={product.image.url} alt="" width="96" height="96" loading="lazy" referrerPolicy="no-referrer" />}
            <div><span className="eyebrow">Katalogprodukt</span><h2>{product.displayName}</h2><p>{subtitle(product.brand, product.code)}</p></div>
            <button type="button" className="favorite-button" aria-pressed={c.isFavorite} onClick={c.toggleFavorite}><span aria-hidden="true">{c.isFavorite ? '★' : '☆'}</span>{c.isFavorite ? 'Favorit' : 'Merken'}</button>
          </div>
          <div className="calculation-grid">
            <label className="field"><span>Menge</span><input type="number" min="0.01" max="10000" step="any" value={c.request.amount} onChange={(event: ChangeEvent<HTMLInputElement>) => { const amount = Number(event.target.value); if (Number.isFinite(amount) && amount > 0) c.setRequest((r) => ({ ...r, amount })); }} data-testid="catalog-amount-input" /></label>
            <label className="field field--wide"><span>Einheit</span><select value={c.selectedOptionId ?? ''} onChange={(event: ChangeEvent<HTMLSelectElement>) => c.selectUnit(event.target.value)} data-testid="catalog-unit-select">
              {resolution.options.map((option) => <option key={option.id} value={option.id} data-unit-kind={option.unit} data-unit-provenance={semanticUnitProvenance(option)} data-unit-weight-g={option.basis === 'mass' && option.baseValue !== null ? option.baseValue : ''} data-unit-volume-ml={option.basis === 'volume' && option.baseValue !== null ? option.baseValue : ''} data-unit-recommended={String(option.recommended)}>{option.label}{option.baseValue === null ? ' – Gewicht fehlt' : ` – ${option.baseValue.toLocaleString('de-DE')} ${option.basis === 'mass' ? 'g' : 'ml'}`}</option>)}
            </select>{selected && <small>{selected.note}</small>}</label>
          </div>

          {calculation?.status === 'calculated' && calculation.carbohydratesG !== null ? <section className="calculation-result" aria-live="polite" data-testid="catalog-calculation" data-status="calculated" data-total-carbs-g={calculation.carbohydratesG} data-total-mass-g={calculation.totalMassG ?? ''} data-total-volume-ml={calculation.totalVolumeMl ?? ''} data-unit-kind={calculation.unit} data-unit-base-value={calculation.unitBaseValue ?? ''} data-provenance={calculation.provenance.source ?? ''}>
            <span>Kohlenhydrate gesamt</span><strong>{formatCarbohydrates(calculation.carbohydratesG, c.settings.decimalPlaces)} g KH</strong><small>Intern ohne Zwischenrundung berechnet · {c.request.amount.toLocaleString('de-DE')} × {calculation.unitBaseValue?.toLocaleString('de-DE')} × {product.carbohydratesPer100.toLocaleString('de-DE')} / 100</small>{c.settings.saveHistory && <button type="button" className="button button--secondary" onClick={c.saveCurrent}>Im Verlauf speichern</button>}
          </section> : <section className="calibration-card" data-testid="catalog-calibration" data-status="needs_unit_calibration">
            <span className="eyebrow">Einzelgewicht fehlt</span><h3>{selected ? `${unitLabel(selected.unit)} kalibrieren` : 'Einheit kalibrieren'}</h3><p>Das Gewicht wird nicht geschätzt. Wiege eine Einheit oder mehrere gleiche Einheiten gemeinsam.</p>
            <div className="segmented-control" role="group" aria-label="Messmethode"><button type="button" className={c.calibrationMode === 'single' ? 'is-active' : ''} onClick={() => c.setCalibrationMode('single')}>Einzeln</button><button type="button" className={c.calibrationMode === 'group' ? 'is-active' : ''} onClick={() => c.setCalibrationMode('group')}>Gemeinsam</button></div>
            <div className="calibration-fields">{c.calibrationMode === 'group' && <label className="field"><span>Anzahl Einheiten</span><input type="number" min="2" step="1" value={c.calibrationCount} onChange={(event: ChangeEvent<HTMLInputElement>) => c.setCalibrationCount(event.target.value)} data-testid="catalog-calibration-count" /></label>}<label className="field"><span>Gesamtgewicht in g</span><input type="number" min="0.01" step="any" value={c.calibrationWeight} onChange={(event: ChangeEvent<HTMLInputElement>) => c.setCalibrationWeight(event.target.value)} data-testid="catalog-calibration-weight" /></label></div>
            {c.calibrationPreview && <dl className="calibration-preview" data-testid="catalog-calibration-preview" data-derived-unit-weight-g={c.calibrationPreview.unitWeightG} data-derived-carbs-per-unit-g={c.calibrationPreview.carbsPerUnitG ?? ''} data-requested-total-carbs-g={c.calibrationPreview.requestedTotalCarbsG ?? ''}><div><dt>Gewicht je Einheit</dt><dd>{c.calibrationPreview.unitWeightG.toLocaleString('de-DE')} g</dd></div><div><dt>KH je Einheit</dt><dd>{c.calibrationPreview.carbsPerUnitG?.toLocaleString('de-DE') ?? '–'} g</dd></div><div><dt>KH für deine Menge</dt><dd>{c.calibrationPreview.requestedTotalCarbsG?.toLocaleString('de-DE') ?? '–'} g</dd></div></dl>}
            {c.calibrationMessage && <p className="inline-message" role="status">{c.calibrationMessage}</p>}<button type="button" className="button button--primary" onClick={c.saveCalibration} data-testid="catalog-calibration-save">Messung speichern und neu berechnen</button>
          </section>}
        </article>}
      </> : <section className="manual-card" aria-labelledby="manual-title">
        <span className="eyebrow">Ohne Produktdatensatz</span><h2 id="manual-title">Manuelle Berechnung</h2><p>Übertrage den KH-Wert vom Etikett. Es wird keine externe Quelle abgefragt.</p>
        <div className="manual-grid"><label className="field field--wide"><span>Bezeichnung</span><input value={c.manual.label} onChange={(event: ChangeEvent<HTMLInputElement>) => c.setManual((m) => ({ ...m, label: event.target.value }))} /></label><label className="field"><span>KH pro 100 {c.manual.basis === 'mass' ? 'g' : 'ml'}</span><input type="number" min="0" step="any" value={c.manual.carbohydratesPer100} onChange={(event: ChangeEvent<HTMLInputElement>) => c.setManual((m) => ({ ...m, carbohydratesPer100: event.target.value }))} /></label><label className="field"><span>Menge in {c.manual.basis === 'mass' ? 'g' : 'ml'}</span><input type="number" min="0.01" step="any" value={c.manual.amount} onChange={(event: ChangeEvent<HTMLInputElement>) => c.setManual((m) => ({ ...m, amount: event.target.value }))} /></label><label className="field"><span>Bezugsart</span><select value={c.manual.basis} onChange={(event: ChangeEvent<HTMLSelectElement>) => c.setManual((m) => ({ ...m, basis: event.target.value as 'mass' | 'volume' }))}><option value="mass">Gewicht</option><option value="volume">Volumen</option></select></label></div>
        <section className="calculation-result" aria-live="polite"><span>Kohlenhydrate gesamt</span><strong>{formatCarbohydrates(c.manualCalculation, c.settings.decimalPlaces)} g KH</strong>{c.settings.saveHistory && c.manualCalculation !== null && <button type="button" className="button button--secondary" onClick={c.saveManual}>Im Verlauf speichern</button>}</section>
      </section>}
    </section>
  );
}
