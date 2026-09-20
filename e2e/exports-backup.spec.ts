import { readFileSync } from 'node:fs'

import { expect, test, type APIRequestContext } from '@playwright/test'

import { apiJson, loginApi, openContestRound, registerAndVerifyOrganizer } from './support/api'

// Lot 9, point 2 : résultats en PDF et CSV, sauvegarde JSON complète, puis
// réimport de cette sauvegarde comme nouvelle compétition — depuis
// l'interface, avec de vrais téléchargements.

async function setUpPlayedContest(request: APIRequestContext, headers: Record<string, string>) {
  const name = `Coupe exports e2e ${Date.now()}`
  const competition = await apiJson<{ id: string }>(request, '/api/v1/competitions', {
    method: 'POST',
    headers,
    data: {
      name,
      venue: 'Salle e2e',
      startsOn: '2099-01-01',
      endsOn: '2099-01-01',
      format: 'contest',
      scoringEngineId: 'ffme-difficulty-2026',
      scoringConfig: { routesCounted: 1 },
    },
  })
  const base = `/api/v1/competitions/${competition.id}`
  const category = await apiJson<{ id: string }>(request, `${base}/categories`, {
    method: 'POST',
    headers,
    data: { label: 'Cat exports e2e', sex: 'X' },
  })
  const competitors: string[] = []
  for (const bib of [1, 2, 3]) {
    const created = await apiJson<{ id: string }>(request, `${base}/competitors`, {
      method: 'POST',
      headers,
      data: { categoryId: category.id, bib, firstName: `Prénom${bib}`, lastName: `Nom${bib}` },
    })
    competitors.push(created.id)
  }
  const route = await apiJson<{ id: string }>(request, `${base}/routes`, {
    method: 'POST',
    headers,
    data: { number: 1, holdCount: 40, categoryIds: [category.id] },
  })
  const judge = await apiJson<{ accessToken: string }>(request, `${base}/judges`, {
    method: 'POST',
    headers,
    data: { displayName: 'Juge exports e2e', routeIds: [route.id] },
  })
  await openContestRound(request, headers, base)

  const judgeJwt = (
    await apiJson<{ token: string }>(request, '/api/v1/judge/auth', {
      method: 'POST',
      data: { token: judge.accessToken },
    })
  ).token
  const detail = await apiJson<{ round: { id: string } }>(
    request,
    `/api/v1/judge/routes/${route.id}`,
    {
      headers: { authorization: `Bearer ${judgeJwt}` },
    },
  )
  await apiJson(request, '/api/v1/judge/ascents/batch', {
    method: 'POST',
    headers: { authorization: `Bearer ${judgeJwt}` },
    data: {
      items: competitors.map((competitorId, index) => ({
        kind: 'create',
        id: crypto.randomUUID(),
        roundId: detail.round.id,
        routeId: route.id,
        competitorId,
        holdNumber: 30 - index * 5,
        modifier: 'none',
        isTop: false,
        status: 'valid',
        climbTimeMs: null,
        recordedAt: new Date().toISOString(),
        deviceId: 'device-e2e',
      })),
    },
  })
  return { name, competitionId: competition.id }
}

test('exporter les résultats et la sauvegarde, puis réimporter la sauvegarde', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000)
  const { email, password } = await registerAndVerifyOrganizer(request, 'exports')
  const { headers } = await loginApi(request, email, password)
  const { name } = await setUpPlayedContest(request, headers)

  await page.goto('/login')
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Mot de passe').fill(password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page).toHaveURL('/')
  await page.getByRole('link', { name: 'Mes compétitions' }).click()
  await page.getByText(name).click()
  await page.getByRole('tab', { name: 'Exports' }).click()

  // --- Résultats en PDF ---
  const [pdf] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Résultats en PDF' }).click(),
  ])
  expect(pdf.suggestedFilename()).toMatch(/^resultats-.+\.pdf$/)
  expect(
    readFileSync((await pdf.path())!)
      .subarray(0, 5)
      .toString(),
  ).toBe('%PDF-')

  // --- Résultats en CSV ---
  const [csv] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Résultats en CSV (tableur)' }).click(),
  ])
  expect(csv.suggestedFilename()).toMatch(/^resultats-.+\.csv$/)
  const csvText = readFileSync((await csv.path())!, 'utf8')
  expect(csvText).toContain('categorie;rang;dossard;nom;prenom')
  expect(csvText).toContain('Nom1')

  // --- Sauvegarde JSON ---
  const [json] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Télécharger la sauvegarde' }).click(),
  ])
  expect(json.suggestedFilename()).toMatch(/^sauvegarde-.+\.json$/)
  const backupPath = (await json.path())!
  const backup = JSON.parse(readFileSync(backupPath, 'utf8')) as {
    competition: { name: string }
    ascents: unknown[]
  }
  expect(backup.competition.name).toBe(name)
  expect(backup.ascents).toHaveLength(3)

  // --- Réimport : l'aperçu précède toute écriture ---
  await page.getByRole('link', { name: '← Mes compétitions' }).click()
  await expect(page).toHaveURL('/competitions')
  const countBefore = await page.getByText(name, { exact: true }).count()
  await page.getByRole('button', { name: 'Importer une sauvegarde' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Fichier de sauvegarde').setInputFiles(backupPath)
  await expect(dialog.getByText('3 compétiteur(s)')).toBeVisible()
  await expect(dialog.getByText('3 passage(s)')).toBeVisible()
  await expect(dialog.getByText('révoqués', { exact: false })).toBeVisible()
  // Rien n'est encore créé.
  expect(
    (await apiJson<{ name: string }[]>(request, '/api/v1/competitions', { headers })).filter(
      (c) => c.name === name,
    ),
  ).toHaveLength(1)

  await dialog.getByRole('button', { name: 'Créer la compétition' }).click()
  await expect(page).toHaveURL(/\/competitions\/[0-9a-f-]{36}$/)
  await expect(page.getByRole('heading', { name })).toBeVisible()
  expect(
    (await apiJson<{ name: string }[]>(request, '/api/v1/competitions', { headers })).filter(
      (c) => c.name === name,
    ),
  ).toHaveLength(2)
  expect(countBefore).toBe(1)
})

test('l’aperçu refuse un fichier qui n’est pas une sauvegarde, sans rien créer', async ({
  page,
  request,
}) => {
  const { email, password } = await registerAndVerifyOrganizer(request, 'import-refus')
  const { headers } = await loginApi(request, email, password)

  await page.goto('/login')
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Mot de passe').fill(password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await page.getByRole('link', { name: 'Mes compétitions' }).click()
  await page.getByRole('button', { name: 'Importer une sauvegarde' }).click()
  const dialog = page.getByRole('dialog')

  await dialog.getByLabel('Fichier de sauvegarde').setInputFiles({
    name: 'pas-une-sauvegarde.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"hello":"world"}'),
  })
  await expect(dialog.getByRole('alert')).toContainText(
    'n’est pas une sauvegarde ClimbContest valide',
  )
  await expect(dialog.getByRole('button', { name: 'Créer la compétition' })).toBeDisabled()

  await dialog.getByLabel('Fichier de sauvegarde').setInputFiles({
    name: 'casse.json',
    mimeType: 'application/json',
    buffer: Buffer.from('ceci n’est pas du json'),
  })
  await expect(dialog.getByRole('alert')).toContainText('ne contient pas de JSON valide')

  expect(await apiJson<unknown[]>(request, '/api/v1/competitions', { headers })).toHaveLength(0)
})
