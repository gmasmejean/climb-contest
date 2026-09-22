import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

import { apiJson, loginApi, openContestRound, registerAndVerifyOrganizer } from './support/api'

// Lot 21 (ADR-078, ADR-079) — « une action de juge ne doit jamais être perdue »,
// y compris quand son accès est révoqué, et quand un autre juge prend le téléphone.
// Projet `mobile` (360 px) : ce sont des écrans de juge, et l'onglet Conflits doit
// rester utilisable sur le téléphone de l'organisateur.

interface Fixture {
  email: string
  password: string
  headers: Record<string, string>
  competitionId: string
  competitionName: string
  publicSlug: string
  categoryId: string
  judges: { id: string; accessToken: string; displayName: string }[]
}

async function setUpFixture(request: APIRequestContext, label: string): Promise<Fixture> {
  const { email, password } = await registerAndVerifyOrganizer(request, label)
  const { headers } = await loginApi(request, email, password)

  const competitionName = `Coupe ${label} ${Date.now()}`
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
        format: 'contest',
        scoringEngineId: 'ffme-difficulty-2026',
        scoringConfig: { routesCounted: 3 },
      },
    },
  )
  const base = `/api/v1/competitions/${competition.id}`
  const category = await apiJson<{ id: string }>(request, `${base}/categories`, {
    method: 'POST',
    headers,
    data: { label: 'Cat e2e', sex: 'X' },
  })
  for (let i = 0; i < 3; i += 1) {
    await apiJson(request, `${base}/competitors`, {
      method: 'POST',
      headers,
      data: { categoryId: category.id, bib: 10 + i, firstName: `Prenom${i}`, lastName: 'Test' },
    })
  }
  const route = await apiJson<{ id: string }>(request, `${base}/routes`, {
    method: 'POST',
    headers,
    data: { number: 1, holdCount: 40, categoryIds: [category.id] },
  })
  const judges = []
  for (const displayName of ['Paul', 'Léa']) {
    const judge = await apiJson<{ id: string; accessToken: string }>(request, `${base}/judges`, {
      method: 'POST',
      headers,
      data: { displayName, routeIds: [route.id] },
    })
    judges.push({ ...judge, displayName })
  }
  await openContestRound(request, headers, base)

  return {
    email,
    password,
    headers,
    competitionId: competition.id,
    competitionName,
    publicSlug: competition.publicSlug,
    categoryId: category.id,
    judges,
  }
}

async function signInAsJudge(page: Page, accessToken: string): Promise<void> {
  await page.goto(`/j/${accessToken}`)
  await page.getByRole('button', { name: 'Commencer' }).click()
  await expect(page).toHaveURL('/j/home')
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
}

