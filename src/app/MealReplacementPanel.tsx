import type { MealReplacementController } from './useMealReplacementController';
import '../meal-replacement.css';

export function MealReplacementPanel({ c }: { c: MealReplacementController }) {
  if (c.replacingMealItem) {
    return (
      <aside className="meal-replacement-context" data-testid="meal-replacement-context" aria-live="polite">
        <div>
          <span className="eyebrow">Gesamtrechnung bearbeiten</span>
          <strong>{c.replacingMealItem.product.displayName} ersetzen</strong>
          <small>Menge und passende Einheit bleiben erhalten. Wähle unten ein anderes lokales Produkt oder ändere den Suchbegriff.</small>
        </div>
        <button type="button" className="button button--secondary" onClick={c.cancelMealItemReplacement} disabled={c.replacementPending}>Abbrechen</button>
      </aside>
    );
  }

  if (!c.mealOpen || c.mealItems.length === 0) return null;

  return (
    <section className="meal-replacement-panel" aria-labelledby="meal-replacement-title" data-testid="meal-replacement-panel">
      <div className="section-title-row">
        <div>
          <span className="eyebrow">Alternativen aus dem lokalen Katalog</span>
          <h2 id="meal-replacement-title">Produkt austauschen</h2>
        </div>
      </div>
      <p>Wähle die Zeile, deren Produkt ersetzt werden soll. Die übrigen Produkte und ihre Mengen bleiben unverändert.</p>
      <div className="meal-replacement-list">
        {c.mealItems.map((item) => (
          <button
            key={item.id}
            type="button"
            className="meal-replacement-button"
            onClick={() => { void c.startMealItemReplacement(item.id); }}
            disabled={c.replacementPending}
            data-testid="meal-product-replace"
            data-meal-item-id={item.id}
          >
            <span><strong>{item.product.displayName}</strong><small>{item.request.amount.toLocaleString('de-DE')} {item.calculation.unit}</small></span>
            <b>Produkt tauschen →</b>
          </button>
        ))}
      </div>
    </section>
  );
}
