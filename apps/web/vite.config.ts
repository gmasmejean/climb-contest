import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    VitePWA({
      // Lot 6 : une nouvelle version ne s'active jamais pendant qu'une
      // saisie juge est en attente — `'prompt'` laisse `pwa-update.ts`
      // piloter `updateSW()` lui-même, au lieu de basculer seul
      // (`'autoUpdate'`), gated sur une file vide (DECISIONS.md ADR-035).
      registerType: 'prompt',
      includeAssets: ['favicon.svg'],
      manifest: {
        id: '/',
        name: 'ClimbContest',
        short_name: 'ClimbContest',
        description: "Gestion de compétitions d'escalade de difficulté",
        lang: 'fr',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#1d4ed8',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        // Lot 6 (SPEC.md § 6.3) : réponse réseau d'abord avec repli cache
        // pour les données API (utile au premier chargement du bootstrap
        // juge, ou aux écrans organisateur/public en réseau instable) ;
        // cache d'abord pour les ressources statiques. Seuls les `GET`
        // matchent par défaut — les `POST` (dont `/judge/ascents/batch`) ne
        // sont jamais interceptés ici : leurs retries sont gérés uniquement
        // par `packages/sync`, jamais dupliqués au niveau du service worker.
        runtimeCaching: [
          {
            urlPattern: ({ url }: { url: URL }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-get-cache',
              networkTimeoutSeconds: 4,
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 200, maxAgeSeconds: 86_400 },
            },
          },
          {
            urlPattern: ({ request }: { request: Request }) =>
              ['style', 'script', 'font', 'image'].includes(request.destination),
            handler: 'CacheFirst',
            options: {
              cacheName: 'static-assets',
              expiration: { maxEntries: 200, maxAgeSeconds: 2_592_000 },
            },
          },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
})
