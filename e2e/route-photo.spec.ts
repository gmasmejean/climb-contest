import { readFileSync } from 'node:fs'
import path from 'node:path'

import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

import { apiJson, openContestRound } from './support/api'

// Lot 15 (ADR-066) : l'organisateur téléverse la photo d'une voie et y place les
// prises, imprime la fiche ; le juge la consulte depuis son écran de saisie, y
// compris HORS LIGNE. Tourne sur les deux projets, dont `mobile` (360 px).

const ORGANIZER_EMAIL = 'organisateur@club-demo.test'
const ORGANIZER_PASSWORD = 'ChangeMoi123!'
const WALL_PHOTO = path.join(process.cwd(), 'apps/api/src/test-utils/wall.jpg')

// Les 7 prises rouges de la photo (x / 480, y / 720), de bas en haut.
const HOLDS_BOTTOM_TO_TOP: [number, number][] = [
  [240, 650],
  [210, 560],
  [270, 470],
  [230, 380],
  [300, 290],
  [250, 200],
  [280, 110],
]

async function setUp(request: APIRequestContext) {
  const { accessToken } = await apiJson<{ accessToken: string }>(request, '/api/v1/auth/login', {
    method: 'POST',
    data: { email: ORGANIZER_EMAIL, password: ORGANIZER_PASSWORD },
  })
  const headers = { authorization: `Bearer ${accessToken}` }
  const name = `Coupe photo e2e ${Date.now()}`
  const competition = await apiJson<{ id: string }>(request, '/api/v1/competitions', {
    method: 'POST',
    headers,
    data: {
      name,
      venue: 'Salle e2e',
      startsOn: '2099-01-01',
      endsOn: '2099-01-01',
      format: 'contest',
      scoringEngineId: 'ffme-difficulty-2026',
      scoringConfig: { routesCounted: 1 },
    },
  })
  const base = `/api/v1/competitions/${competition.id}`
  const category = await apiJson<{ id: string }>(request, `${base}/categories`, {
    method: 'POST',
    headers,
    data: { label: 'Cat photo e2e', sex: 'X' },
  })
  await apiJson(request, `${base}/competitors`, {
    method: 'POST',
    headers,
    data: { categoryId: category.id, bib: 47, firstName: 'Léa', lastName: 'Martin' },
  })
  const route = await apiJson<{ id: string }>(request, `${base}/routes`, {
    method: 'POST',
    headers,
    data: { number: 1, holdCount: HOLDS_BOTTOM_TO_TOP.length, categoryIds: [category.id] },
  })
  const judge = await apiJson<{ accessToken: string }>(request, `${base}/judges`, {
    method: 'POST',
    headers,
    data: { displayName: 'Juge photo e2e', routeIds: [route.id] },
  })
  await openContestRound(request, headers, base)
  return { name, base, headers, routeId: route.id, judgeToken: judge.accessToken }
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
}

/** Nombre de photos rangées dans IndexedDB (Dexie `climbcontest-judge`, table `routePhotos`). */
function storedPhotoCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const open = indexedDB.open('climbcontest-judge')
        open.onerror = () => resolve(0)
        open.onsuccess = () => {
          const db = open.result
          if (!db.objectStoreNames.contains('routePhotos')) {
            db.close()
            resolve(0)
            return
          }
          const count = db.transaction('routePhotos').objectStore('routePhotos').count()
          count.onsuccess = () => {
            db.close()
            resolve(count.result)
          }
          count.onerror = () => {
            db.close()
            resolve(0)
          }
        }
      }),
  )
}

