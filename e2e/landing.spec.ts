import { expect, test } from '@playwright/test'

// Page d'accueil publique (DECISIONS.md ADR-070). Tourne en desktop ET en
// émulation mobile 360 px (projet `mobile`, `playwright.config.ts`).

test('un visiteur anonyme voit la page d’accueil et rejoint l’espace organisateur', async ({
  page,
}) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { level: 1 })).toContainText('Découvrir. Suivre. Vivre.')
  for (const title of ['Organisateurs', 'Juges', 'Spectateurs', 'Grimpeurs']) {
    await expect(page.getByRole('heading', { level: 2, name: title })).toBeVisible()
  }

  // La recherche (Lot 13) n'existe pas encore : désactivée ET annoncée.
  await expect(page.getByPlaceholder('Rechercher une compétition…')).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Trouver une compétition' })).toBeDisabled()
  await expect(page.getByText('Recherche bientôt disponible')).toBeVisible()
  await expect(page.getByText('Bientôt', { exact: true })).toBeVisible()

  // Rien de l'état connecté, et aucun défilement horizontal à 360 px.
  await expect(page.getByRole('link', { name: 'Mes compétitions' })).toHaveCount(0)
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBe(0)

  await page.getByRole('link', { name: /Espace organisateur/ }).click()
  await expect(page).toHaveURL('/login')
})

test('un organisateur connecté retrouve « Mes compétitions » sur l’accueil', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('E-mail').fill('organisateur@club-demo.test')
  await page.getByLabel('Mot de passe').fill('ChangeMoi123!')
  await page.getByRole('button', { name: 'Se connecter' }).click()

  await expect(page).toHaveURL('/')
  await expect(page.getByText('Alex Organisateur')).toBeVisible()
  await expect(page.getByRole('link', { name: /Espace organisateur/ })).toHaveCount(0)

  // F5 : la session est restaurée sur `/` (pas de `skipOrganizerSession`).
  await page.reload()
  await expect(page.getByText('Alex Organisateur')).toBeVisible()

  await page.getByRole('link', { name: 'Mes compétitions' }).click()
  await expect(page).toHaveURL('/competitions')
})
