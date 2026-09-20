import { expect, test, type Locator, type Page } from '@playwright/test'

import { apiJson, loginApi, registerAndVerifyOrganizer } from './support/api'

// Lot 12 (ADR-065) : le statut d'un tour se porte par catégorie. Les U16 passent
// le matin, les U18 l'après-midi : l'organisateur ouvre et ferme chaque catégorie
// séparément depuis le pilotage. Tourne aussi à 360 px (projet `mobile`).

async function setUp(request: Parameters<typeof apiJson>[0], accessToken: string) {
  const headers = { authorization: `Bearer ${accessToken}` }
  const name = `Coupe par catégorie e2e ${Date.now()}`
  const competition = await apiJson<{ id: string }>(request, '/api/v1/competitions', {
    method: 'POST',
    headers,
    data: {
      name,
      venue: 'Salle e2e',
      startsOn: '2099-01-01',
      endsOn: '2099-01-01',
      format: 'phases',
      scoringEngineId: 'ffme-difficulty-2026',
      scoringConfig: { routesCounted: 1 },
    },
  })
  const base = `/api/v1/competitions/${competition.id}`
  const post = <T>(path: string, data: unknown, method = 'POST') =>
    apiJson<T>(request, `${base}${path}`, { method, headers, data })

  const u16 = await post<{ id: string }>('/categories', { label: 'U16', sex: 'X' })
  const u18 = await post<{ id: string }>('/categories', { label: 'U18', sex: 'X' })
  const routeIds: string[] = []
  for (const number of [1, 2]) {
    const route = await post<{ id: string }>('/routes', { number, holdCount: 40, categoryIds: [] })
    await post(`/routes/${route.id}`, { categoryIds: [u16.id, u18.id] }, 'PATCH')
    routeIds.push(route.id)
  }
  const qualification = await post<{ id: string }>('/rounds', {
    type: 'qualification',
    style: 'onsight',
    qualifyingCount: 2,
  })
  const semifinal = await post<{ id: string }>('/rounds', { type: 'semifinal', style: 'onsight' })
  for (const [round, routeId] of [
    [qualification.id, routeIds[0]],
    [semifinal.id, routeIds[1]],
  ] as const) {
    await post(
      `/rounds/${round}/routes`,
      {
        assignments: [
          { routeId, categoryId: u16.id },
          { routeId, categoryId: u18.id },
        ],
      },
      'PUT',
    )
  }
  return { name }
}

// Correspondance EXACTE : `hasText: 'Finale'` trouverait aussi « Demi-finale ».
function roundCard(page: Page, label: string): Locator {
  return page
    .getByRole('listitem')
    .filter({ has: page.getByText(label, { exact: true }) })
    .first()
}

function categoryRow(card: Locator, label: string): Locator {
  return card.getByRole('listitem').filter({ hasText: label })
}

test('les U16 ouvrent, ferment et passent en demi-finale pendant que les U18 attendent', async ({
  page,
  request,
}) => {
  const { email, password } = await registerAndVerifyOrganizer(request, 'par-categorie')
  const { accessToken } = await loginApi(request, email, password)
  const { name } = await setUp(request, accessToken)

  await page.goto('/login')
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Mot de passe').fill(password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page).toHaveURL('/')
  await page.getByRole('link', { name: 'Mes compétitions' }).click()
  await page.getByText(name).click()
  await page.getByRole('tab', { name: 'Pilotage' }).click()
  await page.getByTestId('pilotage-sections').getByRole('tab', { name: 'Tours' }).click()

  const qualification = roundCard(page, 'Qualification')
  const semifinal = roundCard(page, 'Demi-finale')

  // Au départ, chaque catégorie est en brouillon, tour par tour.
  await expect(categoryRow(qualification, 'U16').getByText('Brouillon')).toBeVisible()
  await expect(categoryRow(qualification, 'U18').getByText('Brouillon')).toBeVisible()

  // Matin : seuls les U16 ouvrent la qualification.
  await qualification.getByRole('button', { name: 'Ouvrir — U16', exact: true }).click()
  await expect(categoryRow(qualification, 'U16').getByText('Ouvert', { exact: true })).toBeVisible()
  await expect(categoryRow(qualification, 'U18').getByText('Brouillon')).toBeVisible()

  // Ouvrir une catégorie a fait démarrer la compétition ; on ne peut plus la clôturer
  // tant qu'une catégorie est ouverte, et le message dit quoi faire.
  await page.getByRole('tab', { name: 'Infos' }).click()
  // « En cours » est aussi une option du sélecteur : on vise le badge de statut.
  await expect(page.locator('span').filter({ hasText: /^En cours$/ })).toBeVisible()
  await page.getByLabel('Changer le statut').selectOption('closed')
  await page.getByRole('button', { name: 'Appliquer' }).click()
  await expect(page.getByText('Fermez d’abord les catégories ouvertes')).toBeVisible()

  // Fin de matinée : les U16 ferment, leur demi-finale s'ouvre — pas celle des U18.
  await page.getByRole('tab', { name: 'Pilotage' }).click()
  await page.getByTestId('pilotage-sections').getByRole('tab', { name: 'Tours' }).click()
  await qualification.getByRole('button', { name: 'Fermer — U16', exact: true }).click()
  await expect(categoryRow(qualification, 'U16').getByText('Fermé', { exact: true })).toBeVisible()

  await semifinal.getByRole('button', { name: 'Ouvrir — U18', exact: true }).click()
  await expect(page.getByText('Fermez d’abord « Qualification »')).toBeVisible()
  await expect(categoryRow(semifinal, 'U18').getByText('Brouillon')).toBeVisible()

  await semifinal.getByRole('button', { name: 'Ouvrir — U16', exact: true }).click()
  await expect(categoryRow(semifinal, 'U16').getByText('Ouvert', { exact: true })).toBeVisible()

  // Après-midi : les U18 ouvrent leur qualification alors que la demi-finale des U16 est en cours.
  await qualification.getByRole('button', { name: 'Ouvrir — U18', exact: true }).click()
  await expect(categoryRow(qualification, 'U18').getByText('Ouvert', { exact: true })).toBeVisible()
  await expect(categoryRow(qualification, 'U16').getByText('Fermé', { exact: true })).toBeVisible()
  await expect(categoryRow(semifinal, 'U16').getByText('Ouvert', { exact: true })).toBeVisible()

  // Règle des 360 px (CLAUDE.md) : pas de défilement horizontal, cibles tactiles >= 48 px.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
  for (const button of await qualification.getByRole('button').all()) {
    const box = await button.boundingBox()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(48)
  }
})
