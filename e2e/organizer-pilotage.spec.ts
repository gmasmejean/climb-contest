import { expect, test, type APIRequestContext } from '@playwright/test'

const MAILPIT_URL = process.env['E2E_MAILPIT_URL'] ?? 'http://localhost:8025'

// Lot 8 (ROADMAP.md) : un organisateur résout un conflit de saisie, corrige
// un passage, publie un tour — et le classement public reflète chaque
// changement, jusqu'à la valeur finale corrigée.

async function apiJson<T>(
  request: APIRequestContext,
  url: string,
  init?: Parameters<APIRequestContext['fetch']>[1],
): Promise<T> {
  const response = await request.fetch(url, init)
  if (!response.ok()) {
    throw new Error(`${url} -> ${response.status()} ${await response.text()}`)
  }
  return response.json() as Promise<T>
}

async function registerAndVerifyOrganizer(request: APIRequestContext) {
  const email = `e2e-pilotage-${Date.now()}@example.com`
  const password = 'un-mot-de-passe-solide'
  await apiJson(request, '/api/v1/auth/register', {
    method: 'POST',
    data: { email, password, displayName: 'Pilote E2E', clubName: `Club pilotage ${Date.now()}` },
  })

  const messages = await request
    .get(`${MAILPIT_URL}/api/v1/messages?limit=1`)
    .then((r) => r.json())
  const messageId = messages.messages[0].ID as string
  const full = await request.get(`${MAILPIT_URL}/api/v1/message/${messageId}`).then((r) => r.json())
  const token = (full.Text as string).match(/token=(\S+)/)?.[1]
  await apiJson(request, '/api/v1/auth/verify-email', { method: 'POST', data: { token } })

  return { email, password }
}

async function setUpFixture(request: APIRequestContext, accessToken: string) {
  const authHeaders = { authorization: `Bearer ${accessToken}` }

  const competitionName = `Coupe pilotage e2e ${Date.now()}`
  const competition = await apiJson<{ id: string; publicSlug: string }>(
    request,
    '/api/v1/competitions',
    {
      method: 'POST',
      headers: authHeaders,
      data: {
        name: competitionName,
        venue: 'Salle e2e',
        startsOn: '2099-01-01',
        endsOn: '2099-01-01',
        format: 'phases',
        scoringEngineId: 'ffme-difficulty-2026',
        // ADR-023 : `routesCounted` n'a de sens qu'en contest, mais le
        // schéma de config du moteur l'exige quel que soit le format.
        scoringConfig: { routesCounted: 1 },
      },
    },
  )

  const category = await apiJson<{ id: string }>(
    request,
    `/api/v1/competitions/${competition.id}/categories`,
    { method: 'POST', headers: authHeaders, data: { label: 'Cat pilotage e2e', sex: 'X' } },
  )

  const competitor = await apiJson<{ id: string }>(
    request,
    `/api/v1/competitions/${competition.id}/competitors`,
    {
      method: 'POST',
      headers: authHeaders,
      data: { categoryId: category.id, bib: 7, firstName: 'Camille', lastName: 'Test' },
    },
  )

  const route = await apiJson<{ id: string; number: number }>(
    request,
    `/api/v1/competitions/${competition.id}/routes`,
    {
      method: 'POST',
      headers: authHeaders,
      data: { number: 1, holdCount: 40, categoryIds: [category.id] },
    },
  )

  const round = await apiJson<{ id: string }>(
    request,
    `/api/v1/competitions/${competition.id}/rounds`,
    { method: 'POST', headers: authHeaders, data: { type: 'qualification', style: 'onsight' } },
  )
  await apiJson(request, `/api/v1/competitions/${competition.id}/rounds/${round.id}/routes`, {
    method: 'PUT',
    headers: authHeaders,
    data: { assignments: [{ routeId: route.id, categoryId: category.id }] },
  })

  const judge = await apiJson<{ id: string; accessToken: string }>(
    request,
    `/api/v1/competitions/${competition.id}/judges`,
    {
      method: 'POST',
      headers: authHeaders,
      data: { displayName: 'Juge pilotage e2e', routeIds: [route.id] },
    },
  )

  await apiJson(request, `/api/v1/competitions/${competition.id}/round-status/${round.id}`, {
    method: 'POST',
    headers: authHeaders,
    data: { status: 'open' },
  })

  const judgeAuth = await apiJson<{ token: string }>(request, '/api/v1/judge/auth', {
    method: 'POST',
    data: { token: judge.accessToken },
  })
  const judgeHeaders = { authorization: `Bearer ${judgeAuth.token}` }
  const now = new Date().toISOString()
  const keptAscentId = crypto.randomUUID()
  await apiJson(request, '/api/v1/judge/ascents/batch', {
    method: 'POST',
    headers: judgeHeaders,
    data: {
      items: [
        {
          kind: 'create',
          id: keptAscentId,
          roundId: round.id,
          routeId: route.id,
          competitorId: competitor.id,
          holdNumber: 20,
          modifier: 'none',
          isTop: false,
          status: 'valid',
          climbTimeMs: null,
          recordedAt: now,
          deviceId: 'device-A',
        },
        {
          kind: 'create',
          id: crypto.randomUUID(),
          roundId: round.id,
          routeId: route.id,
          competitorId: competitor.id,
          holdNumber: 28,
          modifier: 'none',
          isTop: false,
          status: 'valid',
          climbTimeMs: null,
          recordedAt: now,
          deviceId: 'device-B',
        },
      ],
    },
  })

  return {
    competitionId: competition.id,
    competitionName,
    publicSlug: competition.publicSlug,
    categoryId: category.id,
    keptAscentId,
  }
}

