import { watch, type Ref } from 'vue'

import {
  clearAscentDraft,
  loadAscentDraft,
  sameDraftValues,
  saveAscentDraft,
  type AscentDraftValues,
  type DraftTarget,
} from './ascent-draft'

type DraftRefs = { [K in keyof AscentDraftValues]: Ref<AscentDraftValues[K]> }

/**
 * Branche l'écran de saisie d'un passage sur son brouillon (ADR-061) : écrit
 * à chaque changement, restaure au démarrage, s'arrête à `clear()`.
 *
 * `start()` se rappelle UNE FOIS, quand l'écran a fini de se préremplir : les
 * valeurs à cet instant sont l'« état de départ ». Tant que le juge n'a rien
 * changé, aucun brouillon n'est écrit ; s'il revient à l'état de départ, le
 * brouillon est effacé.
 */
export function useAscentDraft(options: {
  routeId: string
  competitorId: string
  values: DraftRefs
  now?: () => number
}): {
  start: (context: Pick<DraftTarget, 'baseAscentId' | 'holdCount'>) => boolean
  clear: () => void
} {
  const { routeId, competitorId, values } = options
  const now = options.now ?? Date.now

  let target: DraftTarget | null = null
  let baseline: AscentDraftValues | null = null
  let restoring = false

  function snapshot(): AscentDraftValues {
    return {
      holdNumber: values.holdNumber.value,
      modifier: values.modifier.value,
      isTop: values.isTop.value,
      status: values.status.value,
      climbTimeMs: values.climbTimeMs.value,
    }
  }

  // `flush: 'sync'` : écrit dans le même tour que le changement, pas au prochain
  // rendu — un rechargement juste après un appui ne doit pas le perdre.
  watch(
    snapshot,
    (current) => {
      if (!target || !baseline || restoring) return
      if (sameDraftValues(current, baseline)) {
        clearAscentDraft({ routeId, competitorId })
      } else {
        saveAscentDraft(target, current, now())
      }
    },
    { flush: 'sync' },
  )

  function start(context: Pick<DraftTarget, 'baseAscentId' | 'holdCount'>): boolean {
    target = { routeId, competitorId, ...context }
    baseline = snapshot()

    const restored = loadAscentDraft(target, now())
    if (!restored) return false

    // Les affectations déclenchent l'observateur ci-dessus : on ne veut pas
    // qu'il réécrive le brouillon (ce qui repousserait sa péremption à chaque
    // rechargement).
    restoring = true
    values.holdNumber.value = restored.holdNumber
    values.modifier.value = restored.modifier
    values.isTop.value = restored.isTop
    values.status.value = restored.status
    values.climbTimeMs.value = restored.climbTimeMs
    restoring = false
    return true
  }

  function clear(): void {
    // `target = null` : plus rien ne peut recréer le brouillon après la
    // confirmation, même si une valeur bouge encore.
    target = null
    clearAscentDraft({ routeId, competitorId })
  }

  return { start, clear }
}
