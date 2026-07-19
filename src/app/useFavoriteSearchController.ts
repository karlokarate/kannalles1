import { useEffect, useRef } from 'react';
import type { CatalogSearchHit } from '../lib/catalog/catalogDomain';
import { catalogProductEligibility } from '../lib/resolution/catalogResolution';
import {
  loadMatchingFavoriteHits,
  prioritizeFavoriteHits,
  sameCatalogHitOrder
} from './favoriteSearch';
import { useMealReplacementController } from './useMealReplacementController';

export function useFavoriteSearchController() {
  const base = useMealReplacementController();
  const manualSelectionRef = useRef(false);

  useEffect(() => {
    if (base.search.phase === 'searching') manualSelectionRef.current = false;
  }, [base.search.phase]);

  useEffect(() => {
    if (manualSelectionRef.current
      || base.searchPage !== 0
      || (base.search.phase !== 'resolved' && base.search.phase !== 'needs_product_choice')
      || !base.search.query) return;

    const controller = new AbortController();
    void loadMatchingFavoriteHits(
      base.favorites,
      base.search.query,
      base.settings.clinicMode,
      controller.signal
    ).then((favoriteHits) => {
      if (controller.signal.aborted || favoriteHits.length === 0 || manualSelectionRef.current) return;
      const eligibleFavorites = favoriteHits.filter((hit) => catalogProductEligibility(hit).eligible);
      const preferred = eligibleFavorites[0] ?? null;
      if (!preferred) return;

      const merged = prioritizeFavoriteHits(favoriteHits, base.search.candidates);
      const alreadyApplied = base.search.selectedProduct?.productId === preferred.productId
        && sameCatalogHitOrder(base.search.candidates, merged);
      if (alreadyApplied) return;

      // The base controller is the only authority allowed to pair a selected
      // product with the current parsed request. Favorite promotion supplies
      // only product ordering and never reparses or mutates the amount itself.
      base.promoteSearchCandidate(preferred, merged);
    }).catch((error) => {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        // Favorite promotion is fail-soft; the normal deterministic search remains usable.
      }
    });

    return () => controller.abort();
  }, [
    base.favorites,
    base.promoteSearchCandidate,
    base.search.candidates,
    base.search.phase,
    base.search.query,
    base.search.selectedProduct?.productId,
    base.searchPage,
    base.settings.clinicMode
  ]);

  const executeSearch = async (raw: string, page = 0) => {
    manualSelectionRef.current = false;
    await base.executeSearch(raw, page);
  };

  const executeProductInput = async (input: string) => {
    manualSelectionRef.current = false;
    await base.executeProductInput(input);
  };

  const selectCandidate = (hit: CatalogSearchHit) => {
    manualSelectionRef.current = true;
    base.selectCandidate(hit);
  };

  return {
    ...base,
    executeSearch,
    executeProductInput,
    selectCandidate
  };
}

export type FavoriteSearchController = ReturnType<typeof useFavoriteSearchController>;
