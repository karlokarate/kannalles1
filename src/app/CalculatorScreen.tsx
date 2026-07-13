import { useState, type ChangeEvent, type FormEvent } from 'react';
import { catalogProductEligibility } from '../lib/resolution/catalogResolution';
import { formatCarbohydrates } from '../lib/settings';
import { isGenericCatalogProduct } from '../lib/genericFoods';
import { autoSelectionEligibility, catalogProductImageUrl, semanticUnitProvenance } from './catalogViewModel';
import type { CatalogController } from './useCatalogController';

function subtitle(brand: string | null, code: string): string { return [brand, code].filter(Boolean).join(' · '); }

function ProductImage({ src, alt, compact = false }: { src: string | null; alt: string; compact?: boolean }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!src || failedSrc === src) return <span className={`product-image-fallback${compact ? ' product-image-fallback--compact' : ''}`} aria-hidden="true">▧</span>;
  return <img className={compact ? 'product-result__image' : undefined} src={src} alt={alt} width={compact ? 64 : 96} height={compact ? 64 : 96} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailedSrc(src)} />;
}

export function CalculatorScreen({ c }: { c: CatalogController }) {
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void c.executeSearch(c.query); };
  const product = c.product;
  const resolution = c.resolution;
  const calculation = c.calculation;
  const selected = c.selectedOption;
  const eligibleCount = c.search.candidates.filter((hit) => catalogProductEligibility(hit).eligible).length;
  const imageUrl = product ? catalogProductImageUrl(product) : null;

  return (
    <section className="screen calculator-screen" aria-labelledby="calculator-title">
      <header className="screen-heading">
        <div><span className="eyebrow">Verifizierter SQLite-Katalog</span><h1 id="calculator-title">Kohlenhydrate berechnen</h1></div>
        <fieldset className="mode-switch" aria-label="Berechnungsart">
          <button type="button" className={!c.manualMode ? 'is-active' : ''} aria-pressed={!c.manualMode} onClick={() => c.setManualMode(false)}>Produkt</button>
          <button type="button" className={c.manualMode ? 'is-active' : ''} aria-pressed={c.manualMode} onClick={() => c.setManualMode(true)}>Manuell</button>
        </fieldset>
      </header>

      {!c.manualMode ? <>
        <search><form className="search-card" onSubmit={submit} data-search-phase={c.search.phase}>
          <label htmlFor="catalog-search-input">Produktname oder Barcode</label>
          <div className="search-row">
            <input id="catalog-search-input" data-testid="catalog-search-input" type="search" inputMode="search" autoComplete="off" maxLength={120} placeholder="z. B. 3 Riegel Kinder Bueno" value={c.query} onChange={(event: ChangeEvent<HTMLInputElement>) => c.setQuery(event.target.value)} />
            <button type="button" className="button button--secondary speech-button" onClick={c.startVoiceSearch} aria-pressed={c.speechListening} data-testid="catalog-speech-search">{c.speechListening ? 'Höre zu …' : '🎙 Sprechen'}</button>
            <button type="submit" className="button button--primary" data-testid="catalog-search-submit">{c.search.phase === 'searching' ? 'Neu suchen' : 'Suchen'}</button>
          </div>
          <small>Die Produktsuche bleibt vollständig lokal; die Spracheingabe wird vom Browser bereitgestellt.</small>
          {c.speechMessage && <small className="speech-message" role="status">{c.speechMessage}</small>}
        </form></search>

        {c.search.validationMessage && <div className="inline-message" role="alert">{c.search.validationMessage}</div>}
        {c.search.phase === 'not_found' && <section className="empty-state" data-search-outcome="not_found"><strong>Kein passendes Produkt gefunden</strong><p>Es wird kein fremdes Ersatzprodukt eingesetzt.</p></section>}

        {(c.search.phase === 'needs_product_choice' || (c.search.phase === 'resolved' && c.search.candidates.length > 1)) && <section className="results-panel" aria-labelledby="results-title" data-testid="catalog-search-results" data-result-count={c.search.candidates.length} data-order-authority="sqlite">
          <div className="section-title-row"><div><span className="eyebrow">SQLite-Reihenfolge</span><h2 id="results-title">{c.search.phase === 'resolved' ? 'Weitere passende Produkte' : 'Produkt auswählen'}</h2></div><span>{c.search.candidates.length} Treffer</span></div>
          <div className="result-list">{c.search.candidates.map((hit, index) => {
            const eligible = catalogProductEligibility(hit).eligible;
            const auto = autoSelectionEligibility(hit, c.search.query, eligible, eligibleCount);
            return <button key={`${hit.productId}-${hit.resultIndex}`} type="button" className="product-result" data-testid="catalog-search-result" data-result-index={hit.resultIndex} data-rank-ordinal={hit.rankOrdinal} data-auto-select-eligible={String(auto.eligible)} data-catalog-eligible={String(eligible)} onClick={() => c.selectCandidate(hit)}>
              <span className="result-position">{index + 1}</span><ProductImage src={c.settings.productImageMode === 'remote' ? catalogProductImageUrl(hit) : null} alt={hit.displayName} compact /><span className="result-copy"><strong>{hit.displayName}</strong><small>{subtitle(hit.brand, hit.code) || 'Ohne Markenangabe'}</small></span><span className="result-nutrition">{hit.nutrition.carbohydratesPer100.toLocaleString('de-DE')} g KH / 100 {hit.nutrition.basis === 'mass' ? 'g' : 'ml'}</span>
            </button>;
          })}</div>
        </section>}

        {product && resolution && <article className="product-card" data-testid="catalog-product" data-product-id={product.productId} data-gtin={product.code} data-amount={c.request.amount} data-carbs-per-100-g={product.nutrition.basis === 'mass' ? product.nutrition.carbohydratesPer100 : ''} data-carbs-per-100-ml={product.nutrition.basis === 'volume' ? product.nutrition.carbohydratesPer100 : ''} data-nutrition-basis={product.nutrition.basis} data-unit-resolution-status={resolution.status}>
          <div className="product-card__header">
            {c.settings.productImageMode === 'remote' && <ProductImage src={imageUrl} alt={product.displayName} />}
            <div><span className="eyebrow">{isGenericCatalogProduct(product) ? 'Generische Referenz · gekocht' : 'Katalogprodukt'}</span><h2>{product.displayName}</h2><p>{isGenericCatalogProduct(product) ? product.brand : subtitle(product.brand, product.code)}</p></div>
            <button type="button" className="favorite-button" aria-pressed={c.isFavorite} onClick={c.toggleFavorite}><span aria-hidden="true">{c.isFavorite ? '★' : '☆'}</span>{c.isFavorite ? 'Favorit' : 'Merken'}</button>
          </div>
          <div className="calculation-grid">
            <label className="field"><span>Menge</span><input type="number" min="0.01" max="10000" step="any" value={c.request.amount} onChange={(event: ChangeEvent<HTMLInputElement>) => { const amount = Number(event.target.value); if (Number.isFinite(amount) && amount > 0) c.setRequest((r) => ({ ...r, amount })); }} data-testid="catalog-amount-input" /></label>
            <label className="field field--wide"><span>Einheit</span><select value={c.selectedOptionId ?? ''} onChange={(event: ChangeEvent<HTMLSelectElement>) => c.selectUnit(event.target.value)} data-testid="catalog-unit-select">
              {resolution.options.map((option) => <option key={option.id} value={option.id} data-unit-kind={option.unit} data-unit-provenance={semanticUnitProvenance(option)} data-unit-weight-g={option.basis === 'mass' && option.baseValue !== null ? option.baseValue : ''} data-unit-volume-ml={option.basis === 'volume' && option.baseValue !== null ? option.baseValue : ''} data-unit-recommended={String(option.recommended)}>{option.label}{option.baseValue === null ? ' – Gewicht fehlt' : ` – ${option.baseValue.toLocaleString('de-DE')} ${option.basis === 'mass' ? 'g' : 'ml'}`}</option>)}
            </select>{selected && <small>{selected.note}</small>}</label>
          </div>

          {calculation?.status === 'calculated' && calculation.carbohydratesG !== null ? <section className="calculation-result" aria-live="polite" data-testid="catalog-calculation" data-status="calculated" data-total-carbs-g={calculation.carbohydratesG} data-total-mass-g={calculation.totalMassG ?? ''} data-total-volume-ml={calculation.totalVolumeMl ?? ''} data-unit-kind={calculation.unit} data-unit-base-value={calculation.unitBaseValue ?? ''} data-provenance={calculation.provenance.source ?? ''}>
            <span>Kohlenhydrate gesamt</span><strong>{formatCarbohydrates(calculation.carbohydratesG, c.settings.decimalPlaces)} g KH</strong><small>Intern ohne Zwischenrundung berechnet · {c.request.amount.toLocaleString('de-DE')} × {calculation.unitBaseValue?.toLocaleString('de-DE')} × {product.nutrition.carbohydratesPer100.toLocaleString('de-DE')} / 100</small>{c.settings.saveHistory && <button type="button" className="button button--secondary" onClick={c.saveCurrent}>Im Verlauf speichern</button>}
          </section> : <section className="missing-calculation" data-testid="catalog-calculation" data-status={calculation?.status ?? 'not_calculable'}><strong>Für diese Einheit fehlt noch ein belastbares Gewicht.</strong><p>Du kannst die Einheit direkt unten durch gemeinsames Wiegen festlegen.</p></section>}

          {product.nutrition.basis === 'mass' && !isGenericCatalogProduct(product) && <section className="calibration-card" data-testid="catalog-calibration" data-status="always-available">
            <span className="eyebrow">Persönliche Standard-Einheit</span><h3>Serving-Einheit selbst abwiegen</h3><p>Wiege eine frei wählbare Anzahl gemeinsam. Das Einzelgewicht wird automatisch berechnet, gespeichert und bei jeder späteren Suche als Standard verwendet.</p>
            <div className="calibration-fields"><label className="field"><span>Einheit</span><select value={c.calibrationUnit} onChange={(event: ChangeEvent<HTMLSelectElement>) => c.changeCalibrationUnit(event.target.value as typeof c.calibrationUnit)} data-testid="catalog-calibration-unit"><option value="piece">Stück</option><option value="bar">Riegel</option><option value="slice">Scheibe</option><option value="portion">Portion</option></select></label><label className="field"><span>Anzahl gemeinsam gewogen</span><input type="number" min="1" max="10000" step="1" value={c.calibrationCount} onChange={(event: ChangeEvent<HTMLInputElement>) => c.setCalibrationCount(event.target.value)} data-testid="catalog-calibration-count" /></label><label className="field"><span>Gesamtgewicht in g</span><input type="number" min="0.01" step="any" value={c.calibrationWeight} onChange={(event: ChangeEvent<HTMLInputElement>) => c.setCalibrationWeight(event.target.value)} placeholder="z. B. 28,8" data-testid="catalog-calibration-weight" /></label></div>
            {c.calibrationPreview && <dl className="calibration-preview" data-testid="catalog-calibration-preview" data-derived-unit-weight-g={c.calibrationPreview.unitWeightG} data-derived-carbs-per-unit-g={c.calibrationPreview.carbsPerUnitG ?? ''} data-requested-total-carbs-g={c.calibrationPreview.requestedTotalCarbsG ?? ''}><div><dt>Gewicht je Einheit</dt><dd>{c.calibrationPreview.unitWeightG.toLocaleString('de-DE')} g</dd></div><div><dt>KH je Einheit</dt><dd>{c.calibrationPreview.carbsPerUnitG?.toLocaleString('de-DE') ?? '–'} g</dd></div><div><dt>KH für deine Menge</dt><dd>{c.calibrationPreview.requestedTotalCarbsG?.toLocaleString('de-DE') ?? '–'} g</dd></div></dl>}
            {c.calibrationMessage && <p className="inline-message" role="status">{c.calibrationMessage}</p>}<small>Gültige Änderungen werden nach kurzer Eingabepause automatisch lokal gespeichert.</small>
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
