import { expect, test } from '@playwright/test'

import { FINE_TARGET, noHorizontalScroll, tooSmall } from './support/a11y'
import { apiJson, loginApi, registerAndVerifyOrganizer } from './support/api'

/**
 * Lot 18 (ADR-072, ADR-073) : au-dessus de 1024 px les listes de l'espace
 * organisateur deviennent des tableaux triables à en-tête collant, avec une
 * ligne d'ajout rapide pour les compétiteurs et des lignes compactes à la
 * souris. Ce parcours ne tourne qu'en projet de bureau — le projet `mobile`
 * (360 px) vérifie, lui, que rien n'a changé en cartes.
 */
test.skip(({ isMobile }) => isMobile === true, 'Le tableau n’existe qu’au-dessus de 1024 px.')

test('tableau des compétiteurs : tri, saisie au clavier, en-tête collant', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000)
  const { email, password } = await registerAndVerifyOrganizer(request, 'table')
  const { headers } = await loginApi(request, email, password)

  const competition = await apiJson<{ id: string }>(request, '/api/v1/competitions', {
    method: 'POST',
    headers,
    data: {
      name: `Tableau ${Date.now()}`,
      venue: 'Salle e2e',
      startsOn: '2099-04-01',
      endsOn: '2099-04-01',
      format: 'contest',
      scoringEngineId: 'ffme-difficulty-2026',
      scoringConfig: { routesCounted: 1 },
    },
  })
  const base = `/api/v1/competitions/${competition.id}`
  const category = await apiJson<{ id: string; label: string }>(request, `${base}/categories`, {
    method: 'POST',
    headers,
    data: { label: 'Cat tableau', sex: 'X' },
  })

  // Assez de lignes pour que la page défile et que l'en-tête collant serve.
  const seeded = [
    { bib: 12, firstName: 'Zoé', lastName: 'Vernet', clubName: 'CAF Lyon' },
    { bib: null, firstName: 'Bruno', lastName: 'Costa', clubName: 'ESC Annecy' },
    { bib: 3, firstName: 'Ana', lastName: 'Abad', clubName: 'CAF Lyon' },
  ]
  for (const competitor of seeded) {
    await apiJson(request, `${base}/competitors`, {
      method: 'POST',
      headers,
      data: { categoryId: category.id, birthYear: 2008, ...competitor },
    })
  }

  await page.goto('/login')
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Mot de passe').fill(password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page).toHaveURL('/competitions')

  await page.goto(`/competitions/${competition.id}/competitors`)
  const rows = page.getByTestId('data-list-row')
  await expect(rows).toHaveCount(3)

  // --- Colonnes que la carte ne montrait pas ---
  await expect(page.getByRole('columnheader', { name: 'Club' })).toBeVisible()
  await expect(page.getByRole('table')).toContainText('ESC Annecy')

  // --- Tri : les absents restent en bas dans les deux sens ---
  const bibHeader = page.getByRole('columnheader', { name: 'Dossard' })
  await bibHeader.getByRole('button').click()
  await expect(bibHeader).toHaveAttribute('aria-sort', 'ascending')
  await expect(rows.first()).toContainText('Ana')
  await expect(rows.last()).toContainText('Bruno')
  await bibHeader.getByRole('button').click()
  await expect(bibHeader).toHaveAttribute('aria-sort', 'descending')
  await expect(rows.first()).toContainText('Zoé')
  await expect(rows.last()).toContainText('Bruno')

  // Une seule colonne annonce un tri à la fois.
  await expect(page.getByRole('columnheader', { name: 'Nom', exact: true })).toHaveAttribute(
    'aria-sort',
    'none',
  )

  // --- Saisie au clavier : trois compétiteurs d'affilée, sans la souris ---
  // La ligne d'ajout est la première du corps du tableau ; les champs y sont
  // nommés par les en-têtes de colonne, sans étiquette visible.
  const quickAdd = page
    .getByRole('row')
    .filter({ has: page.getByRole('button', { name: 'Ajouter' }) })
  const firstName = quickAdd.getByRole('textbox', { name: 'Prénom' })
  const lastName = quickAdd.getByRole('textbox', { name: 'Nom', exact: true })
  await quickAdd.getByRole('combobox', { name: 'Catégorie' }).selectOption(category.id)
  await quickAdd.getByRole('textbox', { name: 'Club' }).fill('CAF Lyon')
  for (const name of ['Inès', 'Malo', 'Sacha']) {
    await firstName.fill(name)
    await lastName.fill(`Nouveau${name}`)
    await lastName.press('Enter')
    await expect(rows).toHaveCount(3 + ['Inès', 'Malo', 'Sacha'].indexOf(name) + 1)
    // Le focus revient au prénom, la catégorie et le club restent.
    await expect(firstName).toBeFocused()
    await expect(firstName).toHaveValue('')
  }
  await expect(quickAdd.getByRole('combobox', { name: 'Catégorie' })).toHaveValue(category.id)
  await expect(quickAdd.getByRole('textbox', { name: 'Club' })).toHaveValue('CAF Lyon')
  await expect(page.getByRole('table')).toContainText('NouveauSacha')

  // --- En-tête collant : toujours lisible après défilement ---
  const header = page.getByRole('columnheader', { name: 'Dossard' })
  const before = await header.boundingBox()
  await page.mouse.wheel(0, 800)
  await page.waitForTimeout(200)
  const after = await header.boundingBox()
  expect(after).not.toBeNull()
  expect(after!.y).toBeGreaterThanOrEqual(0)
  // Il n'a pas suivi la page vers le haut : il s'est arrêté sous l'en-tête de compétition.
  expect(after!.y).toBeGreaterThan((before?.y ?? 0) - 800)
  await expect(header).toBeInViewport()

  // --- Densité à la souris (ADR-073) : ~40 px, jamais moins de 38 ---
  const rowHeight = (await rows.first().boundingBox())?.height ?? 0
  expect(rowHeight).toBeGreaterThanOrEqual(38)
  expect(rowHeight).toBeLessThan(47.5)
  // Bornée au tableau : c'est lui seul qui déroge aux 48 px (ADR-073).
  expect(await tooSmall(page, FINE_TARGET, 'table')).toEqual([])
  await page.screenshot({ path: testInfo.outputPath('1-competiteurs.png'), fullPage: true })

  // --- Le seuil exact du lot : à 1024 px, le tableau reste lisible ---
  // Les colonnes de confort se retirent en dessous de 1280 px ; sinon neuf
  // colonnes écrasent les noms à une vingtaine de pixels.
  await page.setViewportSize({ width: 1024, height: 800 })
  await expect(page.getByRole('table')).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'Club' })).toHaveCount(0)
  await expect(page.getByRole('columnheader', { name: 'Licence' })).toHaveCount(0)
  const nameCell = page.getByRole('cell', { name: 'Vernet' })
  expect((await nameCell.boundingBox())?.width ?? 0).toBeGreaterThan(70)
  expect(await noHorizontalScroll(page)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('2-seuil-1024.png'), fullPage: true })

  // --- Juste en dessous, on retrouve les cartes et les 48 px ---
  await page.setViewportSize({ width: 1023, height: 800 })
  await expect(page.getByRole('table')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Ajouter un compétiteur' })).toBeVisible()
  expect(await tooSmall(page)).toEqual([])
  expect(await noHorizontalScroll(page)).toBe(true)
})
