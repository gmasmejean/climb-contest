/**
 * Une même action appliquée à plusieurs compétitions (corbeille, restauration,
 * suppression définitive — Lot 11). Il n'y a pas de route « en lot » : chaque
 * compétition est traitée une par une, et l'échec de l'une (par exemple une
 * compétition « En cours ») ne doit jamais empêcher ni cacher le succès des
 * autres. Le bilan dit précisément ce qui a été fait et ce qui ne l'a pas été.
 */

export interface BulkFailure<T> {
  item: T
  message: string
}

export interface BulkOutcome<T> {
  done: T[]
  failed: BulkFailure<T>[]
}

/** Séquentiel, dans l'ordre : pas d'orage de requêtes sur un réseau de salle. */
export async function runBulk<T>(
  items: readonly T[],
  action: (item: T) => Promise<unknown>,
  describeError: (error: unknown) => string,
): Promise<BulkOutcome<T>> {
  const outcome: BulkOutcome<T> = { done: [], failed: [] }
  for (const item of items) {
    try {
      await action(item)
      outcome.done.push(item)
    } catch (error) {
      outcome.failed.push({ item, message: describeError(error) })
    }
  }
  return outcome
}

/** Les deux formes du participe, accordées au féminin de « compétition ». */
export interface BulkVerbs {
  one: string
  many: string
}

export const TRASH_VERBS: BulkVerbs = {
  one: 'a été mise à la corbeille',
  many: 'ont été mises à la corbeille',
}
export const RESTORE_VERBS: BulkVerbs = { one: 'a été restaurée', many: 'ont été restaurées' }
export const DELETE_VERBS: BulkVerbs = {
  one: 'a été supprimée définitivement',
  many: 'ont été supprimées définitivement',
}

/** Le bilan lu à l'écran : ce qui est fait, et pour le reste, pourquoi et quoi faire. */
export function describeBulk(outcome: BulkOutcome<{ name: string }>, verbs: BulkVerbs): string {
  const { done, failed } = outcome
  const parts: string[] = []
  if (done.length === 1 && done[0]) {
    parts.push(`« ${done[0].name} » ${verbs.one}.`)
  } else if (done.length > 1) {
    parts.push(`${done.length} compétitions ${verbs.many}.`)
  }
  if (failed.length > 0) {
    if (done.length === 0) parts.push('Rien n’a été modifié.')
    else
      parts.push(
        failed.length === 1
          ? 'Une compétition est restée telle quelle.'
          : `${failed.length} compétitions sont restées telles quelles.`,
      )
    for (const failure of failed) parts.push(`« ${failure.item.name} » : ${failure.message}`)
  }
  return parts.join(' ')
}
