import type { QueueItem } from '@climbcontest/sync'
import { beforeEach, describe, expect, it } from 'vitest'

import { saveAscentDraft } from './ascent-draft'
import { JudgeDatabase, UnsentAscentsError, judgeDb, resetJudgeDatabase } from './local-db'
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

describe('resetJudgeDatabase — ne vide jamais une file en attente (ADR-079)', () => {
  beforeEach(async () => {
    await judgeDb.queue.clear()
  })

  it('refuse de vider la base tant qu’une saisie n’est pas partie, et ne touche à rien', async () => {
    await judgeDb.queue.bulkPut([makeItem('ascent-a', 'comp-a'), makeItem('ascent-b', 'comp-b')])
    await judgeDb.meta.put({
      key: 'judge',
      judgeId: 'judge-1',
      displayName: 'Paul',
      fetchedAt: new Date().toISOString(),
    })

    await expect(resetJudgeDatabase()).rejects.toBeInstanceOf(UnsentAscentsError)

    expect(await judgeDb.queue.count()).toBe(2)
    expect(await judgeDb.meta.get('judge')).toBeDefined()
  })

  it('refuse aussi pour une saisie refusée par le serveur : elle n’existe que sur ce téléphone', async () => {
    await judgeDb.queue.put({
      ...makeItem('ascent-r', 'comp-r'),
      state: 'rejected',
      rejectedReason: 'Tour fermé.',
    })
    await expect(resetJudgeDatabase()).rejects.toBeInstanceOf(UnsentAscentsError)
  })

  it('accepte quand il ne reste que des conflits : le serveur détient déjà les deux valeurs', async () => {
    await judgeDb.queue.put({ ...makeItem('ascent-c', 'comp-c'), state: 'conflict' })
    await resetJudgeDatabase()
    expect(await judgeDb.queue.count()).toBe(0)
  })
})

describe('resetJudgeDatabase — changement de juge (ADR-036)', () => {
  beforeEach(async () => {
    await judgeDb.queue.clear()
  })

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
  beforeEach(async () => {
    await judgeDb.queue.clear()
  })

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
