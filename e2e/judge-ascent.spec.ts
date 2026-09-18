import { expect, test, type APIRequestContext } from '@playwright/test'

// Parcours complet exigé par ROADMAP.md Lot 5, point 7, en émulation mobile
// (voir playwright.config.ts, projet `mobile`) : un juge accède à sa voie,
// note un passage, le voit passer en « fait » avec un indicateur de
// synchronisation, puis le corrige dans la fenêtre de correction (ADR-007).
//
// Amorçage via l'API du compte organisateur déjà seedé (`db:seed`,
// `login.spec.ts`) plutôt que par inscription + vérification e-mail — plus
// rapide, et hors du périmètre de ce test.

const ORGANIZER_EMAIL = 'organisateur@club-demo.test'
const ORGANIZER_PASSWORD = 'ChangeMoi123!'

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

async function setUpJudgeFixture(request: APIRequestContext) {
  const { accessToken } = await apiJson<{ accessToken: string }>(request, '/api/v1/auth/login', {
    method: 'POST',
    data: { email: ORGANIZER_EMAIL, password: ORGANIZER_PASSWORD },
  })
  const authHeaders = { authorization: `Bearer ${accessToken}` }

  const competition = await apiJson<{ id: string }>(request, '/api/v1/competitions', {
    method: 'POST',
    headers: authHeaders,
    data: {
      name: `Coupe e2e ${Date.now()}`,
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

  await apiJson(request, `/api/v1/competitions/${competition.id}/competitors`, {
    method: 'POST',
    headers: authHeaders,
    data: { categoryId: category.id, bib: 47, firstName: 'Léa', lastName: 'Martin' },
  })

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
      data: { displayName: 'Juge e2e', routeIds: [route.id] },
    },
  )

  // Ouvre le round implicite (ADR-030) : aucun écran organisateur ne le fait
  // pour le format contest, la compétition passe simplement à « running ».
  await apiJson(request, `/api/v1/competitions/${competition.id}/status`, {
    method: 'POST',
    headers: authHeaders,
    data: { status: 'running' },
  })

  return { judgeToken: judge.accessToken, routeNumber: route.number }
}

test('un juge note un passage, le voit synchronisé, puis le corrige', async ({ page, request }) => {
  const { judgeToken, routeNumber } = await setUpJudgeFixture(request)

  await page.goto(`/j/${judgeToken}`)
  await expect(page.getByText('Bonjour Juge e2e')).toBeVisible()
  await page.getByRole('button', { name: 'Commencer' }).click()

  await expect(page).toHaveURL('/j/home')
  await expect(page.getByText(`Voie ${routeNumber}`)).toBeVisible()
  await page.getByText(`Voie ${routeNumber}`).click()

  await expect(page.getByText('Dossard 47 — Léa Martin')).toBeVisible()
  await page.getByText('Dossard 47 — Léa Martin').click()

  await page.getByRole('button', { name: '2', exact: true }).click()
  await page.getByRole('button', { name: '5', exact: true }).click()
  await page.getByRole('button', { name: '+', exact: true }).click()
  await page.getByRole('button', { name: 'Voir le récapitulatif' }).click()

  await expect(
    page.getByText(`Dossard 47 — Léa Martin — Voie ${routeNumber} — prise 25+`),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Confirmer' }).click()

  await expect(page).toHaveURL(/\/j\/routes\//)
  await expect(page.getByRole('tab', { name: /À faire/ })).toHaveText('À faire (0)')
  await page.getByRole('tab', { name: /Fait/ }).click()
  const row = page.getByRole('listitem').filter({ hasText: 'Dossard 47 — Léa Martin' })
  await expect(row).toBeVisible()
  await expect(row.getByText('prise 25+')).toBeVisible()
  // L'indicateur PAR LIGNE (Lot 1) — distinct du bandeau global (Lot 6, qui
  // affiche aussi « À jour » ailleurs sur l'écran).
  await expect(row.getByText('À jour')).toBeVisible()

  // Correction, dans la fenêtre (ADR-007).
  await page.getByRole('link', { name: 'Corriger' }).click()
  await page.getByRole('button', { name: '⌫', exact: true }).click()
  await page.getByRole('button', { name: '⌫', exact: true }).click()
  await page.getByRole('button', { name: '3', exact: true }).click()
  await page.getByRole('button', { name: '0', exact: true }).click()
  await page.getByRole('button', { name: 'Neutre' }).click()
  await page.getByRole('button', { name: 'Voir le récapitulatif' }).click()

  await expect(
    page.getByText(`Dossard 47 — Léa Martin — Voie ${routeNumber} — prise 30`),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Confirmer' }).click()

  await page.getByRole('tab', { name: /Fait/ }).click()
  await expect(page.getByText('prise 30')).toBeVisible()
})
