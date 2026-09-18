import { expect, test, type APIRequestContext } from '@playwright/test'

// Lot 6, plan de test : coupe le réseau, note 10 passages hors ligne, recharge
// la page (cas SPEC.md § 9 #23 : les 10 doivent survivre), rétablit le réseau,
// et vérifie que les 10 remontent dans l'ordre de saisie (pas l'ordre réseau).

const ORGANIZER_EMAIL = 'organisateur@club-demo.test'
const ORGANIZER_PASSWORD = 'ChangeMoi123!'
const COMPETITOR_COUNT = 10

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

async function setUpFixture(request: APIRequestContext) {
  const { accessToken } = await apiJson<{ accessToken: string }>(request, '/api/v1/auth/login', {
    method: 'POST',
    data: { email: ORGANIZER_EMAIL, password: ORGANIZER_PASSWORD },
  })
  const authHeaders = { authorization: `Bearer ${accessToken}` }

  const competition = await apiJson<{ id: string }>(request, '/api/v1/competitions', {
    method: 'POST',
    headers: authHeaders,
    data: {
      name: `Coupe hors-ligne e2e ${Date.now()}`,
      venue: 'Salle e2e',
      startsOn: '2099-01-01',
      endsOn: '2099-01-01',
      format: 'contest',
      scoringEngineId: 'ffme-difficulty-2026',
      scoringConfig: { routesCounted: 3 },
    },
  })

  const category = await apiJson<{ id: string }>(
    request,
    `/api/v1/competitions/${competition.id}/categories`,
    { method: 'POST', headers: authHeaders, data: { label: 'Cat e2e', sex: 'X' } },
  )

  const competitors = []
  for (let i = 0; i < COMPETITOR_COUNT; i += 1) {
    const competitor = await apiJson<{ id: string; bib: number }>(
      request,
      `/api/v1/competitions/${competition.id}/competitors`,
      {
        method: 'POST',
        headers: authHeaders,
        data: { categoryId: category.id, bib: 10 + i, firstName: `Prenom${i}`, lastName: 'Test' },
      },
    )
    competitors.push(competitor)
  }

  const route = await apiJson<{ id: string; number: number }>(
    request,
    `/api/v1/competitions/${competition.id}/routes`,
    {
      method: 'POST',
      headers: authHeaders,
      data: { number: 1, holdCount: 40, categoryIds: [category.id] },
    },
  )

  const judge = await apiJson<{ accessToken: string }>(
    request,
    `/api/v1/competitions/${competition.id}/judges`,
    {
      method: 'POST',
      headers: authHeaders,
      data: { displayName: 'Juge hors ligne e2e', routeIds: [route.id] },
    },
  )

  await apiJson(request, `/api/v1/competitions/${competition.id}/status`, {
    method: 'POST',
    headers: authHeaders,
    data: { status: 'running' },
  })

  return {
    judgeToken: judge.accessToken,
    routeNumber: route.number,
    competitionId: competition.id,
    competitors,
    authHeaders,
  }
}

test('un juge note 10 passages hors ligne, ferme/rouvre, et tout remonte dans l’ordre au retour du réseau', async ({
  page,
  request,
}) => {
  const { judgeToken, routeNumber } = await setUpFixture(request)

  // Le bootstrap doit se faire EN LIGNE (SPEC.md § 6.3) — avant toute
  // coupure.
  await page.goto(`/j/${judgeToken}`)
  await page.getByRole('button', { name: 'Commencer' }).click()
  await expect(page).toHaveURL('/j/home')

  await page.context().setOffline(true)

  await page.getByText(`Voie ${routeNumber}`).click()
  await expect(page).toHaveURL(/\/j\/routes\//)

  for (let i = 0; i < COMPETITOR_COUNT; i += 1) {
    await page.getByText(`Prenom${i} Test`).click()
    const holdTens = String(10 + i).charAt(0)
    const holdUnits = String(10 + i).charAt(1)
    await page.getByRole('button', { name: holdTens, exact: true }).click()
    await page.getByRole('button', { name: holdUnits, exact: true }).click()
    await page.getByRole('button', { name: 'Voir le récapitulatif' }).click()
    await page.getByRole('button', { name: 'Confirmer' }).click()
    await expect(page).toHaveURL(/\/j\/routes\//)
    // Le toast de confirmation (App.vue) reste affiché par-dessus l'écran
    // suivant le temps de sa durée — attendre qu'il disparaisse avant
    // d'enchaîner évite qu'il recouvre le bouton du compétiteur suivant.
    await expect(page.getByText('Passage enregistré ✓')).toBeHidden()
  }

  await expect(page.getByTestId('judge-sync-banner')).toContainText(
    `Hors ligne, ${COMPETITOR_COUNT}`,
  )

  // Cas SPEC.md § 9 #23 : fermeture/réouverture d'onglet — toujours hors
  // ligne, les 10 doivent avoir survécu au rechargement.
  await page.reload()
  await expect(page.getByTestId('judge-sync-banner')).toContainText(
    `Hors ligne, ${COMPETITOR_COUNT}`,
  )
  await page.getByRole('tab', { name: /Fait/ }).click()
  for (let i = 0; i < COMPETITOR_COUNT; i += 1) {
    await expect(page.getByText(`Prenom${i} Test`)).toBeVisible()
  }

  await page.context().setOffline(false)

  await expect(page.getByTestId('judge-sync-banner')).toContainText('À jour', { timeout: 30_000 })

  // Vérifie côté serveur (via l'API juge, une requête indépendante de la
  // page) que les 10 sont bien arrivés, dans l'ordre de SAISIE (recordedAt
  // croissant), pas l'ordre d'arrivée réseau.
  const { token: judgeJwt } = await apiJson<{ token: string }>(request, '/api/v1/judge/auth', {
    method: 'POST',
    data: { token: judgeToken },
  })
  const judgeAuthHeaders = { authorization: `Bearer ${judgeJwt}` }
  const [judgeRoute] = await apiJson<Array<{ id: string }>>(request, '/api/v1/judge/routes', {
    headers: judgeAuthHeaders,
  })
  if (!judgeRoute) throw new Error('Aucune voie assignée au juge.')

  const routeDetail = await apiJson<{
    competitors: Array<{ ascent: { holdNumber: number; recordedAt: string } | null }>
  }>(request, `/api/v1/judge/routes/${judgeRoute.id}`, { headers: judgeAuthHeaders })

  const ascents = routeDetail.competitors
    .map((c) => c.ascent)
    .filter((a): a is { holdNumber: number; recordedAt: string } => a !== null)
    .sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime())

  expect(ascents).toHaveLength(COMPETITOR_COUNT)
  expect(ascents.map((a) => a.holdNumber)).toEqual(
    Array.from({ length: COMPETITOR_COUNT }, (_, i) => 10 + i),
  )
})
