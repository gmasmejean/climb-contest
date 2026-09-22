import path from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { apiJson } from './support/api'

// ADR-067 / ADR-068 : la photo se choisit dès la création de la voie, on décide de
// la recadrer ou non (rectangle libre, coins à tirer, zoom), puis on y place les
// prises : leur nombre remplace le champ « Nombre de prises ». Vérifié dans un vrai
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

test('l’organisateur choisit, recadre puis annote la photo en créant la voie', async ({
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
  // Nombre saisi À LA MAIN : l'annotation le remplacera plus bas.
  await page.getByRole('spinbutton', { name: 'Nombre de prises' }).fill('12')
  await page.getByLabel('Photo de la voie (optionnelle)').setInputFiles(WALL_PHOTO)

  // Étape 2 : on demande de recadrer ou non ; on n'annote pas encore.
  const cropStep = page.getByTestId('crop-step')
  await expect(cropStep).toContainText('Souhaitez-vous recadrer la photo ?')
  await expect(page.getByTestId('hold-annotator')).toHaveCount(0)
  // L'aperçu est la photo entière. Depuis ADR-077 le plafond est à 1280 px de
  // côté (640 auparavant) : cette photo de 480 × 720 n'est plus réduite du tout,
  // ce qui est justement le but — on y place les prises, avec un zoom ×3.
  const preview = page.getByTestId('photo-preview')
  await expect(preview).toBeVisible()
  await expect
    .poll(() => preview.evaluate((img) => (img as HTMLImageElement).naturalHeight))
    .toBe(720)
  await expect
    .poll(() => preview.evaluate((img) => (img as HTMLImageElement).naturalWidth))
    .toBe(480)

  // --- Recadrage : on garde le centre de la photo (moitié de chaque côté) ---
  await cropStep.getByRole('button', { name: 'Recadrer la photo' }).click()
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

  // Étape 3 : l'annotation apparaît, sur la photo RECADRÉE (~ la moitié de 480 × 720).
  const annotator = page.getByTestId('hold-annotator')
  await expect(annotator).toBeVisible()
  await expect(page.getByText('La photo est recadrée.')).toBeVisible()
  const photoFrame = annotator.getByTestId('photo-frame')
  await expect
    .poll(
      () => photoFrame.locator('img').evaluate((img) => (img as HTMLImageElement).naturalWidth),
      {
        timeout: 15_000,
      },
    )
    .toBeLessThan(300)

  // --- Placer 3 prises, du HAUT vers le bas : la numérotation sera à refaire ---
  await photoFrame.scrollIntoViewIfNeeded()
  const box = await photoFrame.boundingBox()
  if (!box) throw new Error('cadre de la photo introuvable')
  for (const [x, y] of [
    [0.6, 0.2],
    [0.4, 0.5],
    [0.5, 0.82],
  ] as const) {
    await photoFrame.click({ position: { x: x * box.width, y: y * box.height } })
  }
  await expect(annotator.getByTestId('hold-counter')).toHaveText('3 prises placées')

  // L'annotation PREND LE PAS sur le nombre saisi (12) : le champ n'existe plus.
  const fromPhoto = page.getByTestId('hold-count-from-photo')
  await expect(fromPhoto).toContainText('3')
  await expect(fromPhoto).toContainText('Remplace les 12 saisies')
  await expect(page.getByRole('spinbutton', { name: 'Nombre de prises' })).toHaveCount(0)

  await annotator.getByRole('button', { name: 'Renuméroter de bas en haut' }).click()
  await expectNoHorizontalScroll(page)
  await shot('annotation-a-la-creation')

  // --- Création : voie, PUIS photo recadrée, PUIS prises ---
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click()
  await expect(page.getByText('Voie créée avec sa photo et ses 3 prises.')).toBeVisible({
    timeout: 30_000,
  })
  const listed = page.getByTestId('data-list-row')
  await expect(listed).toHaveCount(1)
  await expect(listed).toContainText(/photo annotée|Photo/)

  const routes = await apiJson<
    {
      id: string
      holdCount: number
      photoAssetId: string | null
      photoHolds: { number: number; y: number }[]
    }[]
  >(request, `${base}/routes`, { headers })
  const created = routes[0]
  expect(created?.photoAssetId).not.toBeNull()
  // 3 prises annotées : la voie en compte 3, pas les 12 saisis.
  expect(created?.holdCount).toBe(3)
  expect(created?.photoHolds).toHaveLength(3)
  // Renumérotée de bas en haut : le numéro 1 est la prise la plus basse (y = 0.82).
  expect(created?.photoHolds.find((hold) => hold.number === 1)?.y).toBeGreaterThan(0.7)

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
  expect(width / height).toBeGreaterThan(0.55)
  expect(width / height).toBeLessThan(0.8)

  // --- Voie suivante : même photo (mur commun), sans recadrer ; revenir au recadrage
  //     avec des prises placées demande confirmation, et les efface ---
  await page.getByRole('spinbutton', { name: 'Numéro' }).fill('2')
  await page.getByRole('spinbutton', { name: 'Nombre de prises' }).fill('7')
  await page.getByLabel('Photo de la voie (optionnelle)').setInputFiles(WALL_PHOTO)
  await page.getByRole('button', { name: 'Continuer sans recadrer' }).click()
  const secondFrame = page.getByTestId('hold-annotator').getByTestId('photo-frame')
  await secondFrame.scrollIntoViewIfNeeded()
  await secondFrame.click({ position: { x: 100, y: 200 } })
  await expect(page.getByTestId('hold-counter')).toHaveText('1 prise placée')

  await page.getByRole('button', { name: 'Modifier le recadrage' }).click()
  const confirm = page.getByRole('dialog')
  await expect(confirm).toContainText('La prise placée sera effacée')
  await confirm.getByRole('button', { name: 'Garder les prises' }).click()
  await expect(page.getByTestId('hold-counter')).toHaveText('1 prise placée')

  await page.getByRole('button', { name: 'Modifier le recadrage' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Modifier le recadrage' }).click()
  await expect(page.getByTestId('crop-step')).toBeVisible()
  await expect(page.getByTestId('hold-annotator')).toHaveCount(0)
  // Plus de prise : le champ « Nombre de prises » est revenu, avec la valeur saisie.
  await expect(page.getByRole('spinbutton', { name: 'Nombre de prises' })).toHaveValue('7')
})
