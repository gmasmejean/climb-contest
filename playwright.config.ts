import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: 'html',
  use: {
    baseURL: process.env['E2E_BASE_URL'] ?? 'http://localhost:8080',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /judge-ascent\.spec\.ts/,
    },
    // ROADMAP.md Lot 5, point 7 : parcours juge en émulation mobile, 360px
    // de large (l'écran le plus étroit visé par CLAUDE.md § « accessibilité »).
    {
      name: 'mobile',
      use: { ...devices['Pixel 5'], viewport: { width: 360, height: 740 } },
      testMatch: /judge-ascent\.spec\.ts/,
    },
  ],
})
