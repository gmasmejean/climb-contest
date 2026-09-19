import { readFileSync } from 'node:fs'

import { expect, test } from '@playwright/test'

import { apiJson, loginApi, registerAndVerifyOrganizer } from './support/api'

// Lot 9, point 4 (RGPD, ADR-051) : rappel de conservation, export des données
// personnelles, puis purge — avec confirmation par le nom exact.

test('rappel des 5 ans, export des données personnelles, purge confirmée par le nom', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000)
  const { email, password } = await registerAndVerifyOrganizer(request, 'rgpd')
  const { headers } = await loginApi(request, email, password)

  const name = `Coupe ancienne rgpd ${Date.now()}`
  const competition = await apiJson<{ id: string }>(request, '/api/v1/competitions', {
    method: 'POST',
    headers,
    data: {
      name,
      venue: 'Salle e2e',
      startsOn: '2018-05-01',
      endsOn: '2018-05-01',
      format: 'contest',
      scoringEngineId: 'ffme-difficulty-2026',
      scoringConfig: { routesCounted: 1 },
    },
  })
  const category = await apiJson<{ id: string }>(
    request,
    `/api/v1/competitions/${competition.id}/categories`,
    { method: 'POST', headers, data: { label: 'Cat rgpd', sex: 'X' } },
  )
  await apiJson(request, `/api/v1/competitions/${competition.id}/competitors`, {
    method: 'POST',
    headers,
    data: {
      categoryId: category.id,
      bib: 1,
      firstName: 'Léa',
      lastName: 'Martin',
      licenseNumber: 'LIC-RGPD-77',
      birthYear: 2010,
    },
  })

  await page.goto('/login')
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Mot de passe').fill(password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page).toHaveURL('/')
  await page.getByRole('link', { name: 'Mes compétitions' }).click()

  // --- Rappel dans la liste : plus de 5 ans ---
  const row = page.getByRole('link').filter({ hasText: name })
  await expect(row.getByText('Plus de 5 ans : à purger')).toBeVisible()
  await row.click()
  await page.getByRole('tab', { name: 'Exports' }).click()
  await expect(page.getByRole('status')).toContainText('plus de 5 ans')

  // --- Export des données personnelles ---
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Exporter les données personnelles' }).click(),
  ])
  expect(download.suggestedFilename()).toMatch(/^donnees-personnelles-.+\.json$/)
  const exported = readFileSync((await download.path())!, 'utf8')
  expect(exported).toContain('LIC-RGPD-77')
  expect(exported).toContain('Martin')

  // --- Purge : le bouton reste inactif tant que le nom n'est pas EXACT ---
  await page.getByRole('button', { name: 'Supprimer les données personnelles…' }).click()
  const dialog = page.getByRole('dialog')
  const confirm = dialog.getByRole('button', { name: 'Supprimer définitivement' })
  await expect(confirm).toBeDisabled()
  await dialog.getByLabel(/retapez/).fill(name.toLowerCase())
  await expect(confirm).toBeDisabled()
  await dialog.getByLabel(/retapez/).fill(name)
  await expect(confirm).toBeEnabled()
  await confirm.click()

  await expect(page.getByText('Données personnelles supprimées.')).toBeVisible()
  await expect(page.getByText('ont été supprimées le')).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Supprimer les données personnelles…' }),
  ).toHaveCount(0)

  // --- Plus aucun nom dans l'application, et la liste le dit ---
  await page.getByRole('tab', { name: 'Compétiteurs' }).click()
  await expect(page.getByText('Martin')).toHaveCount(0)
  await expect(page.getByText('(données supprimées)').first()).toBeVisible()
  await page.getByRole('link', { name: '← Mes compétitions' }).click()
  await expect(
    page.getByRole('link').filter({ hasText: name }).getByText('Données supprimées'),
  ).toBeVisible()
})
