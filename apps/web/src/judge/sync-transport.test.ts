import type { QueueItem } from '@climbcontest/sync'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { clearJudgeAccessRevoked, judgeAccessRevoked } from './access-state'
import type { QueuePayload } from './queue-payload'
import { HttpSyncTransport } from './sync-transport'

const ID = '0189dcd5-5311-7d40-8db0-9496a2eef37b'

const item: QueueItem<QueuePayload> = {
  id: ID,
  kind: 'create',
  payload: {
    kind: 'create',
    id: ID,
    roundId: ID,
    routeId: ID,
    competitorId: ID,
    holdNumber: 25,
    modifier: 'none',
    isTop: false,
    status: 'valid',
    recordedAt: '2026-09-21T10:00:00.000Z',
    deviceId: 'device-1',
  },
  state: 'sending',
  attempts: 0,
  nextAttemptAt: 0,
  createdAt: 1,
  updatedAt: 1,
}

function respondWith(body: unknown, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  clearJudgeAccessRevoked()
})

describe('HttpSyncTransport — accès révoqué (ADR-078)', () => {
  it('rend les résultats ET lève le drapeau quand le serveur signale la révocation', async () => {
    respondWith({ results: [{ id: ID, status: 'accepted', ascent: {} }], accessRevoked: true })
    const results = await new HttpSyncTransport().sendBatch([item])
    // La saisie est partie : elle sortira de la file comme n'importe quelle autre.
    expect(results).toEqual([{ id: ID, status: 'accepted', ascent: {} }])
    expect(judgeAccessRevoked.value).toBe(true)
  })

  it('ne lève rien pour un juge actif', async () => {
    respondWith({ results: [], accessRevoked: false })
    await new HttpSyncTransport().sendBatch([item])
    expect(judgeAccessRevoked.value).toBe(false)
  })

  it('une erreur HTTP remonte telle quelle : la file reste en attente', async () => {
    respondWith({ title: 'Erreur interne' }, 500)
    await expect(new HttpSyncTransport().sendBatch([item])).rejects.toThrow()
    expect(judgeAccessRevoked.value).toBe(false)
  })
})
