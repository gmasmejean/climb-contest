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
        name: 'Climb Contest',
        short_name: 'Climb Contest',
        description: "Gestion de compétitions d'escalade de difficulté",
        lang: 'fr',
        start_url: '/',
        display: 'standalone',
        background_color: '#f9f7f1',
        theme_color: '#0e3b4e',
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
        // `.webp` et `.woff2` sont volontairement ABSENTS : ce sont les
        // visuels et polices de la page d'accueil publique (ADR-070),
        // quelques centaines de Ko qui n'ont rien à faire dans le précache
        // installé sur le téléphone d'un juge. Ils passent par le cache à la
        // demande (`runtimeCaching` ci-dessous, destinations `image`/`font`).
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        // Leaflet (ADR-088) : seulement sur les écrans qui montrent une carte,
        // jamais sur ceux du juge. Mis en cache à la première carte affichée
        // (`static-assets` ci-dessous), pas précaché sur chaque téléphone.
        globIgnores: ['**/leaflet-map-*'],
        // Lot 6 (SPEC.md § 6.3) : réponse réseau d'abord avec repli cache
        // pour les données API (utile au premier chargement du bootstrap
        // juge, ou aux écrans organisateur/public en réseau instable) ;
        // cache d'abord pour les ressources statiques. Seuls les `GET`
        // matchent par défaut — les `POST` (dont `/judge/ascents/batch`) ne
        // sont jamais interceptés ici : leurs retries sont gérés uniquement
        // par `packages/sync`, jamais dupliqués au niveau du service worker.
        runtimeCaching: [
          {
            // Pas les vidéos téléversées (Lot 9) : plusieurs dizaines de Mo, lues par
            // plages d'octets — jamais à mettre dans le Cache Storage.
            urlPattern: ({ url }: { url: URL }) =>
              url.pathname.startsWith('/api/') && !url.pathname.endsWith('/video'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-get-cache',
              networkTimeoutSeconds: 4,
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 200, maxAgeSeconds: 86_400 },
            },
          },
          {
            // Même domaine seulement (ADR-088) : les tuiles de carte de l'IGN
            // sont des images d'un autre domaine, qu'on ne garde pas en cache.
            urlPattern: ({ request, sameOrigin }: { request: Request; sameOrigin: boolean }) =>
              sameOrigin && ['style', 'script', 'font', 'image'].includes(request.destination),
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
