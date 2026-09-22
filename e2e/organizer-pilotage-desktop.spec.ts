import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

import { FINE_TARGET, noHorizontalScroll, tooSmall } from './support/a11y'
import { apiJson, loginApi, registerAndVerifyOrganizer } from './support/api'

/**
 * Lot 20 (ROADMAP.md) : le pilotage jour J sur un portable. Poste de pilotage
 * multi-panneaux, matrice compétiteurs × voies, pastille de la barre latérale
 * et avancement dans l'en-tête — puis retour sous 1024 px, où le rendu du
 * Lot 8 doit revenir intact (ADR-072 point 1).
 */
test.skip(
  ({ isMobile }) => isMobile === true,
  'Parcours de bureau : le projet mobile a sa propre garde des 48 px.',
)

interface Fixture {
  competitionName: string
  competitorNames: [string, string]
}

async function setUpFixture(
  request: APIRequestContext,
  headers: Record<string, string>,
): Promise<Fixture> {
  const stamp = Date.now()
  const competitionName = `Coupe grand écran ${stamp}`
  const competition = await apiJson<{ id: string }>(request, '/api/v1/competitions', {
    method: 'POST',
    headers,
    data: {
      name: competitionName,
      venue: 'Salle e2e',
      startsOn: '2099-01-01',
      endsOn: '2099-01-01',
      format: 'contest',
      scoringEngineId: 'ffme-difficulty-2026',
      scoringConfig: { routesCounted: 2 },
    },
  })
  const base = `/api/v1/competitions/${competition.id}`

  const category = await apiJson<{ id: string }>(request, `${base}/categories`, {
    method: 'POST',
    headers,
    data: { label: 'Cat grand écran', sex: 'X' },
  })

  const competitors: { id: string }[] = []
  for (const [bib, firstName, lastName] of [
    [11, 'Camille', 'Dupuis'],
    [12, 'Noé', 'Durand'],
  ] as const) {
    competitors.push(
      await apiJson<{ id: string }>(request, `${base}/competitors`, {
        method: 'POST',
        headers,
        data: { categoryId: category.id, bib, firstName, lastName },
      }),
    )
  }

  const routes: { id: string }[] = []
  for (const number of [1, 2]) {
    routes.push(
      await apiJson<{ id: string }>(request, `${base}/routes`, {
        method: 'POST',
        headers,
        data: { number, holdCount: 40, categoryIds: [category.id] },
      }),
    )
  }

  const judge = await apiJson<{ accessToken: string }>(request, `${base}/judges`, {
    method: 'POST',
    headers,
    data: { displayName: 'Juge grand écran', routeIds: routes.map((r) => r.id) },
  })

  // Le tour implicite du contest (ADR-023) : son identifiant se lit sur le
  // tableau de bord, il n'est pas exposé ailleurs.
  const dashboard = await apiJson<{
    categories: { routes: { roundId: string | null }[] }[]
  }>(request, `${base}/dashboard`, { headers })
  const roundId = dashboard.categories[0]?.routes[0]?.roundId
  if (!roundId) throw new Error('Aucun tour à ouvrir.')
  await apiJson(request, `${base}/round-status/${roundId}`, {
    method: 'POST',
    headers,
    data: { status: 'open', categoryIds: [category.id] },
  })

  const judgeAuth = await apiJson<{ token: string }>(request, '/api/v1/judge/auth', {
    method: 'POST',
    data: { token: judge.accessToken },
  })
  const judgeHeaders = { authorization: `Bearer ${judgeAuth.token}` }
  const now = new Date().toISOString()
  const item = (competitorId: string, routeId: string, holdNumber: number, deviceId: string) => ({
    kind: 'create',
    id: crypto.randomUUID(),
    roundId,
    routeId,
    competitorId,
    holdNumber,
    modifier: 'none',
    isTop: false,
    status: 'valid',
    climbTimeMs: null,
    recordedAt: now,
    deviceId,
  })
  await apiJson(request, '/api/v1/judge/ascents/batch', {
    method: 'POST',
    headers: judgeHeaders,
    data: {
      items: [
        // Camille a grimpé la voie 1 ; sa voie 2 reste vide.
        item(competitors[0]!.id, routes[0]!.id, 22, 'device-A'),
        // Noé a deux valeurs contradictoires sur la voie 1 : un conflit.
        item(competitors[1]!.id, routes[0]!.id, 18, 'device-A'),
        item(competitors[1]!.id, routes[0]!.id, 26, 'device-B'),
      ],
    },
  })

  return { competitionName, competitorNames: ['Camille', 'Noé'] }
}

/** Le rail de droite commence-t-il après la colonne principale ? Mesuré, pas décrété. */
async function railIsBeside(page: Page): Promise<boolean> {
  return page.getByTestId('pilotage-overview').evaluate((element) => {
    const rail = element.querySelector('[data-testid="panel-conflicts"]')
    const main = element.firstElementChild
    if (!(rail instanceof HTMLElement) || !(main instanceof HTMLElement)) return false
    return rail.getBoundingClientRect().left >= main.getBoundingClientRect().right
  })
}

