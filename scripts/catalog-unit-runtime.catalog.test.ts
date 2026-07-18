/// <reference types="node" />

import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveCatalogUnitRuntime } from '../src/app/catalogUnitRuntime';
import { projectCatalogProductRow, type CatalogSqlRow } from '../src/lib/catalog/catalogProjection';
import {
  calculateCatalogCarbohydrates,
  catalogProductEligibility,
  type RequestedUnit
} from '../src/lib/resolution/catalogResolution';

const CATALOG_PATH = fileURLToPath(new URL('../Catalog/kh-checker-dach-v1.sqlite', import.meta.url));
const SAMPLE_PER_CLASS = 24;

function rows(database: DatabaseSync, where: string): CatalogSqlRow[] {
  return database.prepare(`
    SELECT p.id,p.g,p.n,d.v AS brand,p.c,p.s,p.q,p.u,p.m,p.r
    FROM p
    LEFT JOIN d ON d.id=p.b
    WHERE ${where}
    ORDER BY p.r DESC, p.n COLLATE NOCASE ASC, p.id ASC
    LIMIT ?
  `).all(SAMPLE_PER_CLASS) as CatalogSqlRow[];
}

function explicitUnit(product: ReturnType<typeof projectCatalogProductRow>): RequestedUnit {
  return product.nutrition.basis === 'mass' ? 'g' : 'ml';
}

function oppositeUnit(product: ReturnType<typeof projectCatalogProductRow>): RequestedUnit {
  return product.nutrition.basis === 'mass' ? 'ml' : 'g';
}

function assertResolutionInvariants(
  product: ReturnType<typeof projectCatalogProductRow>,
  state: ReturnType<typeof resolveCatalogUnitRuntime>
): void {
  const { resolution } = state;
  const ids = resolution.options.map((option) => option.id);
  expect(new Set(ids).size, `${product.code} must not expose duplicate option ids`).toBe(ids.length);
  expect(resolution.options.some((option) => option.unit === 'kg'), `${product.code} must canonicalize kg`).toBe(false);
  if (resolution.selectedOptionId !== null) {
    expect(ids, `${product.code} selected option must exist`).toContain(resolution.selectedOptionId);
    expect(resolution.options[0]?.id, `${product.code} selected option must be ordered first`).toBe(resolution.selectedOptionId);
    expect(resolution.options.filter((option) => option.recommended), `${product.code} must have one recommendation`).toHaveLength(1);
  }
}

function calibratable(unit: RequestedUnit): boolean {
  return unit === 'piece' || unit === 'bar' || unit === 'slice' || unit === 'portion';
}

