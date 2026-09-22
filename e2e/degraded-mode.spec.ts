import { expect, test, type APIRequestContext } from '@playwright/test'

import { apiJson, loginApi, openContestRound, registerAndVerifyOrganizer } from './support/api'

// Lot 9, point 4 — mode dégradé : que voit CHAQUE acteur quand le serveur est
// injoignable ? (ADR-009 : pas de mode « zéro internet » à construire ; on
// vérifie que rien n'échoue brutalement et que chaque écran dit quoi faire.)
//   - juge : couvert par judge-offline-sync.spec.ts (tout vient d'IndexedDB) ;
//   - organisateur : le tableau de bord ne doit PAS rester figé en silence ;
//   - public : le classement déjà affiché reste, avec un indicateur honnête.

async function setUpPlayedContest(request: APIRequestContext, headers: Record<string, string>) {
  const name = `Coupe dégradée e2e ${Date.now()}`
  const competition = await apiJson<{ id: string; publicSlug: string }>(
    request,
    '/api/v1/competitions',
    {
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
    },
  )
  const base = `/api/v1/competitions/${competition.id}`
  const category = await apiJson<{ id: string }>(request, `${base}/categories`, {
    method: 'POST',
    headers,
    data: { label: 'Cat dégradée', sex: 'X' },
  })
  const competitor = await apiJson<{ id: string }>(request, `${base}/competitors`, {
    method: 'POST',
    headers,
    data: { categoryId: category.id, bib: 4, firstName: 'Camille', lastName: 'Dupuis' },
  })
  const route = await apiJson<{ id: string }>(request, `${base}/routes`, {
    method: 'POST',
    headers,
    data: { number: 1, holdCount: 40, categoryIds: [category.id] },
  })
  const judge = await apiJson<{ accessToken: string }>(request, `${base}/judges`, {
    method: 'POST',
    headers,
    data: { displayName: 'Juge dégradé', routeIds: [route.id] },
  })
  await openContestRound(request, headers, base)
  const { token } = await apiJson<{ token: string }>(request, '/api/v1/judge/auth', {
    method: 'POST',
    data: { token: judge.accessToken },
  })
  const detail = await apiJson<{ round: { id: string } }>(
    request,
    `/api/v1/judge/routes/${route.id}`,
    {
      headers: { authorization: `Bearer ${token}` },
    },
  )
  await apiJson(request, '/api/v1/judge/ascents/batch', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    data: {
      items: [
        {
          kind: 'create',
          id: crypto.randomUUID(),
          roundId: detail.round.id,
          routeId: route.id,
          competitorId: competitor.id,
          holdNumber: 22,
          modifier: 'none',
          isTop: false,
          status: 'valid',
          climbTimeMs: null,
          recordedAt: new Date().toISOString(),
          deviceId: 'device-e2e',
        },
      ],
    },
  })
  return { name, slug: competition.publicSlug }
}

test('organisateur : le tableau de bord avertit quand le serveur ne répond plus, puis se rétablit', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000)
  const { email, password } = await registerAndVerifyOrganizer(request, 'degrade')
  const { headers } = await loginApi(request, email, password)
  const { name } = await setUpPlayedContest(request, headers)

  await page.goto('/login')
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Mot de passe').fill(password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page).toHaveURL('/competitions')
  await page.getByText(name).click()
  await page.getByRole('tab', { name: 'Pilotage' }).click()
  await expect(page.getByText('Chargement…')).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)

  // Le serveur devient injoignable.
  await page.route('**/api/**', (route) => route.abort('connectionrefused'))
  await expect(page.getByRole('alert')).toContainText('Le serveur ne répond plus', {
    timeout: 40_000,
  })
  await expect(page.getByRole('alert')).toContainText('ne vous y fiez pas')
  // Les chiffres déjà affichés restent : on ne remplace pas tout par une page blanche.
  await expect(page.getByText('Chargement…')).toHaveCount(0)

  // Il revient : l'avertissement disparaît de lui-même.
  await page.unroute('**/api/**')
  await expect(page.getByRole('alert')).toHaveCount(0, { timeout: 40_000 })
})

test('organisateur : la connexion dit quoi faire quand le serveur est injoignable', async ({
  page,
}) => {
  await page.goto('/login')
  await page.route('**/api/**', (route) => route.abort('connectionrefused'))

  await page.getByLabel('E-mail').fill('quelquun@example.com')
  await page.getByLabel('Mot de passe').fill('un-mot-de-passe')
  await page.getByRole('button', { name: 'Se connecter' }).click()

  const message = page.getByText('Impossible de joindre le serveur')
  await expect(message).toBeVisible()
  await expect(page.getByText('Vérifiez votre connexion internet')).toBeVisible()
  await expect(page.getByText('Une erreur inattendue')).toHaveCount(0)
})

test('organisateur : la liste des compétitions propose de réessayer', async ({ page, request }) => {
  const { email, password } = await registerAndVerifyOrganizer(request, 'degrade-liste')
  await page.goto('/login')
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Mot de passe').fill(password)

  // La connexion mène directement à la liste (ADR-070 modifié) : l'abandon
  // de route doit être posé avant la connexion pour intercepter la requête
  // déclenchée par la redirection elle-même.
  await page.route('**/api/v1/competitions', (route) => route.abort('connectionrefused'))
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page).toHaveURL('/competitions')
  await expect(page.getByRole('alert')).toContainText('Impossible de joindre le serveur', {
    timeout: 15_000,
  })

  await page.unroute('**/api/v1/competitions')
  await page.getByRole('button', { name: 'Réessayer' }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('public : le classement déjà affiché reste, avec un indicateur honnête, puis « En direct » revient', async ({
  page,
  request,
  context,
}) => {
  test.setTimeout(120_000)
  const { email, password } = await registerAndVerifyOrganizer(request, 'degrade-public')
  const { headers } = await loginApi(request, email, password)
  const { slug } = await setUpPlayedContest(request, headers)

  await page.goto(`/c/${slug}`)
  await expect(page.getByText('Camille')).toBeVisible()
  await expect(page.getByText('En direct')).toBeVisible()

  await context.setOffline(true)
  await expect(page.getByText('Reconnexion…')).toBeVisible({ timeout: 40_000 })
  // Le dernier classement connu reste lisible, jamais une page blanche.
  await expect(page.getByText('Camille')).toBeVisible()

  await context.setOffline(false)
  await expect(page.getByText('En direct')).toBeVisible({ timeout: 60_000 })
})
