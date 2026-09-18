import { liveQuery } from 'dexie'
import { onUnmounted, shallowRef, type Ref } from 'vue'

/**
 * Pont Dexie `liveQuery` → réactivité Vue. Pas de binding officiel Dexie/Vue
 * dans le monorepo (ADR-012) — ~15 lignes suffisent, pas besoin d'une
 * dépendance dédiée.
 */
export function useLiveQuery<T>(querier: () => Promise<T> | T, initial: T): Ref<T> {
  const value = shallowRef(initial) as Ref<T>
  const subscription = liveQuery(querier).subscribe({
    next: (result) => {
      value.value = result
    },
    error: (error: unknown) => {
      console.error('Erreur de lecture locale (IndexedDB) :', error)
    },
  })
  onUnmounted(() => {
    subscription.unsubscribe()
  })
  return value
}
