import { expect, test, type Page } from '@playwright/test'

import { noHorizontalScroll, tooSmall } from './support/a11y'
import { apiJson, loginApi, registerAndVerifyOrganizer } from './support/api'

// Lot 25 (ADR-088) : l'owner remplit la fiche de son organisation — adresse
// autocomplétée par la BAN, carte IGN, contact public — et le public la
// retrouve en encart sous le classement. Les appels à la Géoplateforme sont
// interceptés (réponse réelle enregistrée, tuile factice) : le parcours ne
// dépend pas d'un service extérieur. La CSP de Caddy s'applique quand même,
// avant l'interception : une violation ferait échouer le test.
// Tourne aussi en émulation mobile (360 px).

const BAN_FEATURE = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [2.290084, 49.897442] },
  properties: {
    label: '8 Boulevard du Port 80000 Amiens',
    id: '80021_6590_00008',
    postcode: '80000',
    city: 'Amiens',
    type: 'housenumber',
  },
}
// PNG 1×1 transparent : Leaflet l'étire à 256 px.
const TILE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

async function watchCsp(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const violations: string[] = []
    Object.assign(window, { __cspViolations: violations })
    // Seules les directives que ce lot ouvre : Zod teste `new Function` au
    // démarrage (repli silencieux, `script-src eval`), sans rapport ici.
    document.addEventListener('securitypolicyviolation', (event) => {
      if (/^(connect|img)-src/.test(event.violatedDirective)) {
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

async function routeTiles(page: Page): Promise<string[]> {
  const requested: string[] = []
  await page.route('https://data.geopf.fr/wmts**', (route) => {
    requested.push(route.request().url())
    return route.fulfill({ status: 200, contentType: 'image/png', body: TILE })
  })
  return requested
}

test('l’owner remplit la fiche, le public la voit sous le classement', async ({
  page,
  request,
  browser,
  baseURL,
}) => {
  test.setTimeout(120_000)
  const stamp = Date.now()
  const { email, password } = await registerAndVerifyOrganizer(request, 'fiche')
  const { headers } = await loginApi(request, email, password)
  const competition = await apiJson<{ publicSlug: string }>(request, '/api/v1/competitions', {
    method: 'POST',
    headers,
    data: {
      name: `Coupe de la fiche ${stamp}`,
      venue: 'Gymnase',
      startsOn: '2099-03-01',
      endsOn: '2099-03-01',
      format: 'contest',
      scoringEngineId: 'ffme-difficulty-2026',
      scoringConfig: { routesCounted: 1 },
    },
  })

  const cspViolations = await watchCsp(page)
  const tiles = await routeTiles(page)
  let banUp = false
  const banQueries: string[] = []
  await page.route('https://data.geopf.fr/geocodage/search**', (route) => {
    banQueries.push(new URL(route.request().url()).searchParams.get('q') ?? '')
    return banUp
      ? route.fulfill({ json: { type: 'FeatureCollection', features: [BAN_FEATURE] } })
      : route.fulfill({ status: 503, body: 'indisponible' })
  })

  await page.goto('/login')
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Mot de passe').fill(password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page).toHaveURL('/competitions')
  await page.getByRole('button', { name: 'Menu' }).click()
  await page.getByRole('menuitem', { name: 'Fiche de l’organisation' }).click()
  await expect(page).toHaveURL('/organization')

  await page.getByLabel('Type').selectOption('gym')
  await page
    .getByLabel('Description')
    .fill('Salle de bloc et de difficulté.\nOuverte 7 jours sur 7.')

  // --- Service d'adresses en panne : la saisie reste possible ---
  const address = page.getByRole('combobox', { name: 'Adresse' })
  await address.fill('8 bd du port')
  await expect(
    page.getByText('Le service d’adresses ne répond pas. Votre adresse sera enregistrée'),
  ).toBeVisible()

  // --- Il revient : on choisit une proposition, la carte apparaît ---
  banUp = true
  await address.fill('8 bd du port amiens')
  await page.getByRole('option', { name: '8 Boulevard du Port 80000 Amiens' }).click()
  await expect(address).toHaveValue('8 Boulevard du Port 80000 Amiens')
  await expect(page.getByText('Adresse localisée')).toBeVisible()
  await expect(page.getByTestId('location-map')).toBeVisible()
  await expect.poll(() => tiles.length).toBeGreaterThan(0)
  expect(banQueries).toContain('8 bd du port amiens')

  await expect(page.getByTestId('public-contact-warning')).toContainText('visibles de tous')
  await page.getByLabel('E-mail').fill(`contact-${stamp}@example.com`)
  await page.getByLabel('Téléphone').fill('03 22 00 00 00')
  await page.getByLabel('Site web').fill('www.club-fiche.example')

  expect(await noHorizontalScroll(page)).toBe(true)
  // L'attribution de la carte (« Leaflet », « © IGN – Plan IGN ») est la mention
  // de licence en petit texte, pas une commande ; les boutons de zoom, eux, comptent.
  const small = await tooSmall(page, undefined, 'main form')
  expect(small.filter((entry) => !/Leaflet|IGN/.test(entry))).toEqual([])

  await page.getByRole('button', { name: 'Enregistrer la fiche' }).click()
  await expect(page.getByText('Fiche enregistrée.')).toBeVisible()

  await page.reload()
  await expect(page.getByLabel('Site web')).toHaveValue('https://www.club-fiche.example')
  await expect(page.getByRole('combobox', { name: 'Adresse' })).toHaveValue(
    '8 Boulevard du Port 80000 Amiens',
  )
  expect(await cspViolations()).toEqual([])

  // --- Le public : encart sous le classement ---
  const publicContext = await browser.newContext(baseURL ? { baseURL } : {})
  const visitor = await publicContext.newPage()
  const publicCsp = await watchCsp(visitor)
  const publicTiles = await routeTiles(visitor)
  await visitor.goto(`/c/${competition.publicSlug}`)
  const card = visitor.getByTestId('organization-card')
  await expect(card).toContainText('Organisé par')
  await expect(card.getByRole('heading', { level: 2 })).toContainText('Club fiche')
  await expect(card).toContainText('Salle')
  await expect(card).toContainText('Ouverte 7 jours sur 7.')
  await expect(card).toContainText('8 Boulevard du Port 80000 Amiens')
  await expect(card.getByRole('link', { name: /Itinéraire/ })).toHaveAttribute(
    'href',
    /destination=49\.897442%2C2\.290084/,
  )
  await expect(card.getByRole('link', { name: '03 22 00 00 00' })).toHaveAttribute(
    'href',
    'tel:0322000000',
  )
  await expect(card.getByTestId('location-map')).toBeVisible()
  await expect.poll(() => publicTiles.length).toBeGreaterThan(0)
  expect(await noHorizontalScroll(visitor)).toBe(true)
  expect(await publicCsp()).toEqual([])
  await publicContext.close()
})
