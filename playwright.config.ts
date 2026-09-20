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
      testIgnore: /judge-(ascent|draft)\.spec\.ts/,
    },
    // ROADMAP.md Lot 5, point 7 et Lot 10 : parcours juge en émulation mobile, 360px
    // de large (l'écran le plus étroit visé par CLAUDE.md § « accessibilité »). Lot 11 :
    // la liste des compétitions et la corbeille y passent aussi (règle des 360 px).
    {
      name: 'mobile',
      use: { ...devices['Pixel 5'], viewport: { width: 360, height: 740 } },
      testMatch: /(judge-(ascent|draft)|competition-trash)\.spec\.ts/,
    },
  ],
})
