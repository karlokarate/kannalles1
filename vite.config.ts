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
      // This explicit baseline is the intersection of the JS and CSS feature
      // contract (including native flex-gap). Older browsers keep the static
      // compatibility notice instead of receiving a falsely supported layout.
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
      // One compatibility graph avoids a CSP-unsafe data: feature probe and
      // also makes local/file-like wrappers deterministic across WebViews.
      renderModernChunks: false
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
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest,json}'],
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
    port: 5173,
    proxy: {
      '^/api(/|$)': 'http://localhost:8787'
    }
  }
});
