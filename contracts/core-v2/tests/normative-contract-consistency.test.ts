import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readContract(name: string) {
  return JSON.parse(readFileSync(new URL(`../contracts/${name}`, import.meta.url), 'utf8')) as Record<string, unknown>;
}

describe('normative core-contract consistency', () => {
  it('keeps the browser gateway-only and cache identities backend-aware', () => {
    const contract = readContract('search-execution.contract.json') as {
      pipeline: Array<{ step: string; rules: string[] }>;
      networkBudgets: { browserGatewayRequestsPerAction: { maximum: number } };
    };
    const cache = contract.pipeline.find((step) => step.step === 'query_cache')?.rules ?? [];
    const primary = contract.pipeline.find((step) => step.step === 'primary_search')?.rules ?? [];
    expect(cache).toContain('browser_cache_key_includes_configured_gateway_identity');
    expect(cache).toContain('gateway_cache_key_includes_effective_upstream_backend_identity');
    expect(cache).not.toContain('use_backend_independent_canonical_key');
    expect(primary).toContain('browser_never_calls_open_food_facts_or_search_a_licious_directly');
    expect(contract.networkBudgets.browserGatewayRequestsPerAction.maximum).toBe(1);
  });

  it('describes the calibration management UI that actually exists', () => {
    const contract = readContract('calibration-persistence.contract.json') as {
      lifecycle: Record<string, unknown>;
    };
    expect(contract.lifecycle).toMatchObject({
      userInterfaceManagement: 'bulkClear',
      userCanEditIndividualRecordInApp: false,
      userCanDeleteIndividualRecordInApp: false,
      repositorySupportsInternalDelete: true
    });
    expect(contract.lifecycle).not.toHaveProperty('userCanEdit');
    expect(contract.lifecycle).not.toHaveProperty('userCanDelete');
  });
});
