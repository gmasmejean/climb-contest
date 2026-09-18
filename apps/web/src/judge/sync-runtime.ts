import { SyncEngine, type QueueItem } from '@climbcontest/sync'
import { onUnmounted, shallowRef, type Ref } from 'vue'

import type { QueuePayload } from './queue-payload'
import { DexieQueueStorage } from './sync-storage'
import { HttpSyncTransport } from './sync-transport'

/**
 * Instance unique du moteur de synchronisation (SPEC.md § 6.3, ADR-014).
 * Un seul appareil = une seule file — pas besoin d'un scope par juge (voir
 * ADR-036, `local-db.ts`).
 */
export const syncEngine = new SyncEngine<QueuePayload>(
  new DexieQueueStorage(),
  new HttpSyncTransport(),
)

let started = false

/**
 * À appeler une fois au démarrage de l'app (`main.ts`) — idempotent. Charge
 * la file persistée et tente immédiatement un envoi, puis reste à l'écoute
 * du retour réseau et du retour au premier plan (SPEC.md § 6.3).
 */
export function startSyncRuntime(): void {
  if (started) return
  started = true
  void syncEngine.onStartup()
  window.addEventListener('online', () => {
    syncEngine.onOnline()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncEngine.onVisible()
  })
}

/** Instantané réactif de la file — bandeau global et indicateurs de ligne. */
export function useSyncSnapshot(): Ref<QueueItem<QueuePayload>[]> {
  const snapshot = shallowRef<QueueItem<QueuePayload>[]>(syncEngine.snapshot())
  const unsubscribe = syncEngine.subscribe((items) => {
    snapshot.value = items
  })
  onUnmounted(unsubscribe)
  return snapshot
}
