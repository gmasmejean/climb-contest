import type { QueueItem, SyncQueueStorage } from '@climbcontest/sync'

import { judgeDb } from './local-db'
import type { QueuePayload } from './queue-payload'

/** Implémentation Dexie de `SyncQueueStorage` (packages/sync, ADR-014). */
export class DexieQueueStorage implements SyncQueueStorage<QueuePayload> {
  getAll(): Promise<QueueItem<QueuePayload>[]> {
    return judgeDb.queue.toArray()
  }

  async putMany(items: QueueItem<QueuePayload>[]): Promise<void> {
    await judgeDb.queue.bulkPut(items)
  }

  async put(item: QueueItem<QueuePayload>): Promise<void> {
    await judgeDb.queue.put(item)
  }

  async remove(id: string): Promise<void> {
    await judgeDb.queue.delete(id)
  }
}
