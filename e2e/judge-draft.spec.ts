import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

import { apiJson, openContestRound } from './support/api'

// ROADMAP.md Lot 10, ADR-061 : la saisie qu'un juge a composée mais pas encore
// confirmée survit à un rechargement de page — celui d'une mise à jour de
// l'appli, ou d'un geste malheureux. En émulation mobile 360 px (voir
// playwright.config.ts, projet `mobile`), comme le parcours juge du Lot 5.

const ORGANIZER_EMAIL = 'organisateur@club-demo.test'
const ORGANIZER_PASSWORD = 'ChangeMoi123!'
const DRAFT_KEY = 'climbcontest.judge.ascentDraft'
const RESTORED_MESSAGE = 'Saisie retrouvée : vérifiez-la avant de valider.'

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
      name: `Coupe brouillon e2e ${Date.now()}`,
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
  await openContestRound(request, authHeaders, `/api/v1/competitions/${competition.id}`)
  return { judgeToken: judge.accessToken, routeNumber: route.number }
}

/** Ouvre l'écran de saisie de Léa Martin, juge connecté. */
async function openEntryScreen(page: Page, request: APIRequestContext) {
  const { judgeToken, routeNumber } = await setUpJudgeFixture(request)
  await page.goto(`/j/${judgeToken}`)
  await page.getByRole('button', { name: 'Commencer' }).click()
  await expect(page).toHaveURL('/j/home')
  await page.getByText(`Voie ${routeNumber}`).click()
  await page.getByText('Dossard 47 — Léa Martin').click()
  await expect(page.getByRole('button', { name: 'Voir le récapitulatif' })).toBeVisible()
  return { routeNumber }
}

async function typeHold25Plus(page: Page) {
  await page.getByRole('button', { name: '2', exact: true }).click()
  await page.getByRole('button', { name: '5', exact: true }).click()
  await page.getByRole('button', { name: '+', exact: true }).click()
}

test('une saisie pas encore confirmée survit à un rechargement, puis se confirme', async ({
  page,
  request,
}) => {
  const { routeNumber } = await openEntryScreen(page, request)
  await typeHold25Plus(page)

  await page.reload()

  // Retour à l'étape de saisie (pas au récapitulatif), avec un message.
  await expect(page.getByText(RESTORED_MESSAGE)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Voir le récapitulatif' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Confirmer' })).toHaveCount(0)

  // Le juge revoit ses valeurs et confirme lui-même.
  await page.getByRole('button', { name: 'Voir le récapitulatif' }).click()
  await expect(
    page.getByText(`Dossard 47 — Léa Martin — Voie ${routeNumber} — prise 25+`),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Confirmer' }).click()

  await expect(page).toHaveURL(/\/j\/routes\//)
  await page.getByRole('tab', { name: /Fait/ }).click()
  const row = page.getByRole('listitem').filter({ hasText: 'Dossard 47 — Léa Martin' })
  await expect(row.getByText('prise 25+')).toBeVisible()

  // Une fois la saisie durable, plus de brouillon.
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), DRAFT_KEY)).toBeNull()
})

test('un brouillon de plus de 10 minutes n’est pas restauré', async ({ page, request }) => {
  await openEntryScreen(page, request)
  await typeHold25Plus(page)

  // Vieillit le brouillon de 11 minutes, comme si le juge avait quitté l'écran.
  await page.evaluate((key) => {
    const raw = localStorage.getItem(key)
    if (raw === null) throw new Error('Aucun brouillon écrit après la saisie.')
    const draft = JSON.parse(raw) as { savedAt: number }
    draft.savedAt -= 11 * 60 * 1000
    localStorage.setItem(key, JSON.stringify(draft))
  }, DRAFT_KEY)

  await page.reload()

  await expect(page.getByRole('button', { name: 'Voir le récapitulatif' })).toBeVisible()
  await expect(page.getByText(RESTORED_MESSAGE)).toHaveCount(0)
  await page.getByRole('button', { name: 'Voir le récapitulatif' }).click()
  await expect(page.getByText('Indiquez la prise atteinte')).toBeVisible()
  expect(await page.evaluate((key) => localStorage.getItem(key), DRAFT_KEY)).toBeNull()
})