/** Note « prise 2x » pour le compétiteur `index`, depuis l'écran de la voie. */
async function enterAscent(page: Page, index: number): Promise<void> {
  await page.getByText(`Prenom${index} Test`).click()
  await page.getByRole('button', { name: '2', exact: true }).click()
  await page.getByRole('button', { name: String(index + 1), exact: true }).click()
  await page.getByRole('button', { name: 'Voir le récapitulatif' }).click()
  await page.getByRole('button', { name: 'Confirmer' }).click()
  await expect(page).toHaveURL(/\/j\/routes\//)
  await expect(page.getByText('Passage enregistré ✓')).toBeHidden()
}

async function rankedRouteResults(request: APIRequestContext, fixture: Fixture): Promise<number> {
  const ranking = await apiJson<{ entries: { rounds: { routes: unknown[] }[] }[] }>(
    request,
    `/api/v1/public/${fixture.publicSlug}/rankings?category=${fixture.categoryId}`,
  )
  return ranking.entries.flatMap((entry) => entry.rounds.flatMap((round) => round.routes)).length
}

test('un juge révoqué pendant qu’il est hors ligne : ses saisies arrivent, l’organisateur les valide', async ({
  page,
  request,
  browser,
}) => {
  const fixture = await setUpFixture(request, 'revoque')
  const [paul] = fixture.judges
  if (!paul) throw new Error('fixture sans juge')

  await signInAsJudge(page, paul.accessToken)
  await page.context().setOffline(true)
  await page.getByText('Voie 1').click()
  for (let i = 0; i < 3; i += 1) await enterAscent(page, i)
  await expect(page.getByTestId('judge-sync-banner')).toContainText('Hors ligne, 3')

  // L'organisateur révoque Paul pendant qu'il est au sous-sol.
  await apiJson(
    request,
    `/api/v1/competitions/${fixture.competitionId}/judges/${paul.id}/revoke`,
    { method: 'POST', headers: fixture.headers },
  )

  await page.context().setOffline(false)

  // Le juge apprend sa révocation, sa file part, puis il est déconnecté.
  await expect(page).toHaveURL('/j/revoked')
  await expect(page.getByRole('heading', { name: 'Votre accès a été révoqué' })).toBeVisible()
  await expect(page.getByTestId('judge-revoked-done')).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('climbcontest.judge.token'))).toBeNull()

  // Il ne peut plus revenir sur un écran de saisie, même en rechargeant.
  await page.goto('/j/home')
  await expect(page).toHaveURL('/j/revoked')

  // Rien n'est entré au classement…
  expect(await rankedRouteResults(request, fixture)).toBe(0)

  // …et l'organisateur retrouve les trois saisies, sur un téléphone de 360 px.
  const organizerContext = await browser.newContext({
    viewport: { width: 360, height: 740 },
    baseURL: test.info().project.use.baseURL,
  })
  const organizer = await organizerContext.newPage()
  await organizer.goto('/login')
  await organizer.getByLabel('E-mail').fill(fixture.email)
  await organizer.getByLabel('Mot de passe').fill(fixture.password)
  await organizer.getByRole('button', { name: 'Se connecter' }).click()
  await expect(organizer).toHaveURL('/competitions')
  await organizer.goto(`/competitions/${fixture.competitionId}/pilotage?section=conflicts`)

  const pending = organizer.getByTestId('conflict-revoked_access')
  await expect(pending).toHaveCount(3)
  await expect(pending.first()).toContainText('Saisie d\'un accès révoqué — à valider')
  await expect(pending.first()).toContainText('Paul')
  // Chaque carte dit de qui et de quelle voie elle parle.
  await expect(pending.first().getByTestId('conflict-subject')).toContainText(/Prenom\d Test — Voie 1/)
  expect(
    await organizer.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true)

  // Accepter la première.
  await pending.first().getByRole('button', { name: 'Accepter' }).click()
  await expect(pending).toHaveCount(2)
  expect(await rankedRouteResults(request, fixture)).toBe(1)

  // Refuser la suivante : le motif est obligatoire.
  await pending.first().getByRole('button', { name: 'Refuser', exact: true }).click()
  const refuse = pending.first().getByRole('button', { name: 'Refuser cette saisie' })
  await expect(refuse).toBeDisabled()
  await pending.first().getByLabel('Motif du refus (obligatoire)').fill('Saisie non fiable')
  await refuse.click()
  await expect(pending).toHaveCount(1)
  expect(await rankedRouteResults(request, fixture)).toBe(1)

  await organizerContext.close()
})

test('ouvrir le lien d’un autre juge ne vide pas une file en attente : elle part d’abord', async ({
  page,
  request,
}) => {
  const fixture = await setUpFixture(request, 'changement')
  const [paul, lea] = fixture.judges
  if (!paul || !lea) throw new Error('fixture sans juges')

  await signInAsJudge(page, paul.accessToken)

  // Le lot de saisies ne passe pas (borne wifi saturée) ; le reste du réseau, si.
  await page.route('**/api/v1/judge/ascents/batch', (route) => route.abort())
  await page.getByText('Voie 1').click()
  await enterAscent(page, 0)

  // Léa prend le téléphone et scanne SON lien.
  await page.goto(`/j/${lea.accessToken}`)
  const unsent = page.getByTestId('judge-access-unsent')
  await expect(unsent).toContainText('encore 1 saisie(s) de Paul')
  await expect(unsent).toContainText('Prenom0 Test')
  await expect(page.getByRole('button', { name: 'Commencer' })).toHaveCount(0)
  expect(await rankedRouteResults(request, fixture)).toBe(0)

  // Le réseau revient : la file de Paul part, avec le jeton de Paul.
  await page.unroute('**/api/v1/judge/ascents/batch')
  await unsent.getByRole('button', { name: 'Réessayer l\'envoi' }).click()

  const confirm = page.getByTestId('judge-access-confirm-switch')
  await expect(confirm).toContainText('connecté en tant que Paul')
  expect(await rankedRouteResults(request, fixture)).toBe(1)

  await confirm.getByRole('button', { name: 'Continuer en tant que Léa' }).click()
  await page.getByRole('button', { name: 'Commencer' }).click()
  await expect(page).toHaveURL('/j/home')
  // La saisie de Paul est au serveur, et l'écran de Léa la voit comme faite.
  await page.getByText('Voie 1').click()
  await page.getByRole('tab', { name: /Fait/ }).click()
  await expect(page.getByText('Prenom0 Test')).toBeVisible()
})
