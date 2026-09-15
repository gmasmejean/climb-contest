import { expect, test } from '@playwright/test'

const MAILPIT_URL = process.env['E2E_MAILPIT_URL'] ?? 'http://localhost:8025'

// Régression : le lien de vérification pointait autrefois vers un GET
// serveur qui modifiait la base directement (voir DECISIONS.md ADR-020).
// Ce test couvre le parcours réel : inscription -> e-mail Mailpit -> clic
// sur le lien -> le front appelle l'API -> connexion possible.
test('inscription, vérification par e-mail puis connexion', async ({ page, request }) => {
  const email = `e2e-verify-${Date.now()}@example.com`
  const password = 'un-mot-de-passe-solide'

  await page.goto('/register')
  await page.getByLabel('Nom du club').fill('Club E2E Vérif')
  await page.getByLabel('Votre nom').fill('E2E Testeur')
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Mot de passe').fill(password)
  await page.getByRole('button', { name: 'Créer mon compte' }).click()

  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByText('Compte créé')).toBeVisible()

  const messages = await request
    .get(`${MAILPIT_URL}/api/v1/messages?limit=1`)
    .then((r) => r.json())
  const messageId = messages.messages[0].ID as string
  const full = await request.get(`${MAILPIT_URL}/api/v1/message/${messageId}`).then((r) => r.json())
  const token = (full.Text as string).match(/token=(\S+)/)?.[1]
  expect(token).toBeTruthy()

  await page.goto(`/login?token=${token}`)
  await expect(page.getByText('E-mail vérifié')).toBeVisible()

  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Mot de passe').fill(password)
  await page.getByRole('button', { name: 'Se connecter' }).click()

  await expect(page).toHaveURL('/')
  await expect(page.getByText('E2E Testeur')).toBeVisible()
})
