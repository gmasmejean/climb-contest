import type { Page } from '@playwright/test'

/**
 * Gardes d'ergonomie partagées entre parcours.
 *
 * Le seuil par défaut est celui de `CLAUDE.md` : 48 px pour un doigt. Les
 * tableaux de l'espace organisateur y dérogent sous `@media (pointer: fine)`
 * (ADR-073, Lot 18) — un parcours de bureau borne alors la garde au tableau et
 * lui passe `FINE_TARGET`. Le projet mobile, lui, garde 48 px partout.
 */
export const TOUCH_TARGET = 47.5

/** Plancher des commandes de ligne compactées à la souris (ADR-073). */
export const FINE_TARGET = 31.5

/** Boutons, liens et champs visibles trop petits pour la cible attendue. */
export async function tooSmall(
  page: Page,
  minHeight = TOUCH_TARGET,
  root = 'body',
): Promise<string[]> {
  return page.evaluate(
    ({ limit, rootSelector }) => {
      const scope = document.querySelector(rootSelector) ?? document.body
      return (
        [...scope.querySelectorAll('button, a, input:not([type=checkbox]), select, label')]
          .filter((el) => el instanceof HTMLElement && el.offsetParent !== null)
          // Un lien qui n'enveloppe qu'un bouton prend la taille du bouton : on ne compte que le bouton.
          .filter((el) => !(el.tagName === 'A' && el.querySelector('button')))
          // Le lien de texte courant « ← Mes compétitions » et les labels de champ ne sont pas des cibles.
          .filter((el) => !(el.tagName === 'LABEL' && !el.querySelector('input[type=checkbox]')))
          // Un champ masqué aux yeux (`sr-only`) n'est pas une cible : c'est
          // l'étiquette stylée qui en tient lieu.
          .filter((el) => el.getBoundingClientRect().width > 1)
          .filter((el) => el.getBoundingClientRect().height < limit)
          .map(
            (el) =>
              `${el.tagName} « ${(el.textContent ?? '').trim().slice(0, 30)} » ${Math.round(el.getBoundingClientRect().height)}px`,
          )
      )
    },
    { limit: minHeight, rootSelector: root },
  )
}

export async function noHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  )
}
