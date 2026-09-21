import { expect, test } from '@playwright/test'

import { FINE_TARGET, TOUCH_TARGET, noHorizontalScroll, tooSmall } from './support/a11y'
import { apiJson, loginApi, registerAndVerifyOrganizer } from './support/api'

// Lot 11 (ADR-062, ADR-063) : rechercher dans la liste, puis la corbeille en
// deux temps — mise à la corbeille sans confirmation, restauration, suppression
// définitive avec une confirmation. Tourne aussi en émulation mobile (360 px).

test('rechercher, mettre à la corbeille, restaurer, supprimer définitivement', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000)
  // Au-dessus de 1024 px les listes deviennent des tableaux et les commandes de
  // ligne se compactent (Lot 18, ADR-073) ; le doigt, lui, garde ses 48 px.
  const desktop = testInfo.project.name !== 'mobile'
  const minTarget = desktop ? FINE_TARGET : TOUCH_TARGET
  const stamp = Date.now()
  const { email, password } = await registerAndVerifyOrganizer(request, 'trash')
  const { headers } = await loginApi(request, email, password)

  const create = (name: string, venue: string, startsOn: string) =>
    apiJson<{ id: string }>(request, '/api/v1/competitions', {
      method: 'POST',
      headers,
      data: {
        name,
        venue,
        startsOn,
        endsOn: startsOn,
        format: 'contest',
        scoringEngineId: 'ffme-difficulty-2026',
        scoringConfig: { routesCounted: 1 },
      },
    })
  const alpha = `Alpha ${stamp}`
  const beta = `Bêta ${stamp}`
  const gamma = `Gamma ${stamp}`
  const alphaId = (await create(alpha, 'Gymnase du Lac', '2099-03-01')).id
  const betaId = (await create(beta, 'Salle Roc', '2099-04-01')).id
  const gammaId = (await create(gamma, 'Halle des Sports', '2099-05-01')).id
  await apiJson(request, `/api/v1/competitions/${gammaId}/status`, {
    method: 'POST',
    headers,
    data: { status: 'running' },
  })

  await page.goto('/login')
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Mot de passe').fill(password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page).toHaveURL('/')
  await page.getByRole('link', { name: 'Mes compétitions' }).click()

  // --- Recherche : sans accent ni casse, gardée dans l'adresse ---
  // Une ligne de liste, carte ou rangée de tableau selon la largeur.
  const rows = page.getByTestId('data-list-row')
  await expect(rows).toHaveCount(3)
  await page.getByLabel('Rechercher (nom ou lieu)').fill('BETA')
  await expect(rows).toHaveCount(1)
  await expect(rows.getByText(beta)).toBeVisible()
  await expect(page).toHaveURL(/q=BETA/)
  await page.reload()
  await expect(page.getByLabel('Rechercher (nom ou lieu)')).toHaveValue('BETA')
  await expect(rows).toHaveCount(1)
  await page.getByLabel('Rechercher (nom ou lieu)').fill('halle')
  await expect(rows.getByText(gamma)).toBeVisible()
  await page.getByRole('button', { name: 'Réinitialiser' }).first().click()
  await expect(rows).toHaveCount(3)
  await expect(page).not.toHaveURL(/q=/)

  // --- Tri par nom : en-tête de tableau sur grand écran, sélecteur en dessous ---
  if (desktop) {
    await page.getByRole('columnheader', { name: 'Nom' }).getByRole('button').click()
    await expect(page.getByRole('columnheader', { name: 'Nom' })).toHaveAttribute(
      'aria-sort',
      'ascending',
    )
    await expect(page).toHaveURL(/sort=name/)
  } else {
    await page.getByLabel('Trier par').selectOption('name:asc')
  }
  await expect(rows.first()).toContainText(alpha)
  if (desktop) {
    await page.getByRole('button', { name: 'Réinitialiser' }).first().click()
  } else {
    await page.getByLabel('Trier par').selectOption('date:desc')
  }

  expect(await tooSmall(page, minTarget)).toEqual([])
  expect(await noHorizontalScroll(page)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('1-liste.png'), fullPage: true })

  // --- Sélection : une compétition en cours n'est pas cochable ---
  await page.getByRole('button', { name: 'Sélectionner' }).click()
  await expect(page.getByRole('checkbox', { name: new RegExp(gamma) })).toBeDisabled()
  await expect(page.getByText('clôturez-la pour pouvoir la supprimer')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Mettre à la corbeille' })).toBeDisabled()
  await page.getByRole('checkbox', { name: new RegExp(alpha) }).check()
  await page.getByRole('checkbox', { name: new RegExp(beta) }).check()
  await expect(page.getByText('2 sélectionnées')).toBeVisible()
  expect(await tooSmall(page, minTarget)).toEqual([])
  expect(await noHorizontalScroll(page)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('2-selection.png'), fullPage: true })

  // --- Corbeille : aucune confirmation, un bilan clair ---
  await page.getByRole('button', { name: 'Mettre à la corbeille' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('status')).toContainText(
    '2 compétitions ont été mises à la corbeille.',
  )
  await expect(rows).toHaveCount(1)
  await expect(rows.getByText(gamma)).toBeVisible()
  await expect(page.getByRole('link', { name: /Corbeille \(2\)/ })).toBeVisible()

  // Pour l'API aussi, elles n'existent plus dans la liste ni en détail.
  const active = await apiJson<{ id: string }[]>(request, '/api/v1/competitions', { headers })
  expect(active.map((c) => c.id)).toEqual([gammaId])
  const detail = await request.get(`/api/v1/competitions/${alphaId}`, { headers })
  expect(detail.status()).toBe(404)

  // --- Page Corbeille : restaurer sans confirmation ---
  await page.getByRole('link', { name: /Corbeille \(2\)/ }).click()
  await expect(page.getByRole('heading', { name: 'Corbeille' })).toBeVisible()
  await expect(page.getByText(alpha)).toBeVisible()
  await expect(page.getByText(beta)).toBeVisible()
  await expect(page.getByText('Mise à la corbeille aujourd’hui').first()).toBeVisible()
  expect(await tooSmall(page, minTarget)).toEqual([])
  expect(await noHorizontalScroll(page)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('3-corbeille.png'), fullPage: true })

  await page
    .getByTestId('data-list-row')
    .filter({ hasText: alpha })
    .getByRole('button', { name: 'Restaurer' })
    .click()
  await expect(page.getByRole('status')).toContainText(`« ${alpha} » a été restaurée.`)
  await expect(page.getByText(alpha, { exact: false }).first()).toBeVisible()
  const afterRestore = await apiJson<{ id: string }[]>(request, '/api/v1/competitions', { headers })
  expect(afterRestore.map((c) => c.id).sort()).toEqual([alphaId, gammaId].sort())

  // --- Suppression définitive : une confirmation, qui dit ce qui va disparaître ---
  await page.getByRole('checkbox', { name: new RegExp(beta) }).check()
  await page.getByRole('button', { name: 'Supprimer définitivement' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Cette action est irréversible')
  await expect(dialog).toContainText(beta)
  expect(await tooSmall(page, minTarget)).toEqual([])
  await page.screenshot({ path: testInfo.outputPath('4-confirmation.png'), fullPage: true })
  // « Annuler » ne supprime rien.
  await dialog.getByRole('button', { name: 'Annuler' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByText(beta).first()).toBeVisible()

  await page.getByRole('button', { name: 'Supprimer définitivement' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Supprimer définitivement' }).click()
  await expect(page.getByRole('status')).toContainText(
    `« ${beta} » a été supprimée définitivement.`,
  )
  await expect(page.getByText('La corbeille est vide.')).toBeVisible()

  // Plus rien : ni dans la liste, ni en détail, ni dans la corbeille.
  const trash = await apiJson<unknown[]>(request, '/api/v1/competitions/trash', { headers })
  expect(trash).toEqual([])
  expect((await request.get(`/api/v1/competitions/${betaId}`, { headers })).status()).toBe(404)
  expect((await request.post(`/api/v1/competitions/${betaId}/restore`, { headers })).status()).toBe(
    404,
  )
})
