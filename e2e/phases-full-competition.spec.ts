import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const MAILPIT_URL = process.env['E2E_MAILPIT_URL'] ?? 'http://localhost:8025'

// Lot 9 (ROADMAP.md, point 1) : une compétition au format phases jouée de bout
// en bout — qualification à deux voies, calcul des qualifiés, bascule vers la
// demi-finale puis la finale, classement final avec contre-performance.
//
// Six compétiteurs (dossards 1 à 6), une catégorie :
//   qualification (voies 1 et 2, 4 qualifiés) → demi-finale (voie 3, 2 qualifiés)
//   → finale (voie 4).
// Les saisies passent par l'API juge (lot de passages) ; l'organisateur pilote
// les tours depuis l'interface, et un juge réel (navigateur) vérifie ce qu'il
// voit sur son téléphone, dont l'actualisation à l'ouverture d'un tour
// (DECISIONS.md ADR-055).

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
  const stamp = Date.now()
  const email = `e2e-phases-${stamp}@example.com`
  const password = 'un-mot-de-passe-solide'
  await apiJson(request, '/api/v1/auth/register', {
    method: 'POST',
    data: { email, password, displayName: 'Phases E2E', clubName: `Club phases ${stamp}` },
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

const BIBS = [1, 2, 3, 4, 5, 6] as const
type Bib = (typeof BIBS)[number]

async function setUpFixture(request: APIRequestContext, accessToken: string) {
  const headers = { authorization: `Bearer ${accessToken}` }
  const competitionName = `Coupe phases e2e ${Date.now()}`
  const competition = await apiJson<{ id: string; publicSlug: string }>(
    request,
    '/api/v1/competitions',
    {
      method: 'POST',
      headers,
      data: {
        name: competitionName,
        venue: 'Salle e2e',
        startsOn: '2099-01-01',
        endsOn: '2099-01-01',
        format: 'phases',
        scoringEngineId: 'ffme-difficulty-2026',
        scoringConfig: { routesCounted: 1 },
      },
    },
  )
  const base = `/api/v1/competitions/${competition.id}`

  const category = await apiJson<{ id: string }>(request, `${base}/categories`, {
    method: 'POST',
    headers,
    data: { label: 'Cat phases e2e', sex: 'X' },
  })

  const competitors = new Map<Bib, string>()
  for (const bib of BIBS) {
    const created = await apiJson<{ id: string }>(request, `${base}/competitors`, {
      method: 'POST',
      headers,
      data: { categoryId: category.id, bib, firstName: `Prénom${bib}`, lastName: `Nom${bib}` },
    })
    competitors.set(bib, created.id)
  }

  const routes = new Map<number, string>()
  for (const number of [1, 2, 3, 4]) {
    const created = await apiJson<{ id: string }>(request, `${base}/routes`, {
      method: 'POST',
      headers,
      data: { number, holdCount: 40, categoryIds: [] },
    })
    await apiJson(request, `${base}/routes/${created.id}`, {
      method: 'PATCH',
      headers,
      data: { categoryIds: [category.id] },
    })
    routes.set(number, created.id)
  }

  async function createRound(
    type: 'qualification' | 'semifinal' | 'final',
    qualifyingCount: number | null,
    routeNumbers: number[],
  ) {
    const created = await apiJson<{ id: string }>(request, `${base}/rounds`, {
      method: 'POST',
      headers,
      data: { type, style: 'onsight', qualifyingCount },
    })
    await apiJson(request, `${base}/rounds/${created.id}/routes`, {
      method: 'PUT',
      headers,
      data: {
        assignments: routeNumbers.map((n) => ({ routeId: routes.get(n)!, categoryId: category.id })),
      },
    })
    return created.id
  }
  const qualificationId = await createRound('qualification', 4, [1, 2])
  const semifinalId = await createRound('semifinal', 2, [3])
  const finalId = await createRound('final', null, [4])

  const judge = await apiJson<{ accessToken: string }>(request, `${base}/judges`, {
    method: 'POST',
    headers,
    data: { displayName: 'Juge phases e2e', routeIds: [...routes.values()] },
  })
  const judgeAuth = await apiJson<{ token: string }>(request, '/api/v1/judge/auth', {
    method: 'POST',
    data: { token: judge.accessToken },
  })

  return {
    competitionName,
    publicSlug: competition.publicSlug,
    judgeToken: judge.accessToken,
    judgeJwt: judgeAuth.token,
    competitors,
    routes,
    qualificationId,
    semifinalId,
    finalId,
  }
}

type Fixture = Awaited<ReturnType<typeof setUpFixture>>

/** Saisit une prise par compétiteur sur une voie, par lot, via l'API juge. */
async function enterHolds(
  request: APIRequestContext,
  fixture: Fixture,
  roundId: string,
  routeNumber: number,
  holdsByBib: Partial<Record<Bib, number>>,
) {
  const items = Object.entries(holdsByBib).map(([bib, holdNumber]) => ({
    kind: 'create' as const,
    id: crypto.randomUUID(),
    roundId,
    routeId: fixture.routes.get(routeNumber)!,
    competitorId: fixture.competitors.get(Number(bib) as Bib)!,
    holdNumber,
    modifier: 'none' as const,
    isTop: false,
    status: 'valid' as const,
    climbTimeMs: null,
    recordedAt: new Date().toISOString(),
    deviceId: 'device-e2e',
  }))
  const response = await apiJson<{ results: { status: string; reason?: string }[] }>(
    request,
    '/api/v1/judge/ascents/batch',
    { method: 'POST', headers: { authorization: `Bearer ${fixture.judgeJwt}` }, data: { items } },
  )
  for (const result of response.results) {
    expect(result.status, result.reason).toBe('accepted')
  }
}

// Correspondance EXACTE sur le libellé : `hasText: 'Finale'` est une recherche
// de sous-chaîne insensible à la casse et trouverait aussi « Demi-finale ».
function roundCard(page: Page, label: string) {
  return page
    .getByRole('listitem')
    .filter({ has: page.getByText(label, { exact: true }) })
    .first()
}

async function changeRound(page: Page, label: string, action: string, expectedBadge: string) {
  const card = roundCard(page, label)
  await card.getByRole('button', { name: action, exact: true }).click()
  await expect(card.getByText(expectedBadge, { exact: true })).toBeVisible()
}

test('une compétition en phases jouée de bout en bout, classement final avec contre-performance', async ({
  page,
  browser,
  request,
}) => {
  test.setTimeout(180_000)

  const { email, password } = await registerAndVerifyOrganizer(request)
  const { accessToken } = await apiJson<{ accessToken: string }>(request, '/api/v1/auth/login', {
    method: 'POST',
    data: { email, password },
  })
  const fixture = await setUpFixture(request, accessToken)

  // --- L'organisateur ouvre l'onglet Pilotage → Tours ---
  await page.goto('/login')
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Mot de passe').fill(password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page).toHaveURL('/')
  await page.getByRole('link', { name: 'Mes compétitions' }).click()
  await page.getByText(fixture.competitionName).click()
  await page.getByRole('tab', { name: 'Pilotage' }).click()
  await page.getByTestId('pilotage-sections').getByRole('tab', { name: 'Tours' }).click()

  // --- Un juge réel se connecte pendant la qualification ---
  const judgeContext = await browser.newContext()
  const judgePage = await judgeContext.newPage()

  // Garde-fou : on ne peut pas ouvrir la demi-finale avant la qualification.
  await roundCard(page, 'Demi-finale').getByRole('button', { name: 'Ouvrir', exact: true }).click()
  await expect(page.getByText('Fermez d’abord « Qualification »')).toBeVisible()

  // --- Qualification : deux voies ---
  await changeRound(page, 'Qualification', 'Ouvrir', 'Ouvert')

  await judgePage.goto(`/j/${fixture.judgeToken}`)
  await judgePage.getByRole('button', { name: 'Commencer' }).click()
  await expect(judgePage).toHaveURL('/j/home')
  // La demi-finale n'est pas ouverte : sa voie n'a aucun tour.
  await expect(judgePage.getByRole('link', { name: /Voie 3.*Aucun tour ouvert/ })).toBeVisible()

  // Voie 1 : 1 > 2 > 3 > 4 > 5 > 6. Voie 2 : 1 > 2 > 4 > 3 > 5 > 6.
  // Rangs combinés (moyenne géométrique) : 1 → 1, 2 → 2, 3 et 4 ex aequo → 3, 5, 6.
  await enterHolds(request, fixture, fixture.qualificationId, 1, { 1: 30, 2: 28, 3: 26, 4: 24, 5: 12, 6: 10 })
  await enterHolds(request, fixture, fixture.qualificationId, 2, { 1: 29, 2: 27, 4: 25, 3: 23, 5: 11, 6: 9 })
  await changeRound(page, 'Qualification', 'Fermer', 'Fermé')

  // --- Demi-finale : les 4 premiers sont figés à l'ouverture ---
  await changeRound(page, 'Demi-finale', 'Ouvrir', 'Ouvert')
  const semifinalQualifiers = page.getByTestId(`round-qualifiers-${fixture.semifinalId}`)
  await expect(semifinalQualifiers.getByText('4 qualifiés')).toBeVisible()
  await semifinalQualifiers.getByText('Cat phases e2e').click()
  await expect(semifinalQualifiers.getByText('Prénom4 Nom4')).toBeVisible()
  await expect(semifinalQualifiers.getByText('Prénom5 Nom5')).toHaveCount(0)
  await expect(semifinalQualifiers.getByText('Prénom6 Nom6')).toHaveCount(0)

  // Le juge, déjà connecté, actualise ses voies (ADR-055) et ne voit que les qualifiés.
  await judgePage.getByRole('button', { name: 'Actualiser mes voies' }).click()
  await expect(judgePage.getByText('Vos voies sont à jour.')).toBeVisible()
  await judgePage.getByText('Voie 3').click()
  await expect(judgePage).toHaveURL(/\/j\/routes\//)
  for (const bib of [1, 2, 3, 4]) {
    await expect(judgePage.getByText(new RegExp(`Dossard ${bib} —`))).toBeVisible()
  }
  await expect(judgePage.getByText(/Dossard 5 —/)).toHaveCount(0)
  await expect(judgePage.getByText(/Dossard 6 —/)).toHaveCount(0)

  // Demi-finale : 3 devant 2 devant 1 devant 4 → 2 qualifiés, dans cet ordre.
  await enterHolds(request, fixture, fixture.semifinalId, 3, { 1: 20, 2: 25, 3: 30, 4: 10 })
  await changeRound(page, 'Demi-finale', 'Fermer', 'Fermé')

  // --- Finale : 3 et 2 seulement ---
  await changeRound(page, 'Finale', 'Ouvrir', 'Ouvert')
  const finalQualifiers = page.getByTestId(`round-qualifiers-${fixture.finalId}`)
  await expect(finalQualifiers.getByText('2 qualifiés')).toBeVisible()

  // Les deux finalistes font la même prise : c'est la contre-performance
  // (classement de la demi-finale) qui les départage — 3 avant 2, alors que
  // le dossard 2 précède le 3.
  await enterHolds(request, fixture, fixture.finalId, 4, { 2: 35, 3: 35 })
  await changeRound(page, 'Finale', 'Fermer', 'Fermé')

  // --- Publication des trois tours ---
  for (const label of ['Qualification', 'Demi-finale', 'Finale']) {
    await roundCard(page, label)
      .getByRole('button', { name: 'Publier les résultats', exact: true })
      .click()
    await expect(roundCard(page, label).getByText('Publié', { exact: true })).toBeVisible()
  }

  // --- Le public voit le classement final, non provisoire ---
  const publicContext = await browser.newContext()
  const publicPage = await publicContext.newPage()
  await publicPage.goto(`/c/${fixture.publicSlug}`)
  await expect(publicPage.getByText('provisoire', { exact: false })).toHaveCount(0)

  // Finalistes (contre-performance), puis demi-finalistes éliminés, puis la
  // qualification seule : 3, 2, 1, 4, 5, 6.
  const rows = publicPage.getByRole('listitem').filter({ hasText: /Prénom\d Nom\d/ })
  await expect(rows).toHaveCount(6)
  const names = await rows.evaluateAll((elements) =>
    elements.map((element) => /Prénom(\d) Nom\d/.exec(element.textContent ?? '')?.[1]),
  )
  expect(names).toEqual(['3', '2', '1', '4', '5', '6'])

  await judgeContext.close()
  await publicContext.close()
})
