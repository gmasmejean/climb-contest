import type { BatchResultItem, QueueItem, SyncTransport } from '../types'

type ScriptedCall = { type: 'results'; results: BatchResultItem[] } | { type: 'fail' }

/**
 * Fake scriptable de `SyncTransport`, pour les tests de `SyncEngine`. Sans
 * script programmé, accepte tout par défaut. `queueFailure()` simule une
 * coupure réseau (aucune réponse pour aucun élément) pour le prochain appel.
 */
export class FakeTransport<TPayload> implements SyncTransport<TPayload> {
  readonly calls: QueueItem<TPayload>[][] = []
  private readonly scripted: ScriptedCall[] = []
  private fallback: (items: QueueItem<TPayload>[]) => BatchResultItem[] = (items) =>
    items.map((item) => ({ id: item.id, status: 'accepted' }))

  queueResults(results: BatchResultItem[]): void {
    this.scripted.push({ type: 'results', results })
  }

  queueFailure(): void {
    this.scripted.push({ type: 'fail' })
  }

  setFallback(fallback: (items: QueueItem<TPayload>[]) => BatchResultItem[]): void {
    this.fallback = fallback
  }

  sendBatch(items: QueueItem<TPayload>[]): Promise<BatchResultItem[]> {
    this.calls.push(items)
    const next = this.scripted.shift()
    if (!next) return Promise.resolve(this.fallback(items))
    if (next.type === 'fail') return Promise.reject(new Error('Coupure réseau simulée'))
    return Promise.resolve(next.results)
  }
}
