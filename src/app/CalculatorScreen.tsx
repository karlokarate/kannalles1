import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { catalogProductEligibility } from '../lib/resolution/catalogResolution';
import { formatCarbohydrates } from '../lib/settings';
import { isGenericCatalogProduct } from '../lib/genericFoods';
import { isClinicCatalogProduct } from '../lib/clinicCatalog';
import { autoSelectionEligibility, catalogProductImageUrl, semanticUnitProvenance } from './catalogViewModel';
import { DiabetesBolusPanel } from './DiabetesBolusPanel';
import type { CatalogController } from './useCatalogController';

function subtitle(brand: string | null, code: string): string { return [brand, code].filter(Boolean).join(' · '); }

function nutritionLabel(product: Parameters<typeof isClinicCatalogProduct>[0]): string {
  if (isClinicCatalogProduct(product)) {
    if (product.clinic.valueStatus !== 'numeric') return product.clinic.valueStatus === 'external_lookup_required' ? 'Laut Klinik: Packungswert verwenden' : 'Kein Klinikwert hinterlegt';
    if (product.clinic.directCarbohydratesPerUnit !== null) return `${product.clinic.directCarbohydratesPerUnit.toLocaleString('de-DE')} g KH / Stück`;
  }
  return `${product.nutrition.carbohydratesPer100.toLocaleString('de-DE')} g KH / 100 ${product.nutrition.basis === 'mass' ? 'g' : 'ml'}`;
}

function ClinicTag({ compact = false }: { compact?: boolean }) {
  return <span className={`clinic-tag${compact ? ' clinic-tag--compact' : ''}`}><img src={`${import.meta.env.BASE_URL}clinic/klinikum-leverkusen.svg`} alt="Klinikum Leverkusen" loading="lazy" decoding="async" /><b>KLINIK</b></span>;
}

function ProductImage({ src, alt, compact = false }: { src: string | null; alt: string; compact?: boolean }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!src || failedSrc === src) return <span className={`product-image-fallback${compact ? ' product-image-fallback--compact' : ''}`} aria-hidden="true">▧</span>;
  return <img className={compact ? 'product-result__image' : undefined} src={src} alt={alt} width={compact ? 84 : 126} height={compact ? 84 : 126} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailedSrc(src)} />;
}

function FloatingMealControls({ c }: { c: CatalogController }) {
  const canAdd = Boolean(c.product && c.calculation?.status === 'calculated' && c.calculation.carbohydratesG !== null);
  return <aside className="floating-meal-controls" aria-label="Gesamtrechnung">
    {c.mealItems.length > 0 && <button type="button" className="floating-meal-total" onClick={c.openMealSummary} data-testid="meal-floating-total"><span>{c.mealItems.length} {c.mealItems.length === 1 ? 'Produkt' : 'Produkte'}</span><strong>{formatCarbohydrates(c.mealTotalCarbohydrates, c.settings.decimalPlaces)} g KH</strong></button>}
    <button type="button" className="floating-meal-add" onClick={canAdd ? c.addCurrentToMeal : c.startNextMealProduct} aria-label={canAdd ? c.editingMealItemId ? 'Produktänderung übernehmen und weitere Berechnung starten' : 'Aktuelle Berechnung hinzufügen und weitere Berechnung starten' : 'Neue Produktsuche starten'} title={canAdd ? 'Zur Gesamtrechnung hinzufügen' : 'Neue Produktsuche'} data-testid="meal-floating-add">+</button>
  </aside>;
}

