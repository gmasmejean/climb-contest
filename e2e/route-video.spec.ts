import { expect, test, type APIRequestContext } from '@playwright/test'

import { apiJson, loginApi, registerAndVerifyOrganizer } from './support/api'

// Lot 9, point 3 : téléverser la vidéo d'une voie depuis l'interface, la voir
// lue côté public, et reprendre un envoi après une coupure réseau.

const MIB = 1024 * 1024

/** Un « fichier » MP4 : la signature `ftyp isom` suffit, le codec n'est pas vérifié (ADR-052). */
function mp4(size: number): Buffer {
  const buffer = Buffer.alloc(size)
  Buffer.from([0, 0, 0, 0x18]).copy(buffer, 0)
  buffer.write('ftypisom', 4, 'ascii')
  return buffer
}

async function setUp(request: APIRequestContext, headers: Record<string, string>) {
  const name = `Coupe vidéo e2e ${Date.now()}`
  const competition = await apiJson<{ id: string; publicSlug: string }>(
    request,
    '/api/v1/competitions',
    {
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
    },
  )
  const base = `/api/v1/competitions/${competition.id}`
  const category = await apiJson<{ id: string }>(request, `${base}/categories`, {
    method: 'POST',
    headers,
    data: { label: 'Cat vidéo e2e', sex: 'X' },
  })
  const route = await apiJson<{ id: string }>(request, `${base}/routes`, {
    method: 'POST',
    headers,
    data: { number: 1, holdCount: 40, categoryIds: [category.id] },
  })
  return { name, slug: competition.publicSlug, competitionId: competition.id, routeId: route.id }
}

test('téléverser une vidéo, la lire côté public, reprendre après une coupure, la supprimer', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000)
  const { email, password } = await registerAndVerifyOrganizer(request, 'video')
  const { headers } = await loginApi(request, email, password)
  const { name, slug, routeId } = await setUp(request, headers)

  await page.goto('/login')
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Mot de passe').fill(password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page).toHaveURL('/')
  await page.getByRole('link', { name: 'Mes compétitions' }).click()
  await page.getByText(name).click()
  await page.getByRole('tab', { name: 'Voies' }).click()
  await page.getByRole('button', { name: 'Modifier' }).first().click()

  // --- Un fichier qui n'est pas une vidéo est refusé, avec un message clair ---
  await page.getByLabel('Choisir une vidéo').setInputFiles({
    name: 'faux.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.from('%PDF-1.7 ceci n’est pas une vidéo, quelle que soit l’extension'),
  })
  await page.getByRole('button', { name: 'Envoyer la vidéo' }).click()
  await expect(page.getByRole('alert')).toContainText('pas une vidéo reconnue')

  // --- Une vraie vidéo de 9 Mio (2 morceaux), avec une coupure réseau au 2ᵉ ---
  const file = mp4(9 * MIB)
  let patchCount = 0
  await page.route('**/video/uploads/*', async (route) => {
    if (route.request().method() === 'PATCH') {
      patchCount += 1
      if (patchCount === 2) {
        await route.abort('connectionreset')
        return
      }
    }
    await route.continue()
  })
  await page
    .getByLabel('Choisir une vidéo')
    .setInputFiles({ name: 'enchainement.mp4', mimeType: 'video/mp4', buffer: file })
  await page.getByRole('button', { name: /Envoyer la vidéo|Reprendre l’envoi/ }).click()
  await expect(page.getByText('Vidéo enregistrée.')).toBeVisible({ timeout: 60_000 })
  // Le 2ᵉ morceau a été coupé puis repris : au moins 3 PATCH au total.
  expect(patchCount).toBeGreaterThanOrEqual(3)

  // --- Après rechargement, la vidéo est bien attachée à la voie ---
  await page.reload()
  await page.getByRole('tab', { name: 'Voies' }).click()
  await page.getByRole('button', { name: 'Modifier' }).first().click()
  await expect(page.getByText('Une vidéo est enregistrée pour cette voie.')).toBeVisible()

  // --- Côté public : un lecteur, et des plages d'octets ---
  const publicPage = await page.context().newPage()
  await publicPage.goto(`/c/${slug}`)
  await publicPage.getByRole('tab', { name: 'Voies' }).click()
  const player = publicPage.locator('video')
  await expect(player).toBeVisible()
  const src = await player.getAttribute('src')
  expect(src).toBe(`/api/v1/public/${slug}/routes/${routeId}/video`)

  const head = await request.get(src!, { headers: { range: 'bytes=0-15' } })
  expect(head.status()).toBe(206)
  expect(head.headers()['content-range']).toBe(`bytes 0-15/${9 * MIB}`)
  expect(head.headers()['content-type']).toBe('video/mp4')
  expect((await head.body()).subarray(4, 12).toString('ascii')).toBe('ftypisom')

  // --- Suppression, avec confirmation ---
  await page.getByRole('button', { name: 'Supprimer la vidéo' }).first().click()
  await page.getByRole('dialog').getByRole('button', { name: 'Supprimer la vidéo' }).click()
  await expect(page.getByText('Vidéo supprimée.')).toBeVisible()
  expect((await request.get(src!)).status()).toBe(404)
})
