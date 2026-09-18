import { flushPromises } from '@vue/test-utils'

/**
 * Dexie `liveQuery` (fake-indexeddb, jsdom) a besoin de plusieurs ticks pour
 * que sa première émission traverse la chaîne de promesses jusqu'au rendu —
 * le nombre exact varie selon la charge de la machine (observé flaky avec 2
 * sous exécution parallèle) ; 5 s'est montré fiable en pratique.
 */
export async function flushLiveQueries(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await flushPromises()
  }
}