function MealSummary({ c, currentGlucose, onCurrentGlucoseChange }: { c: CatalogController; currentGlucose: string; onCurrentGlucoseChange: (value: string) => void }) {
  return <>
    <article className="meal-summary" data-testid="meal-summary">
      <div className="section-title-row"><div><span className="eyebrow">Gesammelte Berechnung</span><h2>Produkte</h2></div><span>{c.mealItems.length}</span></div>
      <div className="meal-item-list">{c.mealItems.map((item) => <article className="meal-item" key={item.id} data-testid="meal-item">
        <button type="button" className="meal-item__product" onClick={() => c.openMealItem(item.id)} aria-label={`${item.product.displayName}: Details öffnen`}>
          <strong>{item.product.displayName}</strong><small>{item.product.brand ?? 'Produktdetails öffnen'} · Details öffnen →</small>
        </button>
        <label className="field meal-item__amount"><span>Menge</span><input type="number" min="0.01" max="10000" step="any" value={item.request.amount} aria-label={`${item.product.displayName}: Menge`} onChange={(event: ChangeEvent<HTMLInputElement>) => { const amount = Number(event.target.value); if (Number.isFinite(amount) && amount > 0) c.updateMealItem(item.id, amount); }} /></label>
        <label className="field meal-item__unit"><span>Einheit</span><select value={item.resolution.selectedOptionId ?? ''} aria-label={`${item.product.displayName}: Einheit`} onChange={(event: ChangeEvent<HTMLSelectElement>) => c.updateMealItem(item.id, item.request.amount, event.target.value)}>{item.resolution.options.map((option) => <option key={option.id} value={option.id} disabled={option.baseValue === null}>{option.label}{option.baseValue === null ? ' – Gewicht fehlt' : ''}</option>)}</select></label>
        <strong className="meal-item__carbs">{formatCarbohydrates(item.calculation.carbohydratesG, c.settings.decimalPlaces)} g KH</strong>
        <button type="button" className="meal-item__remove" onClick={() => c.removeMealItem(item.id)} aria-label={`${item.product.displayName} aus der Gesamtrechnung entfernen`} title="Entfernen">−</button>
      </article>)}</div>
      <section className="calculation-result meal-total-result" aria-live="polite" data-testid="meal-total" data-total-carbs-g={c.mealTotalCarbohydrates}>
        <span>Kohlenhydrate der Gesamtrechnung</span><strong>{formatCarbohydrates(c.mealTotalCarbohydrates, c.settings.decimalPlaces)} g KH</strong><small>Summe aus {c.mealItems.length} {c.mealItems.length === 1 ? 'Produkt' : 'Produkten'} ohne Zwischenrundung</small>
      </section>
      <div className="meal-summary__actions"><button type="button" className="button button--primary" onClick={c.startNextMealProduct}>+ Weiteres Produkt</button><span className="meal-auto-save">✓ Automatisch im Verlauf gespeichert</span><button type="button" className="button button--danger" onClick={() => { if (window.confirm('Aktuelle Rechnung zurücksetzen? Die automatisch gespeicherte Version bleibt im Verlauf verfügbar.')) c.clearMeal(); }}>Aktuelle Rechnung zurücksetzen</button></div>
      {c.mealMessage && <p className="inline-message" role="status">{c.mealMessage}</p>}
    </article>
    {c.settings.diabeticProfileEnabled && <>{c.mealNeedsCurrentGlucose && <p className="current-glucose-prompt" role="status">Bitte gib deinen aktuellen Blutzucker ein. Der Bolus wird für diese wiederverwendete Rechnung neu berechnet.</p>}<DiabetesBolusPanel settings={c.settings} carbohydratesG={c.mealTotalCarbohydrates} currentGlucose={currentGlucose} onCurrentGlucoseChange={(value) => { c.acknowledgeMealGlucose(); onCurrentGlucoseChange(value); }} lastBolusTime={c.lastBolusTime} lastBolusUnits={c.lastBolusUnits} onLastBolusTimeChange={c.setLastBolusTime} onLastBolusUnitsChange={c.setLastBolusUnits} focusRequest={c.mealGlucoseFocusRequest} /></>}
  </>;
}

function EditableProductImage({ catalogSrc, localSrc, alt, onPhoto }: { catalogSrc: string | null; localSrc: string | null; alt: string; onPhoto: (file: File | null) => void }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const effectiveCatalogSrc = catalogSrc && failedSrc !== catalogSrc ? catalogSrc : null;
  if (localSrc) return <label className="product-photo-capture product-photo-capture--saved" title="Produktfoto ersetzen"><img src={localSrc} alt={alt} width="126" height="126" /><input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event: ChangeEvent<HTMLInputElement>) => { onPhoto(event.target.files?.[0] ?? null); event.target.value = ''; }} aria-label="Produktfoto ersetzen" /></label>;
  if (effectiveCatalogSrc) return <img src={effectiveCatalogSrc} alt={alt} width="126" height="126" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailedSrc(effectiveCatalogSrc)} />;
  return <label className="product-photo-capture" title="Produkt fotografieren"><span className="product-image-fallback" aria-hidden="true">▧</span><small>Foto hinzufügen</small><input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event: ChangeEvent<HTMLInputElement>) => { onPhoto(event.target.files?.[0] ?? null); event.target.value = ''; }} aria-label="Produkt fotografieren und lokal speichern" data-testid="catalog-product-photo" /></label>;
}

