import { expect, test, type Page } from '@playwright/test'

import { noHorizontalScroll, tooSmall } from './support/a11y'
import { apiJson, loginApi, registerAndVerifyOrganizer } from './support/api'

// Lot 26 (ADR-089) : l'organisation a une adresse ; à la création d'une
// compétition, son lieu est proposé et recopié. On le change ensuite pour un
// autre lieu depuis l'onglet Infos. Le public voit le lieu et sa carte sous le
// classement. Géoplateforme interceptée comme au Lot 25 (la CSP s'applique
// quand même). Tourne aussi en émulation mobile (360 px).

const ORGANIZATION_ADDRESS = {
  label: '8 Boulevard du Port 80000 Amiens',
  postcode: '80000',
  city: 'Amiens',
  latitude: 49.897442,
  longitude: 2.290084,
  banId: '80021_6590_00008',
}
const OTHER_FEATURE = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [1.833, 50.105] },
  properties: {
    label: '1 Rue du Gymnase 80100 Abbeville',
    id: '80001_0001_00001',
    postcode: '80100',
    city: 'Abbeville',
  },
}
// PNG 1×1 transparent : Leaflet l'étire à 256 px.
const TILE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

async function routeGeoplateforme(page: Page): Promise<void> {
  await page.route('https://data.geopf.fr/wmts**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: TILE }),
  )
  await page.route('https://data.geopf.fr/geocodage/search**', (route) =>
    route.fulfill({ json: { type: 'FeatureCollection', features: [OTHER_FEATURE] } }),
  )
}

test('le lieu de l’organisation est proposé à la création, puis changé ; le public le voit', async ({
  page,
  request,
  browser,
  baseURL,
}) => {
  test.setTimeout(120_000)
  const { email, password } = await registerAndVerifyOrganizer(request, 'lieu')
  const { headers } = await loginApi(request, email, password)
  await apiJson(request, '/api/v1/organization', {
    method: 'PATCH',
    headers,
    data: { name: 'Roc’n Bloc Amiens', address: ORGANIZATION_ADDRESS },
  })
  await routeGeoplateforme(page)

  await page.goto('/login')
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Mot de passe').fill(password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page).toHaveURL('/competitions')
  await page.goto('/competitions/new')

  // --- Création : le lieu de l'organisation est présélectionné et résumé ---
  const organizationPlace = page.getByRole('radio', { name: /Lieu de l’organisation/ })
  await expect(organizationPlace).toBeChecked()
  await expect(page.getByText('Roc’n Bloc Amiens — 8 Boulevard du Port 80000 Amiens')).toBeVisible()
  await expect(page.getByRole('combobox', { name: /Adresse/ })).toHaveCount(0)
  await page.getByLabel('Nom de la compétition').fill('Open du port')
  await page.getByLabel('Date de début').fill('2099-05-10')
  expect(await noHorizontalScroll(page)).toBe(true)
  expect(await tooSmall(page, undefined, 'main form')).toEqual([])
  await page.getByRole('button', { name: 'Créer la compétition' }).click()
  await expect(page).toHaveURL(/\/competitions\/[0-9a-f-]+$/)
  const competitionId = page.url().split('/').pop() ?? ''
  const { publicSlug } = await apiJson<{ publicSlug: string }>(
    request,
    `/api/v1/competitions/${competitionId}`,
    { headers },
  )

  // --- Le public : lieu et carte, l'encart ne répète pas la même carte ---
  const publicContext = await browser.newContext(baseURL ? { baseURL } : {})
  const visitor = await publicContext.newPage()
  await routeGeoplateforme(visitor)
  await visitor.goto(`/c/${publicSlug}`)
  const place = visitor.getByTestId('competition-place')
  await expect(place).toContainText('Roc’n Bloc Amiens')
  await expect(place).toContainText('8 Boulevard du Port 80000 Amiens')
  await expect(place.getByTestId('location-map')).toBeVisible()
  await expect(visitor.getByTestId('location-map')).toHaveCount(1)
  expect(await noHorizontalScroll(visitor)).toBe(true)

  // --- Onglet Infos : le lieu est reconnu, puis remplacé par un autre ---
  await expect(organizationPlace).toBeChecked()
  await page.getByRole('radio', { name: 'Autre lieu' }).check()
  await page.getByLabel('Nom du lieu').fill('Gymnase d’Abbeville')
  const address = page.getByRole('combobox', { name: /Adresse/ })
  await expect(address).toHaveValue('8 Boulevard du Port 80000 Amiens')
  await address.fill('1 rue du gymnase abbeville')
  await page.getByRole('option', { name: '1 Rue du Gymnase 80100 Abbeville' }).click()
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click()
  await expect(page.getByText('Compétition mise à jour.')).toBeVisible()

  await visitor.reload()
  await expect(place).toContainText('Gymnase d’Abbeville')
  await expect(place).toContainText('1 Rue du Gymnase 80100 Abbeville')
  await expect(place.getByRole('link', { name: /Itinéraire/ })).toHaveAttribute(
    'href',
    /destination=50\.105%2C1\.833/,
  )
  // Ailleurs que chez l'organisation : l'encart garde sa propre carte.
  await expect(visitor.getByTestId('location-map')).toHaveCount(2)
  await publicContext.close()
})
