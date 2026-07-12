const EXCLUDED_ROOTS = new Set([
  '.git', '.codex', 'node_modules', 'dist', '.generated-public', 'release-out', 'releases',
  'fallback-site', 'candidate-site', 'publish-site', 'ci-reports',
  'playwright-report', 'test-results', '__pycache__'
]);

export function isSourceReleasePathAllowed(relativePath) {
  const normalized = String(relativePath || '').replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
  if (!normalized) return true;
  const parts = normalized.split('/');
  if (parts.some((part) => EXCLUDED_ROOTS.has(part.toLowerCase()))) return false;
  const name = (parts.at(-1) || '').toLowerCase();
  if (name === '.env.example') return true;
  if (name === '.env' || name.startsWith('.env.')) return false;
  if (name.endsWith('.pyc') || name.endsWith('.tsbuildinfo') || name.endsWith('.zip')) return false;
  return true;
}
