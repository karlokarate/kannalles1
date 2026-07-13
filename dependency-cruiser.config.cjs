/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular-runtime-dependencies',
      severity: 'error',
      comment: 'Hard cutover modules must remain acyclic.',
      from: { path: '^src/' },
      to: { circular: true },
    },
    {
      name: 'no-online-product-authority-from-browser-runtime',
      severity: 'error',
      comment: 'The production browser path is SQLite-only; API, gateway and remote AI trees are retired.',
      from: { path: '^src/' },
      to: {
        path: '^(?:api/|server/|deploy/search-index/|src/lib/(?:api|apiGovernor|gatewayUrl|aiClient)(?:\\.|/))',
      },
    },
    {
      name: 'catalog-runtime-does-not-depend-on-ui-or-online-code',
      severity: 'error',
      comment: 'Catalog installation and querying are below the UI and online legacy tree.',
      from: { path: '^src/lib/catalog/' },
      to: {
        path: '^(?:src/(?:App\\.tsx|app/)|src/lib/(?:api|apiGovernor|gatewayUrl|aiClient|storage)(?:\\.|/))',
      },
    },
    {
      name: 'resolution-remains-pure',
      severity: 'error',
      comment: 'Unit and calibration semantics must not depend on React, transport or persistence owners.',
      from: { path: '^src/lib/(?:resolution/|calibration\\.ts|identity\\.ts)' },
      to: {
        path: '^(?:src/(?:App\\.tsx|app/)|src/lib/catalog/(?:catalogClient|catalog\\.worker)|src/lib/(?:api|storage|userDataStore)(?:\\.|/)|react(?:-dom)?$)',
      },
    },
    {
      name: 'ui-does-not-bypass-catalog-client',
      severity: 'error',
      comment: 'UI may consume the domain and client boundary, never worker, installer or generated SQLite internals.',
      from: { path: '^src/(?:App\\.tsx|app/)' },
      to: {
        path: '^(?:Catalog/|src/lib/catalog/(?:catalog\\.worker|catalogInstaller|catalogManifest|catalogProjection|catalogSlots)(?:\\.|$))',
      },
    },
    {
      name: 'no-legacy-resolver-imports',
      severity: 'error',
      comment: 'Validated algorithms move to src/lib/resolution; the mixed legacy resolver is not an authority.',
      from: { path: '^src/' },
      to: { path: '^src/lib/resolver(?:\\.ts)?$' },
    },
    {
      name: 'no-node-core-in-browser-runtime',
      severity: 'error',
      comment: 'Browser and PWA modules must stay portable across supported platforms.',
      from: { path: '^src/' },
      to: { path: '^(?:node:)?(?:assert|buffer|child_process|cluster|crypto|dgram|dns|fs|http|https|net|os|path|perf_hooks|process|readline|stream|string_decoder|tls|tty|url|util|v8|vm|worker_threads|zlib)$' },
    },
  ],
  options: {
    doNotFollow: {
      path: 'node_modules',
      dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer', 'npm-bundled', 'npm-no-pkg'],
    },
    tsConfig: { fileName: 'tsconfig.app.json' },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    reporterOptions: {
      dot: { collapsePattern: 'node_modules/[^/]+' },
    },
  },
};
