import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readContract(name: string) {
  return JSON.parse(readFileSync(new URL(`../contracts/${name}`, import.meta.url), 'utf8')) as Record<string, unknown>;
}

describe('normative core-contract consistency', () => {
  it('makes the verified SQLite catalog authoritative and product-network budgets zero', () => {
    const contract = readContract('search-execution.contract.json') as {
      pipeline: Array<{ step: string; rules: string[] }>;
      networkBudgets: {
        searchRequestsPerAction: { maximum: number; scope: string };
        selectedProductDetailRequests: { maximum: number };
        remoteAiRequestsPerAction: { maximum: number };
      };
    };
    const readiness = contract.pipeline.find((step) => step.step === 'catalog_readiness')?.rules ?? [];
    const search = contract.pipeline.find((step) => step.step === 'offline_search')?.rules ?? [];
    const product = contract.pipeline.find((step) => step.step === 'offline_product_resolution')?.rules ?? [];
    expect(readiness).toContain('verify_size_sha256_application_id_user_version_schema_and_product_count_before_activation');
    expect(readiness).toContain('never_activate_partial_or_unverified_catalog');
    expect(search).toContain('issue_zero_product_network_requests');
    expect(search).toContain('sort_exact_name_then_prefix_then_contains_then_popularity_then_name_then_product_id');
    expect(product).toContain('never_fan_out_product_detail_requests');
    expect(contract.networkBudgets.searchRequestsPerAction).toEqual({
      maximum: 0,
      scope: 'product_network',
      hardLocalLock: false
    });
    expect(contract.networkBudgets.selectedProductDetailRequests.maximum).toBe(0);
    expect(contract.networkBudgets.remoteAiRequestsPerAction.maximum).toBe(0);
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

  it('retires personal OFF credentials from every productive data path', () => {
    const contract = readContract('off-account.contract.json') as {
      runtimePolicy: Record<string, unknown>;
      migration: Record<string, unknown>;
      catalogUpdateTransport: Record<string, unknown>;
      nonNegotiableRedaction: Record<string, unknown>;
    };
    expect(contract.runtimePolicy).toMatchObject({
      productSearchUsesCredentials: false,
      productLookupUsesCredentials: false,
      searchALiciousEnabled: false,
      offLegacyEnabled: false,
      offProductApiEnabled: false,
      gatewayEnabled: false,
      remoteAiEnabled: false
    });
    expect(contract.migration).toMatchObject({
      legacyCredentialsMustNeverBeReadForProductOperations: true,
      legacyCredentialsMustNeverBeTransmitted: true,
      authenticationFunctionFailsClosed: true
    });
    expect(contract.catalogUpdateTransport).toMatchObject({
      sameOriginOnly: true,
      offAccountCredentialsUsed: false,
      productQueryTermsTransmitted: false,
      barcodesTransmitted: false
    });
    expect(contract.nonNegotiableRedaction).toMatchObject({
      diagnosticsContainPassword: false,
      catalogMetadataContainsCredentials: false,
      buildTimeEnvironmentContainsUserCredentials: false
    });
  });
});
