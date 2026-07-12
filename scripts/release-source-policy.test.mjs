import { describe, expect, it } from 'vitest';
import { isSourceReleasePathAllowed } from './release-source-policy.mjs';

describe('developer source archive policy', () => {
  it('keeps only the documented environment example', () => {
    expect(isSourceReleasePathAllowed('.env.example')).toBe(true);
    for (const secret of [
      '.env', '.env.production', '.env.staging', '.env.development',
      '.env.production.local', 'deploy/.env.secret', '.ENV.PRODUCTION'
    ]) {
      expect(isSourceReleasePathAllowed(secret), secret).toBe(false);
    }
  });

  it('excludes internal ledgers, generated output and nested archives', () => {
    for (const excluded of [
      '.codex/ledger.json', 'docs/.codex/ledger.json', '.CODEX/ledger.json',
      'node_modules/pkg/index.js', 'deploy/runtime/node_modules/pkg/index.js',
      'dist/index.html', 'fixtures/dist/index.html',
      'release-out/build.zip', 'docs/nested.zip', 'cache/file.pyc'
    ]) {
      expect(isSourceReleasePathAllowed(excluded), excluded).toBe(false);
    }
    expect(isSourceReleasePathAllowed('src/App.tsx')).toBe(true);
  });
});
