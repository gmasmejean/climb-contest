import { readFileSync } from 'node:fs'
import path from 'node:path'

import { expect, test, type Locator, type Page } from '@playwright/test'

import { noHorizontalScroll, tooSmall } from './support/a11y'
import { apiJson, loginApi, registerAndVerifyOrganizer } from './support/api'

// Lot 27 (ADR-090) : l'owner ajoute des photos à la fiche de son organisation —
// ré-encodées par le navigateur, décrites, réordonnées, supprimées puis remises
// avec « Annuler » — et le public les voit dans l'encart, en grand au toucher.
// Tourne aussi en émulation mobile (360 px).

const WALL_PHOTO = readFileSync(path.join(process.cwd(), 'apps/api/src/test-utils/wall.jpg'))
const wall = (name: string) => ({ name, mimeType: 'image/jpeg', buffer: WALL_PHOTO })

async function watchImgCsp(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const violations: string[] = []
    Object.assign(window, { __cspViolations: violations })
    document.addEventListener('securitypolicyviolation', (event) => {
      if (event.violatedDirective.startsWith('img-src')) {
        violations.push(`${event.violatedDirective} ${event.blockedURI}`)
      }
    })
  })
  return () =>
    page.evaluate(() => {
      const value: unknown = Reflect.get(window, '__cspViolations')
      return Array.isArray(value) ? value.map(String) : []
    })
}

/** L'image est affichée pour de vrai (décodée), pas seulement présente dans la page. */
async function decoded(image: Locator): Promise<boolean> {
  return image.evaluate(
    (el) => el instanceof HTMLImageElement && el.complete && el.naturalWidth > 0,
  )
}

test('l’owner gère les photos de la fiche, le public les voit dans l’encart', async ({
  page,
  request,
  browser,
  baseURL,
}) => {
  test.setTimeout(120_000)
  const stamp = Date.now()
  const { email, password } = await registerAndVerifyOrganizer(request, 'photos')
  const { headers } = await loginApi(request, email, password)
  const competition = await apiJson<{ publicSlug: string }>(request, '/api/v1/competitions', {
    method: 'POST',
    headers,
    data: {
      name: `Coupe des photos ${stamp}`,
      venue: 'Gymnase',
      startsOn: '2099-03-01',
      endsOn: '2099-03-01',
      format: 'contest',
      scoringEngineId: 'ffme-difficulty-2026',
      scoringConfig: { routesCounted: 1 },
    },
  })

  const cspViolations = await watchImgCsp(page)
  await page.goto('/login')
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Mot de passe').fill(password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page).toHaveURL('/competitions')
  await page.goto('/organization')

  const manager = page.getByTestId('photos-manager')
  await expect(manager).toContainText('Aucune photo pour l’instant.')
  await expect(manager).toContainText('qu’avec son accord')

  // --- Deux vraies photos et un faux JPEG, choisis d'un coup ---
  await manager
    .getByTestId('photo-input')
    .setInputFiles([
      wall('mur.jpg'),
      { name: 'faux.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('pas une image') },
      wall('accueil.jpg'),
    ])
  const photos = manager.getByTestId('managed-photo')
  await expect(photos).toHaveCount(2)
  await expect(manager.getByRole('alert')).toContainText(
    'faux.jpg : Ce fichier n’est pas une photo',
  )
  await expect.poll(() => decoded(photos.nth(1).locator('img'))).toBe(true)

  // --- Décrire la deuxième, puis l'avancer ---
  await photos.nth(1).getByLabel('Description (texte alternatif)').fill('Le mur de bloc')
  await manager.getByRole('button', { name: 'Enregistrer la description' }).click()
  await expect(
    manager.getByRole('status').filter({ hasText: 'Description enregistrée.' }),
  ).toBeVisible()
  await manager.getByRole('button', { name: 'Avancer la photo 2' }).click()
  await expect(photos.first().locator('img')).toHaveAttribute('alt', 'Le mur de bloc')

  expect(await noHorizontalScroll(page)).toBe(true)
  expect(await tooSmall(page, undefined, '[data-testid="photos-manager"]')).toEqual([])

  // --- Supprimer, puis « Annuler » : la photo revient à sa place ---
  await manager.getByRole('button', { name: 'Supprimer la photo 1' }).click()
  await expect(photos).toHaveCount(1)
  await expect(manager.getByTestId('photo-deleted')).toContainText('Photo supprimée.')
  await manager.getByRole('button', { name: 'Annuler' }).click()
  await expect(photos).toHaveCount(2)
  await expect(photos.first().locator('img')).toHaveAttribute('alt', 'Le mur de bloc')

  await page.reload()
  await expect(photos).toHaveCount(2)
  await expect(photos.first().getByLabel('Description (texte alternatif)')).toHaveValue(
    'Le mur de bloc',
  )
  expect(await cspViolations()).toEqual([])

  // --- Le public : vignettes dans l'encart, photo en grand ---
  const publicContext = await browser.newContext(baseURL ? { baseURL } : {})
  const visitor = await publicContext.newPage()
  const publicCsp = await watchImgCsp(visitor)
  await visitor.goto(`/c/${competition.publicSlug}`)
  const card = visitor.getByTestId('organization-card')
  const thumbnails = card.getByTestId('organization-photo')
  await expect(thumbnails).toHaveCount(2)
  await thumbnails.first().scrollIntoViewIfNeeded()
  await expect.poll(() => decoded(thumbnails.first().locator('img'))).toBe(true)
  await expect(thumbnails.first().locator('img')).toHaveAttribute('alt', 'Le mur de bloc')
  await expect(thumbnails.nth(1).locator('img')).toHaveAttribute(
    'alt',
    /^Photo 2 sur 2 de Club photos/,
  )
  expect(await noHorizontalScroll(visitor)).toBe(true)
  expect(await tooSmall(visitor, undefined, '[data-testid="organization-card"]')).toEqual([])

  await thumbnails.first().click()
  const viewer = visitor.getByTestId('organization-photo-viewer')
  await expect(viewer).toContainText('photo 1 sur 2')
  await expect(viewer.locator('figcaption')).toHaveText('Le mur de bloc')
  await expect(viewer.getByRole('button', { name: 'Fermer' })).toBeFocused()
  await viewer.getByRole('button', { name: 'Suivante' }).click()
  await expect(viewer).toContainText('photo 2 sur 2')
  await expect.poll(() => decoded(viewer.locator('img'))).toBe(true)
  expect(await tooSmall(visitor, undefined, '[data-testid="organization-photo-viewer"]')).toEqual(
    [],
  )
  await viewer.getByRole('button', { name: 'Fermer' }).click()
  await expect(viewer).toHaveCount(0)
  // Le focus revient à la vignette de la photo affichée en dernier.
  await expect(thumbnails.nth(1)).toBeFocused()
  expect(await publicCsp()).toEqual([])
  await publicContext.close()
})
