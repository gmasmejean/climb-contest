import type { QueueItem } from '@climbcontest/sync'
import { describe, expect, it } from 'vitest'

import { saveAscentDraft } from './ascent-draft'
import { JudgeDatabase, judgeDb, resetJudgeDatabase } from './local-db'
import type { QueuePayload } from './queue-payload'

function makeItem(id: string, competitorId: string): QueueItem<QueuePayload> {
  return {
    id,
    kind: 'create',
    payload: {
      kind: 'create',
      id,
      roundId: 'round-1',
      routeId: 'route-1',
      competitorId,
      recordedAt: new Date().toISOString(),
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
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

describe('JudgeDatabase — durabilité (cas SPEC.md § 9 #23)', () => {
  it('12 saisies en attente survivent à la fermeture et à la réouverture de la base (fermeture d’onglet)', async () => {
    const db1 = new JudgeDatabase()
    const items = Array.from({ length: 12 }, (_, i) => makeItem(`ascent-${i}`, `comp-${i}`))
    await db1.queue.bulkPut(items)
    db1.close()

    // Réouverture — même nom de base (`climbcontest-judge`), simule un
    // nouvel onglet/redémarrage lisant l'IndexedDB déjà écrite sur l'appareil.
    const db2 = new JudgeDatabase()
    const reloaded = await db2.queue.toArray()

    expect(reloaded).toHaveLength(12)
    expect(reloaded.every((item) => item.state === 'pending')).toBe(true)
    expect(new Set(reloaded.map((item) => item.id))).toEqual(new Set(items.map((item) => item.id)))

    db2.close()
  })
})

describe('resetJudgeDatabase — changement de juge (ADR-036)', () => {
  it('supprime aussi le brouillon de saisie du juge précédent (ADR-061)', async () => {
    saveAscentDraft(
      { routeId: 'route-1', competitorId: 'comp-1', baseAscentId: null, holdCount: 40 },
      { holdNumber: 12, modifier: 'none', isTop: false, status: 'valid', climbTimeMs: null },
      Date.now(),
    )
    expect(localStorage.getItem('climbcontest.judge.ascentDraft')).not.toBeNull()

    await resetJudgeDatabase()

    expect(localStorage.getItem('climbcontest.judge.ascentDraft')).toBeNull()
  })
})

describe('resetJudgeDatabase — photos de voie (ADR-066)', () => {
  it('supprime aussi les photos du juge précédent', async () => {
    await judgeDb.routePhotos.put({
      routeId: 'route-1',
      assetId: 'asset-1',
      mimeType: 'image/jpeg',
      bytes: new Uint8Array([0xff, 0xd8, 0xff]).buffer,
    })

    await resetJudgeDatabase()

    expect(await judgeDb.routePhotos.count()).toBe(0)
  })
})
