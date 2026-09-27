import { expect, test, type APIRequestContext, type Browser } from '@playwright/test'

import { noHorizontalScroll, tooSmall } from './support/a11y'
import { apiJson, loginApi, registerAndVerifyOrganizer } from './support/api'

// Lot 24 (ADR-087) : un owner invite un collègue depuis l'écran « Membres »,
// l'invité suit le lien reçu par e-mail, choisit son mot de passe et retrouve
// les compétitions de l'organisation ; puis l'owner le désactive et le
// réactive. Tourne aussi en émulation mobile (360 px).

const MAILPIT_URL = process.env['E2E_MAILPIT_URL'] ?? 'http://localhost:8025'

async function invitationTokenFor(request: APIRequestContext, email: string): Promise<string> {
  const search = await request
    .get(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=1`)
    .then((r) => r.json())
  const messageId = search.messages[0].ID as string
  const full = await request.get(`${MAILPIT_URL}/api/v1/message/${messageId}`).then((r) => r.json())
  const token = (full.Text as string).match(/accept-invite\?token=(\S+)/)?.[1]
  if (!token) throw new Error(`Aucun lien d'invitation pour ${email}.`)
  return token
}

async function newPage(browser: Browser, baseURL: string | undefined) {
  const context = await browser.newContext(baseURL ? { baseURL } : {})
  return context.newPage()
}

test('inviter un collègue, qu’il active son compte, puis le désactiver et le réactiver', async ({
  page,
  request,
  browser,
  baseURL,
}) => {
  test.setTimeout(120_000)
  const stamp = Date.now()
  const { email, password } = await registerAndVerifyOrganizer(request, 'membres')
  const { headers } = await loginApi(request, email, password)
  const competitionName = `Coupe partagée ${stamp}`
  await apiJson(request, '/api/v1/competitions', {
    method: 'POST',
    headers,
    data: {
      name: competitionName,
      venue: 'Gymnase',
      startsOn: '2099-03-01',
      endsOn: '2099-03-01',
      format: 'contest',
      scoringEngineId: 'ffme-difficulty-2026',
      scoringConfig: { routesCounted: 1 },
    },
  })

  // --- L'owner invite depuis le menu ---
  await page.goto('/login')
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Mot de passe').fill(password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page).toHaveURL('/competitions')
  await page.getByRole('button', { name: 'Menu' }).click()
  await page.getByRole('menuitem', { name: 'Membres de l’organisation' }).click()
  await expect(page).toHaveURL('/organization/members')

  const colleague = `e2e-collegue-${stamp}@example.com`
  await page.getByLabel('Nom').fill('Camille Collègue')
  await page.getByLabel('E-mail').fill(colleague)
  await page.getByRole('button', { name: 'Envoyer l’invitation' }).click()
  await expect(page.getByText(`Invitation envoyée à ${colleague}.`)).toBeVisible()

  const row = page.getByTestId('data-list-row').filter({ hasText: 'Camille Collègue' })
  await expect(row.getByText('Invitation envoyée')).toBeVisible()
  expect(await noHorizontalScroll(page)).toBe(true)
  expect(await tooSmall(page, undefined, 'main form')).toEqual([])

  // --- L'invité suit le lien, choisit son mot de passe ---
  const token = await invitationTokenFor(request, colleague)
  const invitee = await newPage(browser, baseURL)
  await invitee.goto(`/accept-invite?token=${token}`)
  await expect(invitee).toHaveURL('/accept-invite')
  await invitee.getByLabel('Mot de passe').fill('un-mot-de-passe-du-collegue')
  await invitee.getByRole('button', { name: 'Activer mon compte' }).click()
  await expect(invitee).toHaveURL('/competitions')
  await expect(invitee.getByText(competitionName)).toBeVisible()

  await page.reload()
  await expect(row.getByText('Actif')).toBeVisible()

  // --- L'owner le désactive (avec confirmation) : la connexion est refusée ---
  await row.getByRole('button', { name: 'Désactiver' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Vous pourrez réactiver ce compte à tout moment.')
  await dialog.getByRole('button', { name: 'Désactiver' }).click()
  await expect(row.getByText('Désactivé', { exact: true })).toBeVisible()

  const again = await newPage(browser, baseURL)
  await again.goto('/login')
  await again.getByLabel('E-mail').fill(colleague)
  await again.getByLabel('Mot de passe').fill('un-mot-de-passe-du-collegue')
  await again.getByRole('button', { name: 'Se connecter' }).click()
  await expect(again.getByText('désactivé par un responsable de votre organisation')).toBeVisible()

  // --- Réactivation : il se reconnecte ---
  await row.getByRole('button', { name: 'Réactiver' }).click()
  await expect(row.getByText('Actif')).toBeVisible()
  await again.getByRole('button', { name: 'Se connecter' }).click()
  await expect(again).toHaveURL('/competitions')
})
