import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { openContestRound } from './support/api'

// Lot 7, plan de test (CLAUDE.md « parcours critiques en end-to-end » : « le
// classement public se met à jour en direct ») : un juge note un passage,
// et un second onglet — la page publique, sans authentification — voit le
// classement se mettre à jour SANS rechargement, porté par le flux SSE.

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

async function setUpFixture(request: APIRequestContext) {
  const { accessToken } = await apiJson<{ accessToken: string }>(request, '/api/v1/auth/login', {
    method: 'POST',
    data: { email: ORGANIZER_EMAIL, password: ORGANIZER_PASSWORD },
  })
  const authHeaders = { authorization: `Bearer ${accessToken}` }

  const competition = await apiJson<{ id: string; publicSlug: string }>(
    request,
    '/api/v1/competitions',
    {
      method: 'POST',
      headers: authHeaders,
      data: {
        name: `Coupe classement public e2e ${Date.now()}`,
        venue: 'Salle e2e',
        startsOn: '2099-01-01',
        endsOn: '2099-01-01',
        format: 'contest',
        scoringEngineId: 'ffme-difficulty-2026',
        scoringConfig: { routesCounted: 3 },
      },
    },
  )

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
      data: { displayName: 'Juge classement public e2e', routeIds: [route.id] },
    },
  )

  await openContestRound(request, authHeaders, `/api/v1/competitions/${competition.id}`)

  return { slug: competition.publicSlug, judgeToken: judge.accessToken, routeNumber: route.number }
}

async function signInAsJudge(page: Page, judgeToken: string): Promise<void> {
  await page.goto(`/j/${judgeToken}`)
  await page.getByRole('button', { name: 'Commencer' }).click()
  await expect(page).toHaveURL('/j/home')
}

async function recordAscent(page: Page, routeNumber: number, holdNumber: number): Promise<void> {
  await page.getByText(`Voie ${routeNumber}`).click()
  await expect(page).toHaveURL(/\/j\/routes\//)
  await page.getByText('Dossard 47 — Léa Martin').click()
  const tens = String(holdNumber).charAt(0)
  const units = String(holdNumber).charAt(1)
  await page.getByRole('button', { name: tens, exact: true }).click()
  await page.getByRole('button', { name: units, exact: true }).click()
  await page.getByRole('button', { name: 'Voir le récapitulatif' }).click()
  await page.getByRole('button', { name: 'Confirmer' }).click()
  await expect(page).toHaveURL(/\/j\/routes\//)
}

test('un passage noté par le juge apparaît en direct dans le classement public, sans rechargement', async ({
  browser,
  request,
}) => {
  const { slug, judgeToken, routeNumber } = await setUpFixture(request)

  const judgeContext = await browser.newContext()
  const publicContext = await browser.newContext()
  const judgePage = await judgeContext.newPage()
  const publicPage = await publicContext.newPage()

  await signInAsJudge(judgePage, judgeToken)

  await publicPage.goto(`/c/${slug}`)
  await expect(publicPage.getByRole('heading', { name: /Coupe classement public e2e/ })).toBeVisible()
  // Un compétiteur inscrit mais qui n'a pas encore grimpé n'apparaît pas
  // (format contest, aucune synthèse DNS — voir lib/public-ranking.ts).
  await expect(publicPage.getByText('Léa Martin')).toHaveCount(0)

  await recordAscent(judgePage, routeNumber, 25)

  // Aucun `publicPage.reload()` ici : c'est le flux SSE qui doit porter la
  // mise à jour jusqu'à cet onglet, resté ouvert depuis avant la saisie.
  await expect(publicPage.getByText('Léa Martin')).toBeVisible({ timeout: 15_000 })
  // Le détail par voie est dans un `<details>` fermé par défaut (ROADMAP.md
  // Lot 7 : « dépliable ») : il faut le déplier pour que « prise 25 » soit
  // visible au sens de Playwright.
  await publicPage.getByText('Léa Martin').click()
  await expect(publicPage.getByText('prise 25')).toBeVisible()

  await judgeContext.close()
  await publicContext.close()
})
