import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readContract(name: string) {
  return JSON.parse(readFileSync(new URL(`../contracts/${name}`, import.meta.url), 'utf8')) as Record<string, unknown>;
}

describe('normative core-contract consistency', () => {
  it('keeps direct and gateway lanes explicit and cache identities lane-aware', () => {
    const contract = readContract('search-execution.contract.json') as {
      pipeline: Array<{ step: string; rules: string[] }>;
      networkBudgets: {
        browserGatewayRequestsPerAction: { maximum: number };
        browserDirectRequestsPerAction: { maximum: number };
      };
    };
    const cache = contract.pipeline.find((step) => step.step === 'query_cache')?.rules ?? [];
    const primary = contract.pipeline.find((step) => step.step === 'primary_search')?.rules ?? [];
    expect(cache).toContain('browser_cache_key_includes_runtime_lane_identity');
    expect(cache).toContain('gateway_cache_key_includes_effective_upstream_backend_identity');
    expect(cache).not.toContain('use_backend_independent_canonical_key');
    expect(primary).toContain('empty_gateway_selects_direct_search_a_licious');
    expect(primary).toContain('configured_gateway_is_authoritative_for_the_whole_action');
    expect(contract.networkBudgets.browserGatewayRequestsPerAction.maximum).toBe(1);
    expect(contract.networkBudgets.browserDirectRequestsPerAction.maximum).toBe(2);
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

  it('allows user-approved direct OFF credentials without weakening operator-secret boundaries', () => {
    const contract = readContract('off-account.contract.json') as {
      persistence: Record<string, unknown>;
      directRequestUse: Record<string, unknown>;
      nonNegotiableRedaction: Record<string, unknown>;
    };
    expect(contract.persistence).toMatchObject({
      userProvidedCredentialsAllowed: true,
      cleartextBrowserPersistenceAllowed: true,
      mustNotBeRejectedBySecretOrReleaseGates: true
    });
    expect(contract.directRequestUse).toMatchObject({
      searchALiciousReceivesCredentials: false,
      configuredGatewayReceivesCredentials: false,
      offLegacyAndProductReadsReceiveCredentials: true
    });
    expect(contract.nonNegotiableRedaction).toMatchObject({
      diagnosticsContainPassword: false,
      apiCacheContainsCredentialedRequestUrl: false,
      buildTimeEnvironmentContainsUserCredentials: false
    });
  });
});
