import type { QueueItem } from '@climbcontest/sync'
import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'

import { JudgeDatabase } from './local-db'
import type { QueuePayload } from './queue-payload'

// Fichier à part : la base `climbcontest-judge` doit être créée en version 1
// AVANT que le singleton `judgeDb` ne l'ouvre, ce que seul un fichier de test
// isolé garantit.

function makeItem(id: string): QueueItem<QueuePayload> {
  return {
    id,
    kind: 'create',
    payload: {
      kind: 'create',
      id,
      roundId: 'round-1',
      routeId: 'route-1',
      competitorId: `comp-${id}`,
      recordedAt: '2026-09-20T10:00:00.000Z',
      deviceId: 'device-1',
      holdNumber: 10,
      modifier: 'none',
      isTop: false,
      status: 'valid',
      climbTimeMs: null,
    },
    state: 'pending',
    attempts: 0,
    nextAttemptAt: 0,
    createdAt: 1,
    updatedAt: 1,
  }
}

/** La base telle que la version précédente de l'appli (avant le Lot 15) l'a laissée sur le téléphone. */
class JudgeDatabaseV1 extends Dexie {
  constructor() {
    super('climbcontest-judge')
    this.version(1).stores({
      routeDetails: 'routeId',
      queue: 'id',
      meta: 'key',
      lastSubmission: 'key',
    })
  }
}

describe('migration Dexie v1 → v2 (Lot 15, ADR-066)', () => {
  it('ajoute routePhotos sans toucher à la file d’envoi ni aux voies déjà téléchargées', async () => {
    const before = new JudgeDatabaseV1()
    const items = Array.from({ length: 12 }, (_, i) => makeItem(`ascent-${i}`))
    await before.table('queue').bulkPut(items)
    await before.table('routeDetails').put({ routeId: 'route-1', detail: { kept: true } })
    await before.table('meta').put({
      key: 'judge',
      judgeId: 'judge-1',
      displayName: 'Juge Test',
      fetchedAt: '2026-09-20T10:00:00.000Z',
    })
    before.close()

    const after = new JudgeDatabase()
    await after.open()

    // Rien n'a été perdu : c'est la règle « une action de juge n'est jamais perdue ».
    const queue = await after.queue.toArray()
    expect(queue).toHaveLength(12)
    expect(queue.every((item) => item.state === 'pending')).toBe(true)
    expect(new Set(queue.map((item) => item.id))).toEqual(new Set(items.map((item) => item.id)))
    expect((await after.routeDetails.get('route-1'))?.detail).toEqual({ kept: true })
    expect((await after.meta.get('judge'))?.judgeId).toBe('judge-1')

    // La nouvelle table existe, vide, et accepte des octets.
    expect(await after.routePhotos.count()).toBe(0)
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]).buffer
    await after.routePhotos.put({
      routeId: 'route-1',
      assetId: 'asset-1',
      mimeType: 'image/jpeg',
      bytes,
    })
    const stored = await after.routePhotos.get('route-1')
    expect(stored?.assetId).toBe('asset-1')
    expect([...new Uint8Array(stored?.bytes ?? new ArrayBuffer(0))]).toEqual([
      0xff, 0xd8, 0xff, 1, 2, 3,
    ])
    after.close()
  })
})
