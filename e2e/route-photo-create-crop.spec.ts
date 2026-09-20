import path from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { apiJson } from './support/api'

// ADR-067 : la photo se choisit dès la création de la voie, et se recadre
// (rectangle libre, coins à tirer, zoom) avant l'envoi. Vérifié dans un vrai
// navigateur, y compris à 360 px (projet `mobile`) : le recadrage passe par
// `canvas`, que jsdom n'a pas.

const ORGANIZER_EMAIL = 'organisateur@club-demo.test'
const ORGANIZER_PASSWORD = 'ChangeMoi123!'
const WALL_PHOTO = path.join(process.cwd(), 'apps/api/src/test-utils/wall.jpg') // 480 × 720

/** Largeur et hauteur d'un JPEG, lues dans son en-tête SOF (sans dépendance). */
function jpegSize(bytes: Buffer): { width: number; height: number } {
  let offset = 2
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) throw new Error('JPEG invalide')
    const marker = bytes[offset + 1] ?? 0
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)
    if (isStartOfFrame) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) }
    }
    offset += 2 + bytes.readUInt16BE(offset + 2)
  }
  throw new Error('En-tête JPEG introuvable')
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 })
  await page.mouse.move(to.x, to.y, { steps: 4 })
  await page.mouse.up()
}

test('l’organisateur choisit et recadre la photo en créant la voie', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000)
  const shot = (label: string) =>
    page.screenshot({ path: testInfo.outputPath(`${label}.png`), animations: 'disabled' })

  // --- Préparation : une compétition et une catégorie, par l'API ---
  const { accessToken } = await apiJson<{ accessToken: string }>(request, '/api/v1/auth/login', {
    method: 'POST',
    data: { email: ORGANIZER_EMAIL, password: ORGANIZER_PASSWORD },
  })
  const headers = { authorization: `Bearer ${accessToken}` }
  const name = `Coupe recadrage e2e ${Date.now()}`
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

  // --- Formulaire de création de voie ---
  await page.goto('/login')
  await page.getByLabel('E-mail').fill(ORGANIZER_EMAIL)
  await page.getByLabel('Mot de passe').fill(ORGANIZER_PASSWORD)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page).toHaveURL('/')
  await page.getByRole('link', { name: 'Mes compétitions' }).click()
  await page.getByText(name).click()
  await page.getByRole('tab', { name: 'Voies' }).click()

  await page.getByRole('spinbutton', { name: 'Numéro' }).fill('1')
  await page.getByRole('spinbutton', { name: 'Nombre de prises' }).fill('7')
  await page.getByLabel('Photo de la voie (optionnelle)').setInputFiles(WALL_PHOTO)

  // L'aperçu est la photo entière (480 × 720, plafonnée à 640 px de côté : 427 × 640)
  // tant qu'on n'a pas recadré.
  const preview = page.getByTestId('photo-preview')
  await expect(preview).toBeVisible()
  await expect
    .poll(() => preview.evaluate((img) => (img as HTMLImageElement).naturalHeight))
    .toBe(640)

  // --- Recadrage : on garde le centre de la photo (moitié de chaque côté) ---
  await page.getByRole('button', { name: 'Recadrer la photo' }).click()
  const dialog = page.getByTestId('photo-crop-dialog')
  await expect(dialog).toBeVisible()
  await expectNoHorizontalScroll(page)
  // Le pied du dialogue reste atteignable : aucun geste caché, aucun bouton hors écran.
  await expect(dialog.getByRole('button', { name: 'Appliquer le recadrage' })).toBeInViewport()
  // À ×1 la photo tient ENTIÈRE à l'écran : les quatre coins sont visibles, sans défiler.
  for (const corner of ['nw', 'ne', 'sw', 'se']) {
    await expect(dialog.locator(`[data-corner="${corner}"]`)).toBeInViewport({ ratio: 1 })
  }
  await shot('recadrage-ouvert')

  const frame = await dialog.getByTestId('crop-frame').boundingBox()
  if (!frame) throw new Error('cadre de recadrage introuvable')
  const nw = await dialog.locator('[data-corner="nw"]').boundingBox()
  const se = await dialog.locator('[data-corner="se"]').boundingBox()
  if (!nw || !se) throw new Error('coins introuvables')
  const center = (box: { x: number; y: number; width: number; height: number }) => ({
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  })
  await drag(page, center(nw), {
    x: frame.x + frame.width * 0.25,
    y: frame.y + frame.height * 0.25,
  })
  await drag(page, center(se), {
    x: frame.x + frame.width * 0.75,
    y: frame.y + frame.height * 0.75,
  })
  await shot('recadrage-coins-tires')

  // Le zoom ×2 agrandit le cadre, sans perdre la zone choisie.
  await dialog.getByRole('button', { name: '×2' }).click()
  await expect(dialog.getByRole('button', { name: '×2' })).toHaveAttribute('aria-pressed', 'true')
  const zoomed = await dialog.getByTestId('crop-frame').boundingBox()
  expect(zoomed?.width ?? 0).toBeGreaterThan(frame.width * 1.9)
  await dialog.getByRole('button', { name: '×1' }).click()

  await dialog.getByRole('button', { name: 'Appliquer le recadrage' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText("La photo sera recadrée avant l'envoi.")).toBeVisible()
  // L'aperçu montre maintenant la zone recadrée : environ la moitié de 480 × 720.
  await expect
    .poll(() => preview.evaluate((img) => (img as HTMLImageElement).naturalWidth), {
      timeout: 15_000,
    })
    .toBeLessThan(300)
  await expectNoHorizontalScroll(page)
  await shot('formulaire-photo-recadree')

  // --- Création : la voie est créée PUIS la photo recadrée envoyée ---
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click()
  await expect(page.getByText('Voie créée avec sa photo.')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Voie 1')).toBeVisible()
  await expect(page.getByText('photo annotée')).toBeVisible()

  const routes = await apiJson<{ id: string; photoAssetId: string | null }[]>(
    request,
    `${base}/routes`,
    { headers },
  )
  const created = routes[0]
  expect(created?.photoAssetId).not.toBeNull()
  const stored = await request.get(`${base}/routes/${created?.id}/photo`, { headers })
  expect(stored.status()).toBe(200)
  expect(stored.headers()['content-type']).toBe('image/jpeg')
  const { width, height } = jpegSize(await stored.body())
  // Photo d'origine 480 × 720, zone gardée = [25 %, 75 %] sur chaque axe : ~240 × 360
  // (tolérance : la précision du glisser de la souris).
  expect(width).toBeGreaterThan(200)
  expect(width).toBeLessThan(290)
  expect(height).toBeGreaterThan(300)
  expect(height).toBeLessThan(430)
  // Le rapport largeur / hauteur d'origine (2:3) est conservé par une zone centrée.
  expect(width / height).toBeGreaterThan(0.55)
  expect(width / height).toBeLessThan(0.8)

  // --- La même photo se choisit de nouveau pour la voie suivante (mur commun) ---
  await page.getByRole('spinbutton', { name: 'Numéro' }).fill('2')
  await page.getByRole('spinbutton', { name: 'Nombre de prises' }).fill('7')
  await page.getByLabel('Photo de la voie (optionnelle)').setInputFiles(WALL_PHOTO)
  await expect(page.getByTestId('photo-preview')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Recadrer la photo' })).toBeEnabled()
})
