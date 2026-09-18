import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

// Lot 6, plan de test : deux « appareils » (deux contextes de navigateur,
// même juge — un secours à deux tablettes, cas réaliste) saisissent des
// valeurs différentes pour le même passage pendant qu'ils sont tous deux hors
// ligne, puis se resynchronisent en même temps → cas SPEC.md § 9 #22 : les
// deux valeurs sont conservées, un `conflict_group` commun, l'appareil
// perdant affiche un avertissement avec les deux valeurs.

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

  const competition = await apiJson<{ id: string }>(request, '/api/v1/competitions', {
    method: 'POST',
    headers: authHeaders,
    data: {
      name: `Coupe conflit e2e ${Date.now()}`,
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
      data: { displayName: 'Juge conflit e2e', routeIds: [route.id] },
    },
  )

  await apiJson(request, `/api/v1/competitions/${competition.id}/status`, {
    method: 'POST',
    headers: authHeaders,
    data: { status: 'running' },
  })

  return { judgeToken: judge.accessToken, routeNumber: route.number }
}

async function signInAsJudge(page: Page, judgeToken: string): Promise<void> {
  // Bootstrap EN LIGNE (SPEC.md § 6.3), avant toute coupure.
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

test('deux appareils hors ligne saisissent des valeurs différentes pour le même passage : les deux sont conservées, un conflit est signalé', async ({
  browser,
  request,
}) => {
  const { judgeToken, routeNumber } = await setUpFixture(request)

  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  const pageA = await contextA.newPage()
  const pageB = await contextB.newPage()

  await signInAsJudge(pageA, judgeToken)
  await signInAsJudge(pageB, judgeToken)

  await contextA.setOffline(true)
  await contextB.setOffline(true)

  await recordAscent(pageA, routeNumber, 20)
  await recordAscent(pageB, routeNumber, 28)

  await expect(pageA.getByTestId('judge-sync-banner')).toContainText('Hors ligne')
  await expect(pageB.getByTestId('judge-sync-banner')).toContainText('Hors ligne')

  await contextA.setOffline(false)
  await contextB.setOffline(false)

  // Chaque appareil finit par se stabiliser (accepted OU conflict — les deux
  // sont des états terminaux pour la file, donc « À jour » dans les deux cas :
  // un `conflict` n'est plus `pending`/`sending`).
  await expect(pageA.getByTestId('judge-sync-banner')).toContainText('À jour', { timeout: 30_000 })
  await expect(pageB.getByTestId('judge-sync-banner')).toContainText('À jour', { timeout: 30_000 })

  await pageA.reload()
  await pageB.reload()
  await pageA.getByRole('tab', { name: /Fait/ }).click()
  await pageB.getByRole('tab', { name: /Fait/ }).click()

  // `isVisible()` seul est un instantané, sans le nouvel essai automatique de
  // Playwright — la lecture Dexie qui suit le rechargement peut ne pas
  // encore avoir atteint le rendu au moment exact de l'appel.
  async function hasConflict(page: Page): Promise<boolean> {
    try {
      await expect(page.getByText('Conflit')).toBeVisible({ timeout: 5000 })
      return true
    } catch {
      return false
    }
  }
  const conflictTextA = await hasConflict(pageA)
  const conflictTextB = await hasConflict(pageB)

  // Exactement un des deux appareils "perd" la course et voit le conflit —
  // celui qui l'a détecté côté serveur (le second des deux lots traités).
  expect([conflictTextA, conflictTextB].filter(Boolean)).toHaveLength(1)

  // SPEC.md § 6.3 : « l'affiche au juge avec les deux valeurs » — les deux
  // hauteurs doivent apparaître ensemble dans le message de conflit.
  const loserPage = conflictTextA ? pageA : pageB
  const conflictMessage = loserPage.getByText('Vous avez saisi :')
  await expect(conflictMessage).toBeVisible()
  await expect(conflictMessage).toContainText('prise 20')
  await expect(conflictMessage).toContainText('prise 28')

  await contextA.close()
  await contextB.close()
})
