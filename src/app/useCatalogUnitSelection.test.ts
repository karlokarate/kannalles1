import { describe, expect, it } from 'vitest';
import type {
  CatalogUnitRequest,
  CatalogUnitResolution,
  ResolvedUnitOption
} from '../lib/resolution/catalogResolution';
import {
  resolveCatalogUnitSelection,
  type CatalogUnitSelectionState
} from './useCatalogUnitSelection';

function option(
  id: string,
  unit: ResolvedUnitOption['unit'],
  source: ResolvedUnitOption['source'],
  baseValue: number,
  recommended = false
): ResolvedUnitOption {
  return {
    id,
    unit,
    label: unit,
    basis: 'mass',
    baseValue,
    source,
    recommended,
    smallestEdibleUnit: false,
    priority: source === 'user_calibration' ? 10 : 100,
    note: ''
  };
}

const gram = option('g:direct_mass:1', 'g', 'direct_mass', 1);
const personalPortion = option(
  'portion:user_calibration:0.4',
  'portion',
  'user_calibration',
  0.4,
  true
);
const resolution: CatalogUnitResolution = {
  status: 'resolved',
  selectedOptionId: personalPortion.id,
  options: [personalPortion, gram],
  reason: 'calibration-preferred'
};

function request(
  unit: CatalogUnitRequest['unit'],
  unitExplicit: boolean
): CatalogUnitRequest {
  return { amount: 13, unit, unitExplicit };
}

describe('catalog unit selection authority', () => {
  it('replaces a stale gram selection with the personal default for implicit input', () => {
    const current: CatalogUnitSelectionState = {
      productKey: '1|20005627',
      optionId: gram.id
    };

    expect(resolveCatalogUnitSelection(
      current,
      '1|20005627',
      resolution,
      request('g', false)
    )).toEqual({
      productKey: '1|20005627',
      optionId: personalPortion.id
    });
  });

  it('uses the resolver default immediately when the product changes', () => {
    expect(resolveCatalogUnitSelection(
      { productKey: 'old|product', optionId: gram.id },
      '1|20005627',
      resolution,
      request('portion', true)
    )).toEqual({
      productKey: '1|20005627',
      optionId: personalPortion.id
    });
  });

  it('preserves a deliberate option only for the same explicit unit and product', () => {
    const manufacturerPortion = option(
      'portion:manufacturer_serving:15',
      'portion',
      'manufacturer_serving',
      15
    );
    const multiple: CatalogUnitResolution = {
      ...resolution,
      options: [personalPortion, manufacturerPortion, gram]
    };

    expect(resolveCatalogUnitSelection(
      { productKey: '1|20005627', optionId: manufacturerPortion.id },
      '1|20005627',
      multiple,
      request('portion', true)
    )).toEqual({
      productKey: '1|20005627',
      optionId: manufacturerPortion.id
    });
  });

  it('falls back when an explicit selection no longer matches the request unit', () => {
    expect(resolveCatalogUnitSelection(
      { productKey: '1|20005627', optionId: gram.id },
      '1|20005627',
      resolution,
      request('portion', true)
    )).toEqual({
      productKey: '1|20005627',
      optionId: personalPortion.id
    });
  });

  it('clears selection when no product or resolution exists', () => {
    expect(resolveCatalogUnitSelection(
      { productKey: '1|20005627', optionId: personalPortion.id },
      null,
      null,
      request('g', false)
    )).toEqual({ productKey: null, optionId: null });
  });
});