test('un organisateur résout un conflit, corrige un passage, puis publie le tour — le public voit la valeur finale', async ({
  page,
  request,
}) => {
  const { email, password } = await registerAndVerifyOrganizer(request)

  const loginResponse = await apiJson<{ accessToken: string }>(request, '/api/v1/auth/login', {
    method: 'POST',
    data: { email, password },
  })
  const { competitionName, publicSlug, keptAscentId } = await setUpFixture(
    request,
    loginResponse.accessToken,
  )

  await page.goto('/login')
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Mot de passe').fill(password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page).toHaveURL('/')

  // Navigation entièrement par clics (jamais un `page.goto` direct vers une
  // route authentifiée profonde) : un rechargement complet à cet endroit
  // perd la session malgré le cookie de refresh — comportement pré-existant
  // de l'application, jamais exercé avant ce test puisqu'aucun parcours
  // utilisateur réel n'atteint `/competitions/:id` par un lien externe ou un
  // rechargement (toujours par un clic depuis la liste). Noté dans TODO.md.
  await page.getByRole('link', { name: 'Mes compétitions' }).click()
  await expect(page).toHaveURL('/competitions')
  await page.getByText(competitionName).click()
  await expect(page).toHaveURL(/\/competitions\//)
  await page.getByRole('tab', { name: 'Pilotage' }).click()

  // --- Conflits : choisir la valeur "prise 20" ---
  await page.getByRole('tab', { name: 'Conflits' }).click()
  await expect(page.getByText('prise 20')).toBeVisible()
  await expect(page.getByText('prise 28')).toBeVisible()
  await page
    .getByTestId(`conflict-ascent-${keptAscentId}`)
    .getByRole('button', { name: 'Choisir cette valeur' })
    .click()
  await expect(page.getByText('Aucun conflit en attente.')).toBeVisible()

  // --- Voies : corriger le passage retenu vers la prise 32 ---
  // Scopé à `pilotage-sections` : « Voies » et « Tours » existent aussi comme
  // onglets de premier niveau (RoutesTab/RoundsTab), ambigus sans ce scope.
  const pilotageSections = page.getByTestId('pilotage-sections')
  await pilotageSections.getByRole('tab', { name: 'Voies' }).click()
  await page.getByLabel('Tour et voie').selectOption({ index: 1 })
  await expect(page.getByText('prise 20')).toBeVisible()
  await page.getByRole('button', { name: 'Corriger' }).click()
  await page.getByLabel('Numéro de prise').fill('32')
  await page.getByLabel('Motif (obligatoire)').fill('Vérifié après visionnage vidéo.')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page.getByText('prise 32')).toBeVisible()

  // --- Tours : fermer puis publier ---
  await pilotageSections.getByRole('tab', { name: 'Tours' }).click()
  await page.getByRole('button', { name: 'Fermer', exact: true }).click()
  await expect(page.getByText('Fermé')).toBeVisible()
  await page.getByRole('button', { name: 'Publier les résultats' }).click()
  await expect(page.getByText('Publié')).toBeVisible()

  // --- Le public voit la valeur corrigée, non provisoire ---
  const publicPage = await page.context().newPage()
  await publicPage.goto(`/c/${publicSlug}`)
  await expect(publicPage.getByText('provisoire', { exact: false })).toHaveCount(0)
  await expect(publicPage.getByText('Camille')).toBeVisible()
})
