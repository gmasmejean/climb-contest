/**
 * Machine à états de la file de synchronisation hors ligne du juge
 * (SPEC.md § 6.3, ADR-014). Zéro dépendance à Vue ou à un IndexedDB réel :
 * `apps/web` fournit les implémentations réelles de `SyncQueueStorage` et
 * `SyncTransport`, les tests de ce paquet des fakes en mémoire.
 */

export type QueueItemState = 'pending' | 'sending' | 'acked' | 'conflict' | 'rejected'

export interface QueueItemConflict {
  conflictGroup: string
  existing: unknown
  incoming: unknown
}

export interface QueueItem<TPayload> {
  /** uuid v7 généré à l'enqueue — c'est aussi l'id envoyé au serveur. */
  id: string
  kind: 'create' | 'correct'
  payload: TPayload
  state: QueueItemState
  attempts: number
  /** Epoch ms — 0 = éligible immédiatement. */
  nextAttemptAt: number
  createdAt: number
  updatedAt: number
  /** Présent uniquement quand `state === 'rejected'`. */
  rejectedReason?: string
  /** Présent uniquement quand `state === 'conflict'`. */
  conflict?: QueueItemConflict
}

export type BatchResultItem =
  | { id: string; status: 'accepted' }
  | { id: string; status: 'duplicate' }
  | { id: string; status: 'conflict'; conflictGroup: string; existing: unknown; incoming: unknown }
  | { id: string; status: 'rejected'; reason: string }

export interface SyncQueueStorage<TPayload> {
  getAll(): Promise<QueueItem<TPayload>[]>
  put(item: QueueItem<TPayload>): Promise<void>
  putMany(items: QueueItem<TPayload>[]): Promise<void>
  remove(id: string): Promise<void>
}

export interface SyncTransport<TPayload> {
  /**
   * Une seule requête HTTP pour tout le sous-ensemble fourni. Rejette la
   * promesse si AUCUNE réponse n'a pu être obtenue (réseau, timeout, 5xx) —
   * ne rejette jamais partiellement : soit une liste de résultats par id,
   * soit une exception globale.
   */
  sendBatch(items: QueueItem<TPayload>[]): Promise<BatchResultItem[]>
}

export interface Clock {
  now(): number
  /** Seam de test pour le jitter — doit renvoyer une valeur dans [0, 1). */
  random(): number
}