export function CalculatorScreen({ c }: { c: CatalogController }) {
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void c.executeProductInput(c.query); };
  const product = c.product;
  const resolution = c.resolution;
  const calculation = c.calculation;
  const selected = c.selectedOption;
  const [amountValue, setAmountValue] = useState(String(c.request.amount));
  const [clinicBrowsePage, setClinicBrowsePage] = useState(0);
  const [calibrationOpen, setCalibrationOpen] = useState(false);
  const [currentGlucose, setCurrentGlucose] = useState('');
  const productCardRef = useRef<HTMLElement | null>(null);
  const eligibleCount = c.search.candidates.filter((hit) => catalogProductEligibility(hit).eligible).length;
  const imageUrl = product ? catalogProductImageUrl(product) : null;
  const localImageUrl = product ? c.catalogPhotoUrl(product.code) : null;
  const hasDefinedServing = Boolean(resolution?.options.some((option) => option.baseValue !== null && ['piece', 'bar', 'slice', 'portion'].includes(option.unit)));
  useEffect(() => { void c.search.query; setAmountValue(String(c.request.amount)); }, [c.request.amount, c.search.query]);
  useEffect(() => { if (c.mealGlucoseFocusRequest > 0) setCurrentGlucose(''); }, [c.mealGlucoseFocusRequest]);
  useEffect(() => {
    if (!product) return;
    const frame = requestAnimationFrame(() => {
      productCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      productCardRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [product]);
  useEffect(() => { if (product && !isGenericCatalogProduct(product) && (!isClinicCatalogProduct(product) || product.clinic.directCarbohydratesPerUnit === null)) setCalibrationOpen(!hasDefinedServing); }, [hasDefinedServing, product]);
  const clinicBrowsePageSize = 20;
  const clinicBrowse = c.clinicBrowseCandidates.slice(clinicBrowsePage * clinicBrowsePageSize, (clinicBrowsePage + 1) * clinicBrowsePageSize);
  const carbohydratesForBolus = c.manualMode ? c.manualCalculation : calculation?.status === 'calculated' ? calculation.carbohydratesG : null;

  if (c.mealOpen && c.mealItems.length > 0) return (
    <section className="screen calculator-screen" aria-labelledby="calculator-title">
      <header className="screen-heading"><div><span className="eyebrow">Gesamtrechnung</span><h1 id="calculator-title">Deine Mahlzeit</h1></div><button type="button" className="button button--secondary" onClick={c.startNextMealProduct}>Zur Produktsuche</button></header>
      <MealSummary c={c} currentGlucose={currentGlucose} onCurrentGlucoseChange={setCurrentGlucose} />
      <FloatingMealControls c={c} />
    </section>
  );

  return (
    <section className="screen calculator-screen" aria-labelledby="calculator-title">
      <header className="screen-heading">
        <div><h1 id="calculator-title">Kohlenhydrate berechnen</h1></div>
        <fieldset className="mode-switch" aria-label="Berechnungsart">
          <button type="button" className={!c.manualMode ? 'is-active' : ''} aria-pressed={!c.manualMode} onClick={() => c.setManualMode(false)}>Produkt</button>
          <button type="button" className={c.manualMode ? 'is-active' : ''} aria-pressed={c.manualMode} onClick={() => c.setManualMode(true)}>Manuell</button>
        </fieldset>
      </header>

      {c.settings.diabeticProfileEnabled && (c.manualMode || !product) && <DiabetesBolusPanel settings={c.settings} carbohydratesG={carbohydratesForBolus} currentGlucose={currentGlucose} onCurrentGlucoseChange={setCurrentGlucose} lastBolusTime={c.lastBolusTime} lastBolusUnits={c.lastBolusUnits} onLastBolusTimeChange={c.setLastBolusTime} onLastBolusUnitsChange={c.setLastBolusUnits} />}

      {!c.manualMode ? <>
        <search><form className="search-card" onSubmit={submit} data-search-phase={c.search.phase}>
          <label htmlFor="catalog-search-input">Produktname oder Barcode</label>
          <div className="search-row">
            <input id="catalog-search-input" data-testid="catalog-search-input" type="search" inputMode="search" autoComplete="off" maxLength={120} placeholder={c.speechListening ? 'Höre zu …' : 'z. B. 3 Riegel Kinder Bueno'} value={c.query} onChange={(event: ChangeEvent<HTMLInputElement>) => c.setQuery(event.target.value)} />
            <button type="button" className="button button--secondary speech-button" onClick={c.startVoiceSearch} aria-pressed={c.speechListening} aria-label={c.speechListening ? 'Spracheingabe beenden' : 'Spracheingabe starten'} data-testid="catalog-speech-search">{c.speechListening ? '■ Stoppen' : '🎙 Sprechen'}</button>
            <button type="submit" className="button button--primary" data-testid="catalog-search-submit">{c.search.phase === 'searching' ? 'Neu suchen' : 'Suchen'}</button>
          </div>
          {c.speechListening && <div className="speech-recording" role="status" aria-live="polite"><span aria-hidden="true" />Höre zu …</div>}
          <small>Die Produktsuche bleibt vollständig lokal. Per Text oder Sprache kannst du auch mehrere Produkte nennen, z. B. „2 Scheiben Brot mit 20 g Nutella und 400 ml Sprite“.</small>
          {c.speechMessage && <small className="speech-message" role="status">{c.speechMessage}</small>}
          {(c.query || c.product || c.search.phase !== 'idle') && <div className="search-reset-row"><button type="button" className="button button--ghost" onClick={c.startNextMealProduct}>Suche zurücksetzen</button></div>}
        </form></search>

        {c.search.validationMessage && <div className="inline-message" role="alert">{c.search.validationMessage}</div>}
        {c.search.phase === 'not_found' && <section className="empty-state" data-search-outcome="not_found"><strong>Kein passendes Produkt gefunden</strong><p>Es wird kein fremdes Ersatzprodukt eingesetzt.</p></section>}

        {(c.search.phase === 'needs_product_choice' || (c.search.phase === 'resolved' && c.search.candidates.length > 1)) && <section className="results-panel" aria-labelledby="results-title" data-testid="catalog-search-results" data-result-count={c.search.candidates.length} data-order-authority="sqlite">
          <div className="section-title-row"><div><span className="eyebrow">SQLite-Reihenfolge</span><h2 id="results-title">{c.search.phase === 'resolved' ? 'Weitere passende Produkte' : 'Produkt auswählen'}</h2></div><span>{c.search.candidates.length} Treffer</span></div>
          <div className="result-list">{c.search.candidates.map((hit, index) => {
            const eligible = catalogProductEligibility(hit).eligible;
            const auto = autoSelectionEligibility(hit, c.search.query, eligible, eligibleCount);
            return <button key={`${hit.productId}-${hit.resultIndex}`} type="button" className="product-result" data-testid="catalog-search-result" data-result-index={hit.resultIndex} data-rank-ordinal={hit.rankOrdinal} data-auto-select-eligible={String(auto.eligible)} data-catalog-eligible={String(eligible)} onClick={() => c.selectCandidate(hit)}>
              <span className="result-position">{index + 1}</span><ProductImage src={c.settings.productImageMode === 'remote' ? c.catalogPhotoUrl(hit.code) ?? catalogProductImageUrl(hit) : null} alt={hit.displayName} compact /><span className="result-copy"><strong>{hit.displayName}</strong>{isClinicCatalogProduct(hit) ? <ClinicTag compact /> : <small>{subtitle(hit.brand, hit.code) || 'Ohne Markenangabe'}</small>}</span><span className="result-nutrition">{nutritionLabel(hit)}</span>
            </button>;
          })}</div><nav className="pagination" aria-label="Weitere passende Produkte"><button type="button" className="button button--secondary" disabled={c.searchPage === 0} onClick={() => c.changeSearchPage(c.searchPage - 1)}>← Zurück</button><span>Seite {c.searchPage + 1}</span><button type="button" className="button button--secondary" disabled={!c.searchHasNext} onClick={() => c.changeSearchPage(c.searchPage + 1)}>Weiter →</button></nav>
        </section>}

        {c.settings.clinicMode === 'clinic-only' && c.search.phase === 'idle' && <section className="results-panel clinic-browser" data-testid="clinic-catalog-browser"><div className="section-title-row"><div><span className="eyebrow">KLINIK ONLY</span><h2>Klinikkatalog durchsuchen</h2></div><span>{c.clinicBrowseCandidates.length} Einträge</span></div><div className="result-list">{clinicBrowse.map((hit, index) => <button key={hit.productId} type="button" className="product-result" onClick={() => c.selectCandidate(hit)}><span className="result-position">{clinicBrowsePage * clinicBrowsePageSize + index + 1}</span><ProductImage src={c.settings.productImageMode === 'remote' ? c.catalogPhotoUrl(hit.code) ?? catalogProductImageUrl(hit) : null} alt={hit.displayName} compact /><span className="result-copy"><strong>{hit.displayName}</strong><ClinicTag compact /></span><span className="result-nutrition">{nutritionLabel(hit)}</span></button>)}</div><nav className="pagination" aria-label="Klinikkatalog Seiten"><button type="button" className="button button--secondary" disabled={clinicBrowsePage === 0} onClick={() => setClinicBrowsePage((page) => Math.max(0, page - 1))}>← Zurück</button><span>Seite {clinicBrowsePage + 1} / {Math.ceil(c.clinicBrowseCandidates.length / clinicBrowsePageSize)}</span><button type="button" className="button button--secondary" disabled={(clinicBrowsePage + 1) * clinicBrowsePageSize >= c.clinicBrowseCandidates.length} onClick={() => setClinicBrowsePage((page) => page + 1)}>Weiter →</button></nav></section>}

        {product && resolution && <article ref={productCardRef} tabIndex={-1} className="product-card" data-testid="catalog-product" data-product-id={product.productId} data-gtin={product.code} data-amount={c.request.amount} data-carbs-per-100-g={product.nutrition.basis === 'mass' ? product.nutrition.carbohydratesPer100 : ''} data-carbs-per-100-ml={product.nutrition.basis === 'volume' ? product.nutrition.carbohydratesPer100 : ''} data-nutrition-basis={product.nutrition.basis} data-unit-resolution-status={resolution.status}>
          <div className="product-card__header">
            {c.settings.productImageMode === 'remote' && <EditableProductImage catalogSrc={imageUrl} localSrc={localImageUrl} alt={product.displayName} onPhoto={(file) => { void c.setCatalogPhoto(file); }} />}
            <div>{isClinicCatalogProduct(product) && <ClinicTag />}<span className="eyebrow">{isClinicCatalogProduct(product) ? 'Klinikwert' : isGenericCatalogProduct(product) ? 'Generische Referenz · gekocht' : 'Katalogprodukt'}</span><h2>{product.displayName}</h2><p>{isClinicCatalogProduct(product) ? nutritionLabel(product) : isGenericCatalogProduct(product) ? product.brand : subtitle(product.brand, product.code)}</p></div>
            <button type="button" className="favorite-button" aria-pressed={c.isFavorite} onClick={c.toggleFavorite}><span aria-hidden="true">{c.isFavorite ? '★' : '☆'}</span>{c.isFavorite ? 'Favorit' : 'Merken'}</button>
          </div>
          {c.productPhotoMessage && <p className="product-photo-message inline-message" role="status">{c.productPhotoMessage}</p>}
          <div className="calculation-grid">
            {c.search.candidates.length > 1 && <label className="field field--wide variant-picker"><span>Produktvariante</span><select value={String(product.productId)} onChange={(event: ChangeEvent<HTMLSelectElement>) => { const next = c.search.candidates.find((candidate) => String(candidate.productId) === event.target.value); if (next) c.selectCandidate(next); }} data-testid="catalog-variant-select">{c.search.candidates.map((candidate) => <option key={candidate.productId} value={candidate.productId}>{candidate.displayName}{candidate.brand ? ` · ${candidate.brand}` : ''}</option>)}</select><small>Der beste Treffer ist vorausgewählt; alle Varianten bleiben direkt umschaltbar.</small></label>}
            <label className="field"><span>Menge</span><input type="number" min="0.01" max="10000" step="any" value={amountValue} onChange={(event: ChangeEvent<HTMLInputElement>) => { const value = event.target.value; setAmountValue(value); const amount = Number(value); if (value !== '' && Number.isFinite(amount) && amount > 0) c.setRequest((r) => ({ ...r, amount })); }} onBlur={() => { const amount = Number(amountValue); if (!Number.isFinite(amount) || amount <= 0) setAmountValue(String(c.request.amount)); }} data-testid="catalog-amount-input" />{selected && (selected.unit === 'g' || selected.unit === 'ml') && <div className="amount-slider"><input type="range" min="1" max={selected.unit === 'g' ? '400' : '1000'} step="1" value={Math.max(1, Math.min(selected.unit === 'g' ? 400 : 1000, Number(amountValue) || c.request.amount))} onChange={(event: ChangeEvent<HTMLInputElement>) => { const value = event.target.value; setAmountValue(value); c.setRequest((current) => ({ ...current, amount: Number(value) })); }} aria-label={`${selected.unit === 'g' ? 'Gramm' : 'Milliliter'}-Menge per Schieberegler`} data-testid="catalog-amount-slider" /><small><span>1 {selected.unit}</span><span>{selected.unit === 'g' ? '400 g' : '1.000 ml'}</span></small></div>}</label>
            <label className="field field--wide"><span>Einheit</span><select value={c.selectedOptionId ?? ''} onChange={(event: ChangeEvent<HTMLSelectElement>) => c.selectUnit(event.target.value)} data-testid="catalog-unit-select">
              {resolution.options.map((option) => <option key={option.id} value={option.id} data-unit-kind={option.unit} data-unit-provenance={semanticUnitProvenance(option)} data-unit-weight-g={option.basis === 'mass' && option.baseValue !== null ? option.baseValue : ''} data-unit-volume-ml={option.basis === 'volume' && option.baseValue !== null ? option.baseValue : ''} data-unit-recommended={String(option.recommended)}>{option.label}{option.baseValue === null ? ' – Gewicht fehlt' : ` – ${option.baseValue.toLocaleString('de-DE')} ${option.basis === 'mass' ? 'g' : 'ml'}`}</option>)}
            </select>{selected && <small>{selected.note}</small>}</label>
          </div>

          {calculation?.status === 'calculated' && calculation.carbohydratesG !== null ? <section className="calculation-result" aria-live="polite" data-testid="catalog-calculation" data-status="calculated" data-total-carbs-g={calculation.carbohydratesG} data-total-mass-g={calculation.totalMassG ?? ''} data-total-volume-ml={calculation.totalVolumeMl ?? ''} data-unit-kind={calculation.unit} data-unit-base-value={calculation.unitBaseValue ?? ''} data-provenance={calculation.provenance.source ?? ''}>
            <span>Kohlenhydrate gesamt</span><strong>{formatCarbohydrates(calculation.carbohydratesG, c.settings.decimalPlaces)} g KH</strong><small>{isClinicCatalogProduct(product) && product.clinic.directCarbohydratesPerUnit !== null ? `Direkter Klinikwert · ${c.request.amount.toLocaleString('de-DE')} × ${product.clinic.directCarbohydratesPerUnit.toLocaleString('de-DE')} g KH je Stück` : `Intern ohne Zwischenrundung berechnet · ${c.request.amount.toLocaleString('de-DE')} × ${calculation.unitBaseValue?.toLocaleString('de-DE')} × ${product.nutrition.carbohydratesPer100.toLocaleString('de-DE')} / 100`}</small><button type="button" className="button button--secondary" onClick={c.addCurrentToMeal}>{c.editingMealItemId ? 'Änderung übernehmen & weiter' : '+ Zur Gesamtrechnung'}</button>{c.settings.saveHistory && <button type="button" className="button button--secondary" onClick={c.saveCurrent}>Im Verlauf speichern</button>}
          </section> : <section className="missing-calculation" data-testid="catalog-calculation" data-status={calculation?.status ?? 'not_calculable'}><strong>Für diese Einheit fehlt noch ein belastbares Gewicht.</strong><p>Du kannst die Einheit direkt unten durch gemeinsames Wiegen festlegen.</p></section>}

          {c.settings.diabeticProfileEnabled && <DiabetesBolusPanel settings={c.settings} carbohydratesG={carbohydratesForBolus} currentGlucose={currentGlucose} onCurrentGlucoseChange={setCurrentGlucose} lastBolusTime={c.lastBolusTime} lastBolusUnits={c.lastBolusUnits} onLastBolusTimeChange={c.setLastBolusTime} onLastBolusUnitsChange={c.setLastBolusUnits} />}

          {product.nutrition.basis === 'mass' && !isGenericCatalogProduct(product) && (!isClinicCatalogProduct(product) || product.clinic.directCarbohydratesPerUnit === null) && <details className="calibration-card" open={calibrationOpen} onToggle={(event) => setCalibrationOpen(event.currentTarget.open)} data-testid="catalog-calibration" data-status="always-available">
            <summary><span><span className="eyebrow">Persönliche Standard-Einheit</span><strong>Serving-Einheit selbst abwiegen</strong></span><small>{hasDefinedServing ? 'Bereits definiert · bei Bedarf ändern' : 'Noch keine Portion definiert'}</small></summary>
            <div className="calibration-card__body"><p>Wiege eine frei wählbare Anzahl gemeinsam. Das Einzelgewicht wird automatisch berechnet, gespeichert, sofort ausgewählt und bei jeder späteren Suche als Standard verwendet.</p>
            <div className="calibration-fields"><label className="field"><span>Einheit</span><select value={c.calibrationUnit} onChange={(event: ChangeEvent<HTMLSelectElement>) => c.changeCalibrationUnit(event.target.value as typeof c.calibrationUnit)} data-testid="catalog-calibration-unit"><option value="piece">Stück</option><option value="bar">Riegel</option><option value="slice">Scheibe</option><option value="portion">Portion</option></select></label><label className="field"><span>Anzahl gemeinsam gewogen</span><input type="number" min="1" max="10000" step="1" value={c.calibrationCount} onChange={(event: ChangeEvent<HTMLInputElement>) => c.setCalibrationCount(event.target.value)} data-testid="catalog-calibration-count" /></label><label className="field"><span>Gesamtgewicht in g</span><input type="number" min="0.01" step="any" value={c.calibrationWeight} onChange={(event: ChangeEvent<HTMLInputElement>) => c.setCalibrationWeight(event.target.value)} placeholder="z. B. 28,8" data-testid="catalog-calibration-weight" /></label></div>
            {c.calibrationPreview && <dl className="calibration-preview" data-testid="catalog-calibration-preview" data-derived-unit-weight-g={c.calibrationPreview.unitWeightG} data-derived-carbs-per-unit-g={c.calibrationPreview.carbsPerUnitG ?? ''} data-requested-total-carbs-g={c.calibrationPreview.requestedTotalCarbsG ?? ''}><div><dt>Gewicht je Einheit</dt><dd>{c.calibrationPreview.unitWeightG.toLocaleString('de-DE')} g</dd></div><div><dt>KH je Einheit</dt><dd>{c.calibrationPreview.carbsPerUnitG?.toLocaleString('de-DE') ?? '–'} g</dd></div><div><dt>KH für deine Menge</dt><dd>{c.calibrationPreview.requestedTotalCarbsG?.toLocaleString('de-DE') ?? '–'} g</dd></div></dl>}
            {c.calibrationMessage && <p className="inline-message" role="status">{c.calibrationMessage}</p>}<small>Gültige Änderungen werden nach kurzer Eingabepause automatisch lokal gespeichert.</small>
            </div>
          </details>}
        </article>}
      </> : <section className="manual-card" aria-labelledby="manual-title">
        <span className="eyebrow">Eigene Produkte · nur auf diesem Gerät</span><h2 id="manual-title">Produkt manuell anlegen</h2><p>Übertrage den KH-Wert vom Etikett, ergänze auf Wunsch ein Foto und speichere das Produkt lokal.</p>
        <div className="manual-photo-row">
          {c.manual.imageDataUrl ? <img src={c.manual.imageDataUrl} alt="Foto des eigenen Produkts" className="manual-product-photo" /> : <span className="manual-product-photo manual-product-photo--empty" aria-hidden="true">▧</span>}
          <div className="button-row"><label className="button button--secondary manual-photo-button">Foto aufnehmen oder auswählen<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event: ChangeEvent<HTMLInputElement>) => { void c.setManualPhoto(event.target.files?.[0] ?? null); event.target.value = ''; }} data-testid="manual-product-photo" /></label>{c.manual.imageDataUrl && <button type="button" className="button button--ghost" onClick={() => c.setManual((current) => ({ ...current, imageDataUrl: null }))}>Foto entfernen</button>}</div>
        </div>
        <div className="manual-grid"><label className="field field--wide"><span>Bezeichnung</span><input value={c.manual.label} onChange={(event: ChangeEvent<HTMLInputElement>) => c.setManual((m) => ({ ...m, label: event.target.value }))} data-testid="manual-product-label" /></label><label className="field"><span>KH pro 100 {c.manual.basis === 'mass' ? 'g' : 'ml'}</span><input type="number" min="0" step="any" value={c.manual.carbohydratesPer100} onChange={(event: ChangeEvent<HTMLInputElement>) => c.setManual((m) => ({ ...m, carbohydratesPer100: event.target.value }))} data-testid="manual-product-carbs" /></label><label className="field"><span>Menge in {c.manual.basis === 'mass' ? 'g' : 'ml'}</span><input type="number" min="0.01" step="any" value={c.manual.amount} onChange={(event: ChangeEvent<HTMLInputElement>) => c.setManual((m) => ({ ...m, amount: event.target.value }))} /></label><label className="field"><span>Bezugsart</span><select value={c.manual.basis} onChange={(event: ChangeEvent<HTMLSelectElement>) => c.setManual((m) => ({ ...m, basis: event.target.value as 'mass' | 'volume' }))}><option value="mass">Gewicht</option><option value="volume">Volumen</option></select></label></div>
        <div className="button-row"><button type="button" className="button button--primary" onClick={c.saveManualDefinition} data-testid="manual-product-save">{c.manual.id ? 'Änderungen speichern' : 'Produkt lokal speichern'}</button><button type="button" className="button button--secondary" onClick={() => c.setManual({ id: null, label: '', carbohydratesPer100: '', amount: '100', basis: 'mass', imageDataUrl: null })}>Neues Produkt</button></div>
        {c.manualMessage && <p className="inline-message" role="status">{c.manualMessage}</p>}
        <section className="calculation-result" aria-live="polite"><span>Kohlenhydrate gesamt</span><strong>{formatCarbohydrates(c.manualCalculation, c.settings.decimalPlaces)} g KH</strong>{c.settings.saveHistory && c.manualCalculation !== null && <button type="button" className="button button--secondary" onClick={c.saveManual}>Im Verlauf speichern</button>}</section>
        {c.manualProducts.length > 0 && <section className="saved-manual-products" aria-labelledby="saved-manual-title"><div className="section-title-row"><div><span className="eyebrow">Lokal gespeichert</span><h3 id="saved-manual-title">Eigene Produkte</h3></div><span>{c.manualProducts.length}</span></div><div className="result-list">{c.manualProducts.map((item) => <article className="saved-manual-product" key={item.id}>{item.imageDataUrl ? <img src={item.imageDataUrl} alt="" /> : <span className="manual-product-photo manual-product-photo--empty" aria-hidden="true">▧</span>}<div><strong>{item.label}</strong><small>{item.carbohydratesPer100.toLocaleString('de-DE')} g KH / 100 {item.basis === 'mass' ? 'g' : 'ml'}</small></div><button type="button" className="button button--secondary" onClick={() => c.loadManualDefinition(item)}>Laden</button><button type="button" className="button button--ghost" onClick={() => c.removeManualDefinition(item.id)} aria-label={`${item.label} löschen`}>Löschen</button></article>)}</div></section>}
      </section>}
      {!c.manualMode && <FloatingMealControls c={c} />}
    </section>
  );
}
