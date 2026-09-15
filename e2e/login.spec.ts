import { expect, test } from '@playwright/test'

// Parcours minimal exigé par ROADMAP.md Lot 1, point 9 : connexion avec un
// compte déjà activé, arrivée sur l'accueil. Le compte utilisé est celui
// créé par `pnpm --filter @climbcontest/db db:seed`.
test('un organisateur déjà activé se connecte et arrive sur l’accueil', async ({ page }) => {
  await page.goto('/login')

  await page.getByLabel('E-mail').fill('organisateur@club-demo.test')
  await page.getByLabel('Mot de passe').fill('ChangeMoi123!')
  await page.getByRole('button', { name: 'Se connecter' }).click()

  await expect(page).toHaveURL('/')
  await expect(page.getByText('Alex Organisateur')).toBeVisible()
})