test('l’organisateur annote la photo d’une voie, imprime la fiche ; le juge la voit hors ligne', async ({
  page,
  browser,
  request,
}, testInfo) => {
  test.setTimeout(180_000)
  const { name, base, headers, routeId, judgeToken } = await setUp(request)
  const shot = (target: Page, label: string) =>
    target.screenshot({ path: testInfo.outputPath(`${label}.png`), animations: 'disabled' })

  // --- Organisateur : ouvre la voie en modification ---
  await page.goto('/login')
  await page.getByLabel('E-mail').fill(ORGANIZER_EMAIL)
  await page.getByLabel('Mot de passe').fill(ORGANIZER_PASSWORD)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page).toHaveURL('/competitions')
  await page.getByText(name).click()
  await page.getByRole('tab', { name: 'Voies' }).click()
  await page.getByRole('button', { name: 'Modifier' }).first().click()

  const editor = page.getByTestId('route-photo-editor')
  await expect(editor).toContainText('Aucune photo')

  // --- Un fichier qui n'est pas une image lisible est refusé, en français ---
  await editor.getByLabel('Choisir une photo').setInputFiles({
    name: 'faux.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from('%PDF-1.7 ceci n’est pas une image'),
  })
  // Refusé dès le choix (l'aperçu passe par le même ré-encodage que l'envoi).
  await expect(editor.getByRole('alert')).toContainText('pas une photo que le navigateur sait lire')
  await expect(editor.getByRole('button', { name: 'Envoyer la photo' })).toBeDisabled()

  // --- Une vraie photo : ré-encodée dans le navigateur, puis enregistrée ---
  await editor.getByLabel('Choisir une photo').setInputFiles(WALL_PHOTO)
  await editor.getByRole('button', { name: 'Envoyer la photo' }).click()
  await expect(page.getByText('Photo enregistrée.')).toBeVisible({ timeout: 30_000 })
  const frame = editor.getByTestId('photo-frame')
  await expect(frame.locator('img')).toBeVisible()
  // Le serveur a reçu un JPEG réduit (côté long <= 1600 px, ici la photo est déjà petite).
  const stored = await request.get(`${base}/routes/${routeId}/photo`, { headers })
  expect(stored.status()).toBe(200)
  expect(stored.headers()['content-type']).toBe('image/jpeg')
  expect((await stored.body()).subarray(0, 3).toString('hex')).toBe('ffd8ff')

  // --- Placer les 7 prises, du HAUT vers le bas : la numérotation sera à refaire ---
  await frame.scrollIntoViewIfNeeded()
  const box = await frame.boundingBox()
  if (!box) throw new Error('cadre de la photo introuvable')
  for (const [x, y] of [...HOLDS_BOTTOM_TO_TOP].reverse()) {
    await frame.click({ position: { x: (x / 480) * box.width, y: (y / 720) * box.height } })
  }
  await expect(editor.getByTestId('hold-counter')).toContainText('7 prises placées sur 7')
  // La 8ᵉ prise est refusée avec la marche à suivre.
  await frame.click({ position: { x: 20, y: 20 } })
  await expect(editor.getByRole('alert')).toContainText('Les 7 prises de la voie sont déjà placées')

  await editor.getByRole('button', { name: 'Renuméroter de bas en haut' }).click()
  // La prise la plus basse (y = 650 / 720) porte maintenant le numéro 1.
  const bottomMarker = frame.locator('[data-testid="hold-marker"][data-number="1"]')
  const bottomTop = await bottomMarker.evaluate((el) => (el as HTMLElement).style.top)
  expect(Number.parseFloat(bottomTop)).toBeGreaterThan(85)
  await expectNoHorizontalScroll(page)
  await shot(page, 'organisateur-prises-placees')

  await editor.getByRole('button', { name: 'Enregistrer les prises' }).click()
  await expect(page.getByText('Prises enregistrées.')).toBeVisible()

  const routes = await apiJson<{ id: string; photoHolds: { number: number; y: number }[] }[]>(
    request,
    `${base}/routes`,
    { headers },
  )
  const saved = routes.find((r) => r.id === routeId)?.photoHolds ?? []
  expect(saved).toHaveLength(7)
  expect(saved.find((hold) => hold.number === 1)?.y).toBeGreaterThan(0.85)

  // --- Fiche voie en PDF ---
  const download = page.waitForEvent('download')
  await editor.getByRole('button', { name: 'Imprimer la fiche de cette voie' }).click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/^fiches-voies-.+\.pdf$/)
  const pdf = readFileSync((await file.path()) ?? '')
  expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-')

  // --- Juge : télécharge la voie EN LIGNE, puis passe hors ligne ---
  const judgeContext = await browser.newContext({
    ...testInfo.project.use,
    baseURL: testInfo.project.use.baseURL ?? process.env['E2E_BASE_URL'] ?? 'http://localhost:8080',
  })
  const judgePage = await judgeContext.newPage()
  await judgePage.goto(`/j/${judgeToken}`)
  await judgePage.getByRole('button', { name: 'Commencer' }).click()
  await expect(judgePage).toHaveURL('/j/home')
  await judgePage.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  // La photo se télécharge en arrière-plan après l'amorçage : on attend qu'elle soit rangée.
  await expect.poll(() => storedPhotoCount(judgePage), { timeout: 30_000 }).toBe(1)

  await judgeContext.setOffline(true)

  await judgePage.getByText('Voie 1').click()
  await expect(judgePage).toHaveURL(/\/j\/routes\//)
  await judgePage.getByText('Léa Martin').click()
  await expect(judgePage.getByRole('button', { name: 'Voir la voie' })).toBeVisible()
  await judgePage.getByRole('button', { name: 'Voir la voie' }).click()

  const panel = judgePage.getByTestId('route-photo-panel')
  await expect(panel).toBeVisible()
  await expect(panel.locator('img')).toBeVisible()
  // L'image est réellement décodée (pas une image cassée), sans aucun réseau.
  await expect
    .poll(() => panel.locator('img').evaluate((img) => (img as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0)
  await expect(panel.getByTestId('hold-marker')).toHaveCount(7)
  await expectNoHorizontalScroll(judgePage)
  await shot(judgePage, 'juge-voie-hors-ligne')

  await panel.getByRole('button', { name: '×2' }).click()
  await expect(panel.getByRole('button', { name: '×2' })).toHaveAttribute('aria-pressed', 'true')
  await shot(judgePage, 'juge-voie-zoom-x2')

  // La saisie reste possible et rien n'est perdu en refermant la voie.
  await panel.getByRole('button', { name: 'Masquer la voie' }).click()
  await expect(panel).toBeHidden()
  await judgePage.getByRole('button', { name: '5', exact: true }).click()
  await judgePage.getByRole('button', { name: 'Voir le récapitulatif' }).click()
  await expect(judgePage.getByText(/prise 5/)).toBeVisible()

  // Rechargée hors ligne, la voie est toujours là (photo lue dans IndexedDB).
  await judgePage.reload()
  await judgePage.getByRole('button', { name: 'Voir la voie' }).click()
  await expect(judgePage.getByTestId('route-photo-panel').locator('img')).toBeVisible()

  await judgeContext.close()
})
