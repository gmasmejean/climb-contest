import { computeBackoffDelayMs } from './backoff'
import type { BatchResultItem, Clock, QueueItem, SyncQueueStorage, SyncTransport } from './types'

export interface SyncEngineOptions {
  /** Nombre maximal d'éléments envoyés dans un même lot. */
  maxBatchSize?: number
  /** Fenêtre de coalescence après un `enqueue()` avant le premier envoi. */
  debounceMs?: number
  clock?: Clock
}

type Listener<TPayload> = (items: QueueItem<TPayload>[]) => void

const DEFAULT_MAX_BATCH_SIZE = 25
const DEFAULT_DEBOUNCE_MS = 300

function realClock(): Clock {
  return { now: () => Date.now(), random: () => Math.random() }
}

/**
 * Machine à états de la file de synchronisation (SPEC.md § 6.3, ADR-014).
 *
 * `sending` est un état PUREMENT en mémoire, jamais persisté : un crash entre
 * le marquage "en cours d'envoi" et la réponse serveur laisse simplement
 * l'élément à son dernier état persisté (`pending`), immédiatement rejouable
 * au prochain démarrage — pas de récupération spéciale nécessaire. Un
 * élément ne quitte JAMAIS le stockage avant une réponse serveur nominative
 * (`acked`/`conflict`/`rejected`) — jamais sur timeout, erreur transport,
 * fermeture d'onglet ou redémarrage.
 */
export class SyncEngine<TPayload> {
  private items = new Map<string, QueueItem<TPayload>>()
  private readonly listeners = new Set<Listener<TPayload>>()
  private flushing = false
  private flushAgain = false
  private debounceTimer: ReturnType<typeof setTimeout> | undefined
  private readonly maxBatchSize: number
  private readonly debounceMs: number
  private readonly clock: Clock

  constructor(
    private readonly storage: SyncQueueStorage<TPayload>,
    private readonly transport: SyncTransport<TPayload>,
    options: SyncEngineOptions = {},
  ) {
    this.maxBatchSize = options.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS
    this.clock = options.clock ?? realClock()
  }

  /** Charge la file persistée en mémoire — à appeler une fois au démarrage. */
  async hydrate(): Promise<void> {
    const stored = await this.storage.getAll()
    this.items = new Map(stored.map((item) => [item.id, item]))
    this.notify()
  }

  /**
   * Écrit un nouvel élément à l'état `pending`, PERSISTE-le avant tout appel
   * réseau, notifie les abonnés (mise à jour optimiste), puis planifie un
   * envoi. `id` est fourni par l'appelant (uuid v7 généré à la saisie).
   */
  async enqueue(
    kind: 'create' | 'correct',
    payload: TPayload,
    id: string,
  ): Promise<QueueItem<TPayload>> {
    const now = this.clock.now()
    const item: QueueItem<TPayload> = {
      id,
      kind,
      payload,
      state: 'pending',
      attempts: 0,
      nextAttemptAt: 0,
      createdAt: now,
      updatedAt: now,
    }
    await this.storage.put(item)
    this.items.set(id, item)
    this.notify()
    this.scheduleFlush()
    return item
  }

  /** Retire un élément `rejected` de la vue active (ne le fait jamais pour un autre état). */
  async dismissRejected(id: string): Promise<void> {
    const item = this.items.get(id)
    if (!item || item.state !== 'rejected') return
    this.items.delete(id)
    await this.storage.remove(id)
    this.notify()
  }

  snapshot(): QueueItem<TPayload>[] {
    return [...this.items.values()]
  }

  subscribe(fn: Listener<TPayload>): () => void {
    this.listeners.add(fn)
    fn(this.snapshot())
    return () => {
      this.listeners.delete(fn)
    }
  }

  /**
   * Déclencheurs externes (SPEC.md § 6.3 : « reprise automatique au retour du
   * réseau, au retour au premier plan et au démarrage »). Chacun force les
   * éléments `pending` à redevenir immédiatement dus, sans attendre leur
   * délai de repli — sinon un élément dont le dernier essai a essuyé un long
   * backoff (jusqu'à 30 s) resterait bloqué après un retour réseau
   * pourtant explicite.
   */
  onOnline(): void {
    void this.retryNow()
  }

  onVisible(): void {
    void this.retryNow()
  }

  async onStartup(): Promise<void> {
    await this.hydrate()
    await this.retryNow()
  }

