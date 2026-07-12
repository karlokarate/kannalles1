// @vitejs/plugin-legacy injects four tiny inline bootstrap scripts. Their
// exact hashes are pinned and regression-tested against the installed plugin.
export const LEGACY_SCRIPT_CSP_HASHES = [
  'sha256-MS6/3FCg4WjP9gwgaBGwLpRCY6fZBgwmhVCdrPrNf3E=',
  'sha256-tQjf8gvb2ROOMapIxFvFAYBeUJ0v1HCbOcSmDNXGtDo=',
  'sha256-w36slEqa9euNKxfvkw+LLGsDIr++3rsZXpZxtmRh8Aw=',
  'sha256-+5XkZFazzJo8n0iOP4ti/cLCMUudTf//Mzkb7xNPXIc='
];

export function contentSecurityPolicy({ production = false } = {}) {
  const scriptSources = ["'self'", ...LEGACY_SCRIPT_CSP_HASHES.map((hash) => `'${hash}'`)].join(' ');
  return `default-src 'self'; script-src ${scriptSources}; style-src 'self'; img-src 'self' data: https://images.openfoodfacts.org; connect-src 'self' https:${production ? '' : ' http: ws:'}; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'`;
}
