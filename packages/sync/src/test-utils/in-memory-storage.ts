import type { QueueItem, SyncQueueStorage } from '../types'

/** Fake en mémoire de `SyncQueueStorage`, pour les tests de `SyncEngine`. */
export class InMemoryQueueStorage<TPayload> implements SyncQueueStorage<TPayload> {
  private readonly items = new Map<string, QueueItem<TPayload>>()

  getAll(): Promise<QueueItem<TPayload>[]> {
    return Promise.resolve([...this.items.values()])
  }

  put(item: QueueItem<TPayload>): Promise<void> {
    this.items.set(item.id, item)
    return Promise.resolve()
  }

  putMany(items: QueueItem<TPayload>[]): Promise<void> {
    for (const item of items) this.items.set(item.id, item)
    return Promise.resolve()
  }

  remove(id: string): Promise<void> {
    this.items.delete(id)
    return Promise.resolve()
  }
}
