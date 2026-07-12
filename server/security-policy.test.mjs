import { readFile } from 'node:fs/promises';
import { cspHashes } from '@vitejs/plugin-legacy';
import { describe, expect, it } from 'vitest';
import { LEGACY_SCRIPT_CSP_HASHES, contentSecurityPolicy } from './security-policy.mjs';

describe('legacy bootstrap content security policy', () => {
  it('pins every inline script hash exported by the installed legacy plugin', async () => {
    expect(new Set(LEGACY_SCRIPT_CSP_HASHES)).toEqual(
      new Set(cspHashes.map((hash) => `sha256-${hash}`))
    );
    const policy = contentSecurityPolicy({ production: true });
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    for (const hash of LEGACY_SCRIPT_CSP_HASHES) {
      expect(policy).toContain(`'${hash}'`);
      expect(html).toContain(`'${hash}'`);
    }
    expect(policy).not.toContain("'unsafe-inline'");
  });
});
