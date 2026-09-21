import { expect, test } from '@playwright/test'

import { FINE_TARGET, TOUCH_TARGET, noHorizontalScroll, tooSmall } from './support/a11y'
import { apiJson, loginApi, registerAndVerifyOrganizer } from './support/api'

/**
 * Lot 19 (ADR-075, ADR-077) : au-dessus de 1440 px, les voies et les juges
 * s'éditent à côté de leur liste, la voie ou le juge ouvert vit dans l'adresse,
 * et les prises se placent en plein écran avec un zoom. Parcours de bureau
 * seulement — le projet `mobile` (360 px) vérifie ailleurs que rien n'a bougé
 * en cartes. Le seuil de 1440 px est MESURÉ : les largeurs fixes du tableau des
 * voies totalisent 656 px, et en dessous il passerait sous le panneau.
 */
test.skip(({ isMobile }) => isMobile === true, 'Le maître–détail n’existe qu’au-dessus de 1440 px.')

test('voies et juges : liste à gauche, détail à droite, sélection dans l’adresse', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000)
  const { email, password } = await registerAndVerifyOrganizer(request, 'maitre-detail')
  const { headers } = await loginApi(request, email, password)

  const competition = await apiJson<{ id: string }>(request, '/api/v1/competitions', {
    method: 'POST',
    headers,
    data: {
      name: `Maitre detail ${Date.now()}`,
      venue: 'Salle e2e',
      startsOn: '2099-05-01',
      endsOn: '2099-05-01',
      format: 'contest',
      scoringEngineId: 'ffme-difficulty-2026',
      scoringConfig: { routesCounted: 1 },
    },
  })
  const base = `/api/v1/competitions/${competition.id}`
  const category = await apiJson<{ id: string }>(request, `${base}/categories`, {
    method: 'POST',
    headers,
    data: { label: 'Cat detail', sex: 'X' },
  })
  const routes: { id: string }[] = []
  for (const number of [1, 2, 3]) {
    routes.push(
      await apiJson<{ id: string }>(request, `${base}/routes`, {
        method: 'POST',
        headers,
        data: {
          number,
          name: `Voie ${number}`,
          holdCount: 20,
          sector: 'Gauche',
          categoryIds: [category.id],
        },
      }),
    )
  }
  await apiJson(request, `${base}/judges`, {
    method: 'POST',
    headers,
    data: { displayName: 'Bruno Costa', routeIds: [routes[0]!.id] },
  })

  await page.goto('/login')
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Mot de passe').fill(password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page).toHaveURL('/')

  // --- Voies : l'éditeur se pose à DROITE de la liste ---
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/competitions/${competition.id}/routes`)
  const rows = page.getByTestId('data-list-row')
  await expect(rows).toHaveCount(3)

  await page.getByRole('button', { name: 'Modifier' }).nth(1).click()
  await expect(page.getByRole('heading', { name: 'Modifier la voie' })).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`route=${routes[1]!.id}`))

  const table = await page.getByRole('table').boundingBox()
  const editor = await page
    .getByRole('heading', { name: 'Modifier la voie' })
    .locator('xpath=ancestor::form')
    .boundingBox()
  expect(editor).not.toBeNull()
  expect(table).not.toBeNull()
  // Côte à côte, pas empilés.
  expect(editor!.x).toBeGreaterThan(table!.x + table!.width - 1)
  expect(await noHorizontalScroll(page)).toBe(true)
  expect(await tooSmall(page, FINE_TARGET, 'table')).toEqual([])
  await page.screenshot({ path: testInfo.outputPath('1-voies.png'), fullPage: true })

  // --- Un rechargement rouvre la même voie ---
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Modifier la voie' })).toBeVisible()
  await expect(page.getByLabel('Numéro')).toHaveValue('2')

  // --- Un identifiant mort est ignoré, et retiré de l'adresse ---
  await page.goto(
    `/competitions/${competition.id}/routes?route=00000000-0000-4000-8000-000000000000`,
  )
  await expect(page.getByRole('heading', { name: 'Ajouter une voie' })).toBeVisible()
  await expect(page).not.toHaveURL(/route=/)

  // --- Juges : la ligne n'ouvre que la fiche, les actions y vivent ---
  await page.goto(`/competitions/${competition.id}/judges`)
  await expect(page.getByRole('table')).toContainText('Bruno Costa')
  // Les actions ont quitté la ligne (ADR-075 point 6).
  await expect(page.getByRole('table').getByRole('button', { name: 'Révoquer' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Fiche' }).click()
  const card = page.getByTestId('judge-card')
  await expect(card).toBeVisible()
  await expect(card).toContainText('Voie 1')
  await expect(page).toHaveURL(/judge=/)
  // La compétition conserve les accès en clair (ADR-027) : le lien et son QR
  // sont dessinés dans le navigateur (ADR-076).
  await expect(card.getByRole('textbox', { name: 'Lien d’accès du juge' })).toHaveValue(/\/j\//)
  await expect(card.getByTestId('judge-qr-code')).toBeVisible()
  await expect(card.getByTestId('judge-qr-code').locator('svg')).toHaveCount(1)
  await page.screenshot({ path: testInfo.outputPath('2-juges.png'), fullPage: true })

  await card.getByRole('button', { name: 'Révoquer' }).click()
  await expect(page.getByRole('table')).toContainText('Révoqué')
  expect(await noHorizontalScroll(page)).toBe(true)

  // --- Juste sous le seuil du maître–détail : le tableau du Lot 18 revient,
  //     actions sur la ligne, sans fiche ---
  await page.setViewportSize({ width: 1439, height: 900 })
  await expect(page.getByTestId('judge-card')).toHaveCount(0)
  await expect(page.getByRole('table')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Fiche' })).toHaveCount(0)
  expect(await noHorizontalScroll(page)).toBe(true)

  // --- Sous 1024 px : cartes, et 48 px partout ---
  await page.setViewportSize({ width: 1023, height: 800 })
  await expect(page.getByRole('table')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Ajouter un juge' })).toBeVisible()
  expect(await tooSmall(page)).toEqual([])
  expect(await noHorizontalScroll(page)).toBe(true)
})

test('annotateur : la photo se place en plein écran, avec un zoom', async ({ page, request }) => {
  test.setTimeout(120_000)
  const { email, password } = await registerAndVerifyOrganizer(request, 'annotateur')
  const { headers } = await loginApi(request, email, password)

  const competition = await apiJson<{ id: string }>(request, '/api/v1/competitions', {
    method: 'POST',
    headers,
    data: {
      name: `Annotateur ${Date.now()}`,
      venue: 'Salle e2e',
      startsOn: '2099-05-01',
      endsOn: '2099-05-01',
      format: 'contest',
      scoringEngineId: 'ffme-difficulty-2026',
      scoringConfig: { routesCounted: 1 },
    },
  })

  await page.goto('/login')
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Mot de passe').fill(password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page).toHaveURL('/')

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/competitions/${competition.id}/routes`)
  await page.getByLabel('Numéro').fill('1')
  await page.getByLabel('Nombre de prises').fill('12')

  // Une photo minuscule mais réelle : le navigateur doit savoir la décoder.
  await page.setInputFiles('input[type="file"]', {
    name: 'mur.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFUlEQVR4nGP8z8DAwMDAwMAEIhgYGABDbQEEnVvnGgAAAABJRU5ErkJggg==',
      'base64',
    ),
  })
  await page.getByRole('button', { name: 'Continuer sans recadrer' }).click()
  await expect(page.getByTestId('hold-annotator')).toBeVisible()

  await page.getByRole('button', { name: 'Agrandir la photo' }).click()
  const dialog = page.getByTestId('hold-annotator-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveAttribute('aria-modal', 'true')

  const frame = dialog.getByTestId('photo-frame')
  const atOne = (await frame.boundingBox())?.width ?? 0
  await dialog.getByRole('button', { name: '×2' }).click()
  const atTwo = (await frame.boundingBox())?.width ?? 0
  expect(atTwo).toBeGreaterThan(atOne)

  // Une prise posée en grand est la même que celle de l'annotateur en ligne.
  await frame.click({ position: { x: 20, y: 30 } })
  await expect(dialog.getByTestId('hold-counter')).toContainText('1 prise placée')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(page.getByTestId('hold-counter')).toContainText('1 prise placée')
  await expect(page.getByTestId('hold-count-from-photo')).toContainText('1')

  // --- Le plein écran vaut aussi sur un téléphone (ADR-077) : c'est l'écart
  //     assumé à « le rendu mobile ne change pas ». Tout doit y rester
  //     atteignable, et aux 48 px — aucune dérogation hors tableau (ADR-073).
  await page.setViewportSize({ width: 360, height: 740 })
  await page.getByRole('button', { name: 'Agrandir la photo' }).click()
  await expect(dialog).toBeVisible()
  const photo = await dialog.getByTestId('photo-frame').boundingBox()
  // La photo garde sa hauteur : les commandes ne l'écrasent pas à un bandeau.
  expect(photo?.height ?? 0).toBeGreaterThan(250)

  // Rouvrir remonte l'annotateur : on resélectionne la prise pour retrouver son
  // panneau, le plus haut des blocs de commandes.
  await dialog.getByTestId('hold-handle').first().click()
  const done = dialog.getByRole('button', { name: 'Terminé' })
  const renumber = dialog.getByRole('button', { name: 'Renuméroter de bas en haut' })
  for (const control of [done, renumber]) {
    await control.scrollIntoViewIfNeeded()
    await expect(control).toBeInViewport()
  }
  expect(await tooSmall(page, TOUCH_TARGET, '[data-testid="hold-annotator-dialog"]')).toEqual([])
})
