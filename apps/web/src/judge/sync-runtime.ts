import { SyncEngine, type QueueItem } from '@climbcontest/sync'
import { onUnmounted, shallowRef, type Ref } from 'vue'

import { judgeToken } from '../api/judge-session'
import { bootstrapJudge } from './bootstrap'
import type { QueuePayload } from './queue-payload'
import { createRefreshScheduler, refreshRoutesIfQueueIdle } from './refresh-routes'
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

/**
 * ADR-055 : les voies du juge sont actualisées (nouveau tour ouvert…) aux
 * mêmes déclencheurs que la file, mais seulement quand elle est vide.
 */
export const refreshScheduler = createRefreshScheduler({
  now: () => Date.now(),
  refresh: () =>
    refreshRoutesIfQueueIdle({
      hasJudgeSession: () => judgeToken.value !== null,
      bootstrap: bootstrapJudge,
    }),
})

let started = false

/**
 * À appeler une fois au démarrage de l'app (`main.ts`) — idempotent. Charge
 * la file persistée et tente immédiatement un envoi, puis reste à l'écoute
 * du retour réseau et du retour au premier plan (SPEC.md § 6.3).
 */
export function startSyncRuntime(): void {
  if (started) return
  started = true
  void syncEngine.onStartup().then(() => refreshScheduler.request())
  window.addEventListener('online', () => {
    syncEngine.onOnline()
    void refreshScheduler.request()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      syncEngine.onVisible()
      void refreshScheduler.request()
    }
  })
  // Une actualisation reportée parce que la file n'était pas vide reprend dès
  // qu'elle se vide.
  syncEngine.subscribe((items) => {
    const waiting = items.some((item) => item.state === 'pending' || item.state === 'sending')
    if (!waiting) void refreshScheduler.onQueueIdle()
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
