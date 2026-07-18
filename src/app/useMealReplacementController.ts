import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CatalogProduct, CatalogSearchHit } from '../lib/catalog/catalogDomain';
import type { CatalogUnitRequest } from '../lib/resolution/catalogResolution';
import { isClinicCatalogProduct } from '../lib/clinicCatalog';
import type { MealCalculationItem } from '../lib/mealCalculation';
import { useSmartCatalogController } from './useSmartCatalogController';

interface PendingReplacementCommit {
  itemId: string;
  originalCount: number;
  originalProductName: string;
  replacementProductCode: string;
  replacementProductName: string;
  cleanupRequested: boolean;
}

function replacementRequest(item: MealCalculationItem, product: CatalogProduct): CatalogUnitRequest {
  const amount = item.request.amount;
  if (isClinicCatalogProduct(product) && product.clinic.directCarbohydratesPerUnit !== null) {
    return { amount, unit: 'piece', unitExplicit: true };
  }
  if ((item.request.unit === 'g' || item.request.unit === 'kg') && product.nutrition.basis === 'mass') {
    return { ...item.request };
  }
  if (item.request.unit === 'ml' && product.nutrition.basis === 'volume') {
    return { ...item.request };
  }
  if (['piece', 'bar', 'slice', 'portion', 'package'].includes(item.request.unit)) {
    return { ...item.request };
  }
  return {
    amount,
    unit: product.nutrition.basis === 'mass' ? 'g' : 'ml',
    unitExplicit: false
  };
}

function sameRequest(left: CatalogUnitRequest, right: CatalogUnitRequest): boolean {
  return left.amount === right.amount && left.unit === right.unit && left.unitExplicit === right.unitExplicit;
}

export function useMealReplacementController() {
  const base = useSmartCatalogController();
  const [replacingMealItemId, setReplacingMealItemId] = useState<string | null>(null);
  const [pendingCommit, setPendingCommit] = useState<PendingReplacementCommit | null>(null);
  const [replacementMessage, setReplacementMessage] = useState<string | null>(null);

  const replacingMealItem = useMemo(
    () => base.mealItems.find((item) => item.id === replacingMealItemId) ?? null,
    [base.mealItems, replacingMealItemId]
  );

  const finishReplacement = useCallback((commit: PendingReplacementCommit) => {
    setPendingCommit(null);
    setReplacingMealItemId(null);
    setReplacementMessage(`${commit.originalProductName} wurde durch ${commit.replacementProductName} ersetzt.`);
    base.openMealSummary();
  }, [base.openMealSummary]);

  useEffect(() => {
    if (!replacingMealItem || !base.product) return;
    const next = replacementRequest(replacingMealItem, base.product);
    base.setRequest((current) => sameRequest(current, next) ? current : next);
  }, [base.product, base.setRequest, replacingMealItem]);

  useEffect(() => {
    if (!pendingCommit) return;
    const original = base.mealItems.find((item) => item.id === pendingCommit.itemId) ?? null;
    const replacement = base.mealItems.find((item) => item.product.code === pendingCommit.replacementProductCode && item.id !== pendingCommit.itemId) ?? null;

    if (original?.product.code === pendingCommit.replacementProductCode) {
      finishReplacement(pendingCommit);
      return;
    }

    if (!pendingCommit.cleanupRequested && base.mealItems.length > pendingCommit.originalCount && replacement) {
      base.removeMealItem(pendingCommit.itemId);
      setPendingCommit({ ...pendingCommit, cleanupRequested: true });
      return;
    }

    if (pendingCommit.cleanupRequested && !original) finishReplacement(pendingCommit);
  }, [base.mealItems, base.removeMealItem, finishReplacement, pendingCommit]);

  const startMealItemReplacement = async (id: string) => {
    const item = base.mealItems.find((candidate) => candidate.id === id);
    if (!item) return;
    setReplacementMessage(null);
    setPendingCommit(null);
    setReplacingMealItemId(id);
    base.openMealItem(id);
    base.setQuery(item.product.displayName);
    await base.executeSearch(item.product.displayName);
  };

  const cancelMealItemReplacement = () => {
    setReplacingMealItemId(null);
    setPendingCommit(null);
    base.openMealSummary();
  };

  const selectCandidate = (hit: CatalogSearchHit) => base.selectCandidate(hit);

  const addCurrentToMeal = () => {
    if (!replacingMealItemId || !replacingMealItem || !base.product) {
      base.addCurrentToMeal();
      return;
    }
    setPendingCommit({
      itemId: replacingMealItemId,
      originalCount: base.mealItems.length,
      originalProductName: replacingMealItem.product.displayName,
      replacementProductCode: base.product.code,
      replacementProductName: base.product.displayName,
      cleanupRequested: false
    });
    base.addCurrentToMeal();
  };

  const startNextMealProduct = () => {
    setReplacingMealItemId(null);
    setPendingCommit(null);
    base.startNextMealProduct();
  };

  const openMealItem = (id: string) => {
    setReplacingMealItemId(null);
    setPendingCommit(null);
    base.openMealItem(id);
  };

  const clearMeal = () => {
    setReplacingMealItemId(null);
    setPendingCommit(null);
    setReplacementMessage(null);
    base.clearMeal();
  };

  const loadSavedMeal = async (saved: Parameters<typeof base.loadSavedMeal>[0]) => {
    setReplacingMealItemId(null);
    setPendingCommit(null);
    setReplacementMessage(null);
    await base.loadSavedMeal(saved);
  };

  return {
    ...base,
    selectCandidate,
    addCurrentToMeal,
    startNextMealProduct,
    openMealItem,
    clearMeal,
    loadSavedMeal,
    replacingMealItemId,
    replacingMealItem,
    replacementPending: pendingCommit !== null,
    startMealItemReplacement,
    cancelMealItemReplacement,
    mealMessage: replacementMessage ?? base.mealMessage
  };
}

export type MealReplacementController = ReturnType<typeof useMealReplacementController>;