describe('catalog unit runtime against the production SQLite catalog', () => {
  it('calculates direct mass and volume requests for representative evidence classes without rounding', () => {
    const database = new DatabaseSync(CATALOG_PATH, { readOnly: true });
    try {
      const samples = [
        ...rows(database, 'p.u IS NOT NULL'),
        ...rows(database, 'p.u IS NULL AND p.s IS NOT NULL'),
        ...rows(database, 'p.u IS NULL AND p.s IS NULL AND p.q IS NOT NULL'),
        ...rows(database, 'p.u IS NULL AND p.s IS NULL AND p.q IS NULL AND (p.m & 1)=0'),
        ...rows(database, '(p.m & 1)=1')
      ].map(projectCatalogProductRow);
      expect(samples.length).toBeGreaterThanOrEqual(SAMPLE_PER_CLASS * 4);

      for (const product of samples) {
        const unit = explicitUnit(product);
        const request = { amount: 2.75, unit, unitExplicit: true } as const;
        const state = resolveCatalogUnitRuntime(product, request);
        assertResolutionInvariants(product, state);
        expect(state.prompt, `${product.code} standard mode must never create a prompt`).toBeNull();
        expect(state.resolution.status, `${product.code} direct basis must resolve`).toBe('resolved');
        expect(state.resolution.options[0], `${product.code} direct basis option`).toMatchObject({
          unit,
          baseValue: 1,
          recommended: true
        });

        const calculation = calculateCatalogCarbohydrates(product, request, state.resolution);
        expect(calculation.status, `${product.code} direct calculation status`).toBe('calculated');
        expect(calculation.carbohydratesG, `${product.code} full precision calculation`).toBe(
          2.75 * product.nutrition.carbohydratesPer100 / 100
        );
        expect(calculation.totalMassG, `${product.code} mass provenance`).toBe(product.nutrition.basis === 'mass' ? 2.75 : null);
        expect(calculation.totalVolumeMl, `${product.code} volume provenance`).toBe(product.nutrition.basis === 'volume' ? 2.75 : null);

        const oppositeRequest = { amount: 100, unit: oppositeUnit(product), unitExplicit: true } as const;
        const opposite = resolveCatalogUnitRuntime(product, oppositeRequest);
        assertResolutionInvariants(product, opposite);
        expect(opposite.resolution.status, `${product.code} must not assume density`).toBe('not_calculable');
        expect(calculateCatalogCarbohydrates(product, oppositeRequest, opposite.resolution).carbohydratesG).toBeNull();
      }
    } finally {
      database.close();
    }
  });

  it('uses only resolver-validated smallest-unit and manufacturer-serving evidence', () => {
    const database = new DatabaseSync(CATALOG_PATH, { readOnly: true });
    try {
      const provenProducts = rows(database, 'p.u IS NOT NULL').map(projectCatalogProductRow);
      const servingProducts = rows(database, 'p.u IS NULL AND p.s IS NOT NULL').map(projectCatalogProductRow);
      expect(provenProducts).toHaveLength(SAMPLE_PER_CLASS);
      expect(servingProducts).toHaveLength(SAMPLE_PER_CLASS);

      for (const product of provenProducts) {
        const evidence = product.unitEvidence.provenSmallestUnit;
        if (!evidence) throw new Error(`${product.code}: projected evidence expected`);
        const requestedUnit = evidence.unitKind as RequestedUnit;
        const state = resolveCatalogUnitRuntime(product, {
          amount: 3,
          unit: requestedUnit,
          unitExplicit: true
        }, 'smart');
        assertResolutionInvariants(product, state);
        const accepted = state.resolution.options.find((option) =>
          option.unit === evidence.unitKind
          && option.baseValue === evidence.baseValue
          && option.source === evidence.source
        );

        if (accepted) {
          expect(state.prompt, `${product.code} has valid ${evidence.unitKind} evidence`).toBeNull();
          expect(state.resolution.options[0]).toMatchObject({
            unit: evidence.unitKind,
            baseValue: evidence.baseValue,
            source: evidence.source
          });
        } else {
          expect(catalogProductEligibility(product).warnings, `${product.code} rejected evidence needs diagnostics`)
            .toContain('invalid-unit-evidence-ignored');
          expect(state.resolution.options.some((option) =>
            option.source === evidence.source && option.baseValue === evidence.baseValue
          ), `${product.code} rejected evidence must not remain selectable`).toBe(false);
          if (calibratable(requestedUnit) && product.nutrition.basis === 'mass') {
            expect(state.prompt, `${product.code} rejected evidence needs user calibration`).not.toBeNull();
          } else {
            expect(state.prompt, `${product.code} must not create an unsafe mass prompt`).toBeNull();
          }
        }
      }

      for (const product of servingProducts) {
        const serving = product.unitEvidence.manufacturerServing;
        if (!serving) throw new Error(`${product.code}: projected serving expected`);
        const state = resolveCatalogUnitRuntime(product, {
          amount: 1,
          unit: 'portion',
          unitExplicit: true
        }, 'smart');
        assertResolutionInvariants(product, state);
        const accepted = state.resolution.options.find((option) =>
          option.unit === 'portion'
          && option.baseValue === serving.baseValue
          && option.source === 'manufacturer_serving'
        );
        if (accepted) {
          expect(state.prompt, `${product.code} has valid manufacturer serving`).toBeNull();
          expect(state.resolution.options[0]).toMatchObject({
            unit: 'portion',
            baseValue: serving.baseValue,
            source: 'manufacturer_serving'
          });
        } else {
          expect(catalogProductEligibility(product).warnings).toContain('invalid-serving-ignored');
          expect(state.resolution.options.some((option) =>
            option.source === 'manufacturer_serving' && option.baseValue === serving.baseValue
          )).toBe(false);
        }
      }
    } finally {
      database.close();
    }
  });

  it('creates no guessed piece weight for mass products without deterministic unit evidence', () => {
    const database = new DatabaseSync(CATALOG_PATH, { readOnly: true });
    try {
      const products = rows(database, 'p.u IS NULL AND p.s IS NULL AND p.q IS NULL AND (p.m & 1)=0')
        .map(projectCatalogProductRow);
      expect(products).toHaveLength(SAMPLE_PER_CLASS);

      for (const product of products) {
        const request = { amount: 1, unit: 'piece' as const, unitExplicit: true };
        const standard = resolveCatalogUnitRuntime(product, request);
        const smart = resolveCatalogUnitRuntime(product, request, 'smart');
        assertResolutionInvariants(product, standard);
        assertResolutionInvariants(product, smart);
        expect(standard.resolution.status, `${product.code} must require calibration`).toBe('needs_unit_calibration');
        expect(standard.resolution.options[0]).toMatchObject({ unit: 'piece', baseValue: null, source: 'unresolved' });
        expect(smart.prompt, `${product.code} must ask for real piece weight`).toMatchObject({
          unit: 'piece',
          mode: 'unit-weight',
          defaultValue: null,
          baseValueG: null
        });
      }
    } finally {
      database.close();
    }
  });

  it('never offers a gram smart prompt for volume nutrition', () => {
    const database = new DatabaseSync(CATALOG_PATH, { readOnly: true });
    try {
      const products = rows(database, '(p.m & 1)=1').map(projectCatalogProductRow);
      expect(products).toHaveLength(SAMPLE_PER_CLASS);
      for (const product of products) {
        const state = resolveCatalogUnitRuntime(product, { amount: 1, unit: 'piece', unitExplicit: true }, 'smart');
        assertResolutionInvariants(product, state);
        expect(state.prompt, `${product.code} must not infer volume-to-mass`).toBeNull();
        expect(state.resolution.options[0]).toMatchObject({ unit: 'piece', baseValue: null });
      }
    } finally {
      database.close();
    }
  });
});
