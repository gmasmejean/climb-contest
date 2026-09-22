import { expect, test } from '@playwright/test'

// Parcours minimal exigé par ROADMAP.md Lot 1, point 9 : connexion avec un
// compte déjà activé, arrivée sur la liste des compétitions. Le compte
// utilisé est celui créé par `pnpm --filter @climbcontest/db db:seed`.
test('un organisateur déjà activé se connecte et arrive sur ses compétitions', async ({
  page,
}) => {
  await page.goto('/login')

  await page.getByLabel('E-mail').fill('organisateur@club-demo.test')
  await page.getByLabel('Mot de passe').fill('ChangeMoi123!')
  await page.getByRole('button', { name: 'Se connecter' }).click()

  await expect(page).toHaveURL('/competitions')
  await expect(page.getByRole('heading', { name: 'Mes compétitions' })).toBeVisible()
})
