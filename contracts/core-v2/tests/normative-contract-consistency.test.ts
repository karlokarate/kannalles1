import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readJson(relativePath: string) {
  return JSON.parse(readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')) as Record<string, unknown>;
}

describe('normative hard-cutover contract consistency', () => {
  it('uses catalog and clinic as the only source modes without compatibility aliases', () => {
    const contract = readJson('contracts/search-execution.contract.json') as {
      authority: Record<string, unknown>;
      input: { sourceMode: string[] };
      networkBudgets: Record<string, { maximum: number }>;
    };
    expect(contract.input.sourceMode).toEqual(['catalog', 'clinic']);
    expect(contract.authority).toMatchObject({
      activeReadAuthority: 'exactly_one_verified_catalog_slot',
      compatibilityAlias: null,
      networkProductFallback: false
    });
    expect(contract.networkBudgets.productSearchRequestsPerAction.maximum).toBe(0);
    expect(contract.networkBudgets.selectedProductDetailRequests.maximum).toBe(0);
    expect(contract.networkBudgets.remoteAiRequestsPerAction.maximum).toBe(0);
  });

  it('forbids legacy credentials and runtime compatibility adapters', () => {
    const contract = readJson('contracts/off-account.contract.json') as {
      runtimePolicy: Record<string, unknown>;
      legacyCredentialDisposition: Record<string, unknown>;
    };
    expect(contract.runtimePolicy).toMatchObject({
      offAccountSettingExists: false,
      productSearchUsesCredentials: false,
      productLookupUsesCredentials: false,
      gatewayEnabled: false,
      remoteAiEnabled: false
    });
    expect(contract.legacyCredentialDisposition).toMatchObject({
      importAllowed: false,
      readAllowed: false,
      validationAllowed: false,
      transmissionAllowed: false,
      runtimeCompatibilityAdapterAllowed: false
    });
  });

  it('keeps the critical search contract catalog-only and retryable', () => {
    const contract = readJson('contracts/critical-fields.contract.json') as {
      authority: Record<string, unknown>;
      fields: { search: { MUST: string[]; MUST_NOT: string[] } };
    };
    expect(contract.authority).toMatchObject({
      productData: 'verified_production_v1_sqlite_catalog',
      networkProductFallback: false,
      dualAuthority: false
    });
    expect(contract.fields.search.MUST).toContain('issue_zero_product_search_or_product_detail_network_requests');
    expect(contract.fields.search.MUST).toContain('allow_immediate_manual_retry');
    expect(contract.fields.search.MUST_NOT).toContain('fallback_to_search_a_licious_off_legacy_off_v2_or_off_v3');
  });

  it('removes the obsolete direct-account release gate', () => {
    const gates = readJson('release/production-gates.json') as { gates: Array<{ id: string }> };
    const ids = gates.gates.map((gate) => gate.id);
    expect(ids).toContain('single-product-authority');
    expect(ids).toContain('zero-product-network');
    expect(ids).toContain('real-browser-proof');
    expect(ids).not.toContain('direct-off-account');
  });
});