async function openPilotage(page: Page, competitionName: string): Promise<void> {
  await page.getByText(competitionName).click()
  await expect(page).toHaveURL(/\/competitions\//)
  await page.getByRole('tab', { name: 'Pilotage' }).click()
}

test('le pilotage jour J tient sur un portable, et redevient celui du Lot 8 sous 1024 px', async ({
  page,
  request,
}) => {
  const { email, password } = await registerAndVerifyOrganizer(request, 'pilotage-desktop')
  const { headers } = await loginApi(request, email, password)
  const { competitionName } = await setUpFixture(request, headers)

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/login')
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Mot de passe').fill(password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page).toHaveURL('/competitions')

  await openPilotage(page, competitionName)

  // --- Pastille de la barre latérale et avancement dans l'en-tête ---------
  // Un conflit non résolu passe devant les alertes : il retient une publication.
  await expect(page.getByRole('tab', { name: /Pilotage, 1 conflit/ })).toBeVisible()
  // Quatre passages attendus (2 compétiteurs × 2 voies), un seul compte : le
  // conflit de Noé est hors classement tant qu'il n'est pas tranché.
  await expect(page.getByTestId('competition-progress')).toHaveText('1 / 4 passages')

  // --- Le poste de pilotage : panneaux côte à côte ------------------------
  const overview = page.getByTestId('pilotage-overview')
  await expect(overview).toBeVisible()
  await expect(page.getByTestId('panel-conflicts')).toBeVisible()
  await expect(page.getByTestId('panel-judges')).toBeVisible()
  await expect(page.getByTestId('panel-activity')).toBeVisible()
  expect(await railIsBeside(page)).toBe(true)

  // La progression est une barre, pas seulement un texte.
  await expect(overview.getByRole('progressbar').first()).toBeVisible()

  // Le panneau Conflits nomme qui est concerné, et y mène.
  await expect(page.getByTestId('panel-conflicts')).toContainText('Noé Durand')
  await page.getByTestId('panel-conflicts').getByRole('button', { name: 'Trancher' }).click()
  await expect(page).toHaveURL(/section=conflicts/)
  await expect(page.getByTestId('conflict-difference')).toContainText('la prise')

  // --- La matrice compétiteurs × voies -----------------------------------
  const pilotageSections = page.getByTestId('pilotage-sections')
  await pilotageSections.getByRole('tab', { name: 'Voies' }).click()
  const matrix = page.getByTestId('ascent-matrix')
  await expect(matrix).toBeVisible()
  await expect(matrix.getByTestId('matrix-row')).toHaveCount(2)
  await expect(matrix.getByRole('button', { name: /Camille Dupuis.*Voie 1.*: 22/ })).toBeVisible()
  // Une case en conflit ne se confond pas avec une case vide.
  await expect(matrix.getByRole('button', { name: /Noé Durand.*Voie 1.*à trancher/ })).toBeVisible()

  // Une case vide ouvre la saisie de secours, et la grille se met à jour.
  await matrix.getByRole('button', { name: /Camille Dupuis.*Voie 2.*: —/ }).click()
  await expect(page.getByTestId('ascent-edit-subject')).toContainText('Camille Dupuis')
  await page.getByLabel('Numéro de prise').fill('31')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(matrix.getByRole('button', { name: /Camille Dupuis.*Voie 2.*: 31/ })).toBeVisible()

  // --- Journal en tableau -------------------------------------------------
  await pilotageSections.getByRole('tab', { name: 'Journal' }).click()
  await expect(page.getByRole('columnheader', { name: /Heure/ })).toBeVisible()
  await expect(page.getByLabel('À partir du')).toBeVisible()

  // --- Gardes d'ergonomie de bureau ---------------------------------------
  expect(await noHorizontalScroll(page)).toBe(true)
  // La dérogation d'ADR-073 vaut pour les lignes denses ; tout le reste tient
  // au moins ce plancher. Seule exception connue : le lien retour « ← Mes
  // compétitions » est volontairement à 20 px à partir de `lg` (décision du
  // Lot 17, notée dans TODO.md § Lot 18) — ce n'est pas une régression d'ici.
  const small = await tooSmall(page, FINE_TARGET)
  expect(small.filter((entry) => !entry.includes('Mes compétitions'))).toEqual([])

  // --- Le seuil annoncé est bien 1024 px, pas seulement 1440 -------------
  // ADR-072 point 1 dit « additif à partir de `lg` » ; le Lot 19 a montré
  // qu'un seuil se mesure. Ici rien n'a de largeur fixe, et ça tient.
  await pilotageSections.getByRole('tab', { name: "Vue d'ensemble" }).click()
  await page.setViewportSize({ width: 1024, height: 900 })
  await expect(page.getByTestId('pilotage-overview')).toBeVisible()
  expect(await railIsBeside(page)).toBe(true)
  expect(await noHorizontalScroll(page)).toBe(true)

  // --- Sous 1024 px, le rendu du Lot 8 revient ----------------------------
  await pilotageSections.getByRole('tab', { name: 'Voies' }).click()
  await page.setViewportSize({ width: 1023, height: 900 })
  await expect(page.getByTestId('ascent-matrix')).toHaveCount(0)
  await expect(page.getByLabel('Tour et voie')).toBeVisible()
  await expect(page.getByTestId('competition-progress')).toBeHidden()
  expect(await noHorizontalScroll(page)).toBe(true)
})