  private async retryNow(): Promise<void> {
    const now = this.clock.now()
    const reset: QueueItem<TPayload>[] = []
    for (const item of this.items.values()) {
      if (item.state === 'pending' && item.nextAttemptAt > now) {
        const updated = { ...item, nextAttemptAt: 0 }
        this.items.set(item.id, updated)
        reset.push(updated)
      }
    }
    if (reset.length > 0) {
      await this.storage.putMany(reset)
      this.notify()
    }
    await this.flush()
  }

  /**
   * Ramasse tous les éléments `pending` dus, jusqu'à `maxBatchSize`, les
   * envoie en un seul appel transport, applique chaque résultat. Ne
   * traite jamais deux lots en vol simultanément — un appel reçu pendant
   * qu'un flush est en cours est mémorisé et rejoué une fois celui-ci
   * terminé, pour ne jamais perdre un élément enfilé entre-temps.
   */
  async flush(): Promise<void> {
    if (this.flushing) {
      this.flushAgain = true
      return
    }
    this.flushing = true
    try {
      do {
        this.flushAgain = false
        for (;;) {
          const due = this.dueItems()
          if (due.length === 0) break
          await this.sendOne(due)
        }
      } while (this.flushAgain)
    } finally {
      this.flushing = false
    }
  }

  private dueItems(): QueueItem<TPayload>[] {
    const now = this.clock.now()
    return [...this.items.values()]
      .filter((item) => item.state === 'pending' && item.nextAttemptAt <= now)
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, this.maxBatchSize)
  }

  private async sendOne(due: QueueItem<TPayload>[]): Promise<void> {
    const sending = due.map((item) => ({ ...item, state: 'sending' as const }))
    for (const item of sending) this.items.set(item.id, item)
    this.notify()

    let results: BatchResultItem[]
    try {
      results = await this.transport.sendBatch(sending)
    } catch {
      await this.revertToPending(sending)
      return
    }
    await this.applyResults(sending, results)
  }

  private async revertToPending(items: QueueItem<TPayload>[]): Promise<void> {
    const now = this.clock.now()
    const reverted = items.map((item) => {
      const attempts = item.attempts + 1
      return {
        ...item,
        state: 'pending' as const,
        attempts,
        nextAttemptAt: now + computeBackoffDelayMs(attempts, this.clock),
        updatedAt: now,
      }
    })
    for (const item of reverted) this.items.set(item.id, item)
    await this.storage.putMany(reverted)
    this.notify()
  }

  private async applyResults(
    sent: QueueItem<TPayload>[],
    results: BatchResultItem[],
  ): Promise<void> {
    const resultById = new Map(results.map((result) => [result.id, result]))
    const now = this.clock.now()
    const toPersist: QueueItem<TPayload>[] = []
    const toRemove: string[] = []

    for (const item of sent) {
      const result = resultById.get(item.id)
      if (!result) {
        // Le serveur a répondu mais n'a rien dit de CET élément — jamais
        // abandonné silencieusement : traité comme un échec transport pour
        // ce seul élément.
        const attempts = item.attempts + 1
        const reverted: QueueItem<TPayload> = {
          ...item,
          state: 'pending',
          attempts,
          nextAttemptAt: now + computeBackoffDelayMs(attempts, this.clock),
          updatedAt: now,
        }
        this.items.set(item.id, reverted)
        toPersist.push(reverted)
        continue
      }

      if (result.status === 'accepted' || result.status === 'duplicate') {
        this.items.delete(item.id)
        toRemove.push(item.id)
        continue
      }

      if (result.status === 'conflict') {
        const updated: QueueItem<TPayload> = {
          ...item,
          state: 'conflict',
          updatedAt: now,
          conflict: {
            conflictGroup: result.conflictGroup,
            existing: result.existing,
            incoming: result.incoming,
          },
        }
        this.items.set(item.id, updated)
        toPersist.push(updated)
        continue
      }

      const rejected: QueueItem<TPayload> = {
        ...item,
        state: 'rejected',
        updatedAt: now,
        rejectedReason: result.reason,
      }
      this.items.set(item.id, rejected)
      toPersist.push(rejected)
    }

    if (toPersist.length > 0) await this.storage.putMany(toPersist)
    for (const id of toRemove) await this.storage.remove(id)
    this.notify()
  }

  private scheduleFlush(): void {
    if (this.debounceTimer !== undefined) return
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined
      void this.flush()
    }, this.debounceMs)
  }

  private notify(): void {
    const snapshot = this.snapshot()
    for (const listener of this.listeners) listener(snapshot)
  }
}
