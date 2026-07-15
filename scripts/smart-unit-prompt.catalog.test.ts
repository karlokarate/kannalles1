/// <reference types="node" />

import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { projectCatalogProductRow, type CatalogSqlRow } from '../src/lib/catalog/catalogProjection';
import { resolveCatalogUnits, type RequestedUnit } from '../src/lib/resolution/catalogResolution';
import { createSmartUnitPrompt } from '../src/lib/smartUnitPrompt';

const CATALOG_PATH = fileURLToPath(new URL('../Catalog/kh-checker-dach-v1.sqlite', import.meta.url));
const SAMPLE_SIZE = 10;
const SAMPLE_SEED = 20_260_715;

function requestedEvidenceUnit(product: ReturnType<typeof projectCatalogProductRow>): RequestedUnit | null {
  const proven = product.unitEvidence.provenSmallestUnit?.unitKind;
  if (proven === 'piece' || proven === 'bar' || proven === 'slice' || proven === 'portion') return proven;
  return product.unitEvidence.manufacturerServing ? 'portion' : null;
}

describe('smart unit prompts against the production SQLite catalog', () => {
  it('checks ten reproducibly random mass-based products without redundant prompts', () => {
    const database = new DatabaseSync(CATALOG_PATH, { readOnly: true });
    try {
      const rows = database.prepare(`
        SELECT p.id,p.g,p.n,d.v AS brand,p.c,p.s,p.q,p.u,p.m,p.r
        FROM p
        LEFT JOIN d ON d.id=p.b
        WHERE (p.m & 1)=0
        ORDER BY ((abs(p.id % 2147483647) * 1103515245 + ?) % 2147483647), p.id
        LIMIT ?
      `).all(SAMPLE_SEED, SAMPLE_SIZE) as CatalogSqlRow[];
      expect(rows).toHaveLength(SAMPLE_SIZE);

      const report = rows.map((row) => {
        const product = projectCatalogProductRow(row);
        const evidenceUnit = requestedEvidenceUnit(product);
        const requestedUnit: RequestedUnit = evidenceUnit ?? 'piece';
        const request = { amount: 1, unit: requestedUnit, unitExplicit: true };
        const resolution = resolveCatalogUnits(product, request);
        const prompt = createSmartUnitPrompt(product, request, resolution);

        if (evidenceUnit !== null) {
          expect(prompt, `${product.displayName} already has deterministic ${evidenceUnit} evidence`).toBeNull();
          expect(resolution.options.some((option) => option.unit === evidenceUnit && option.baseValue !== null)).toBe(true);
        } else {
          expect(prompt, `${product.displayName} needs a piece-size decision`).not.toBeNull();
          if (prompt?.mode === 'whole-split') {
            expect(prompt.defaultValue).toBe(8);
            expect(prompt.wholeWeightG).toBe(product.unitEvidence.productQuantity?.baseValue ?? null);
            expect(prompt.baseValueG).toBe((prompt.wholeWeightG ?? 0) / 8);
          } else {
            expect(prompt?.baseValueG).toBeNull();
          }
        }

        return {
          code: product.code,
          name: product.displayName,
          requestedUnit,
          evidence: evidenceUnit ?? 'none',
          prompt: prompt?.mode ?? 'not-required',
          defaultValue: prompt?.defaultValue ?? null
        };
      });

      console.table(report);
    } finally {
      database.close();
    }
  });
});
