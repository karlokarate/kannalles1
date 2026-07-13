import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import legacy from '@vitejs/plugin-legacy';
import { VitePWA } from 'vite-plugin-pwa';

const packageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
const appVersion = packageJson.version;

export default defineConfig({
  base: './',
  publicDir: '.generated-public',
  define: {
    __APP_VERSION__: JSON.stringify(appVersion)
  },
  plugins: [
    react(),
    legacy({
      // This explicit baseline is retained for the general UI. The offline
      // product catalog separately reports unsupported OPFS runtimes.
      targets: [
        'Chrome >= 84',
        'ChromeAndroid >= 84',
        'Firefox >= 67',
        'Safari >= 14.1',
        'iOS >= 14.5',
        'Edge >= 84'
      ],
      additionalLegacyPolyfills: [
        'core-js/proposals/global-this',
        'abortcontroller-polyfill/dist/polyfill-patch-fetch'
      ],
      // The SQLite runtime is a module worker with a dynamic ESM import. A
      // legacy-only graph can reference that worker while omitting its chunk.
      // Keep the modern graph as the authoritative OPFS path; the legacy graph
      // remains an explicit unsupported-browser shell.
      renderModernChunks: true
    }),
    VitePWA({
      // Never reload an active calculation/search draft behind the user's
      // back. `src/main.tsx` exposes the explicit update callback to the UI.
      registerType: 'prompt',
      injectRegister: 'auto',
      includeAssets: [
        'icons/icon-192.png',
        'icons/icon-512.png',
        'icons/icon-maskable-512.png',
        'icons/apple-touch-icon.png'
      ],
      manifest: {
        name: 'KH Checker',
        short_name: 'KH Checker',
        description: 'Kohlenhydrate für Produkte und Mengen berechnen.',
        theme_color: '#138a55',
        background_color: '#f6f8f7',
        display: 'standalone',
        orientation: 'any',
        id: './',
        start_url: './',
        scope: './',
        lang: 'de-DE',
        categories: ['health', 'food', 'utilities'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,wasm,css,html,ico,png,svg,webmanifest,json}'],
        // The catalog has its own manifest, checksum, installation and rollback
        // lifecycle. Workbox must never treat it as immutable app-shell data.
        globIgnores: ['catalog/**'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/\/[^/?]+\.[^/?]+$/],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/images\.openfoodfacts\.org\//,
            handler: 'CacheFirst',
            options: {
              cacheName: `kh-v${appVersion}-off-product-images`,
              expiration: {
                maxEntries: 80,
                maxAgeSeconds: 60 * 60 * 24 * 30,
                purgeOnQuotaError: true
              },
              cacheableResponse: { statuses: [0, 200] }
            }
          }
        ]
      }
    })
  ],
  server: {
    port: 5173
  }
});
