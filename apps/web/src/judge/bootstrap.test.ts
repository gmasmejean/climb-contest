import type { JudgeBootstrapResponse } from '@climbcontest/contracts'
import type { QueueItem, QueueItemState } from '@climbcontest/sync'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { QueuePayload } from './queue-payload'

const judgeFetch = vi.fn<() => Promise<JudgeBootstrapResponse>>()
vi.mock('../api/judge-client', () => ({
  judgeFetch: (...args: unknown[]) => judgeFetch(...(args as [])),
}))

const { bootstrapJudge, preserveHeldAscents } = await import('./bootstrap')
const { judgeDb } = await import('./local-db')

const JUDGE_ID = '00000000-0000-4000-8000-0000000000a1'
const OTHER_JUDGE_ID = '00000000-0000-4000-8000-0000000000a2'
const ROUTE_ID = '00000000-0000-4000-8000-0000000000b1'

function bootstrapResponse(judgeId: string, roundOpen: boolean): JudgeBootstrapResponse {
  return {
    fetchedAt: '2026-09-19T10:00:00.000Z',
    judge: { id: judgeId, displayName: 'Juge Test' },
    routes: [
      {
        route: { id: ROUTE_ID, number: 3, name: null, holdCount: 40, categories: [] },
        round: roundOpen ? { id: '00000000-0000-4000-8000-0000000000c1', type: 'semifinal' } : null,
        timingEnabled: false,
        competitors: [],
      },
    ],
  }
}

function queueItem(id: string, state: QueueItemState): QueueItem<QueuePayload> {
  return {
    id,
    kind: 'create',
    payload: {
      kind: 'create',
      id,
      roundId: 'round-1',
      routeId: ROUTE_ID,
      competitorId: 'comp-1',
      recordedAt: '2026-09-19T10:00:00.000Z',
      deviceId: 'device-1',
      holdNumber: 10,
      modifier: 'none',
      isTop: false,
      status: 'valid',
      climbTimeMs: null,
    },
    state,
    attempts: 0,
    nextAttemptAt: 0,
    createdAt: 1,
    updatedAt: 1,
  }
}

async function storedRound() {
  return (await judgeDb.routeDetails.get(ROUTE_ID))?.detail.round ?? null
}

beforeEach(async () => {
  judgeFetch.mockReset()
  await judgeDb.routeDetails.clear()
  await judgeDb.queue.clear()
  await judgeDb.meta.clear()
})

describe('bootstrapJudge — écriture inconditionnelle (connexion)', () => {
  it('écrit les voies même avec une file non vide (comportement d’origine)', async () => {
    await judgeDb.queue.put(queueItem('a', 'pending'))
    judgeFetch.mockResolvedValue(bootstrapResponse(JUDGE_ID, true))

    expect(await bootstrapJudge()).toBe('written')
    expect(await storedRound()).not.toBeNull()
  })
})

describe('bootstrapJudge({ onlyIfQueueIdle }) — actualisation sûre (ADR-055)', () => {
  it('écrit le nouveau tour quand la file est vide', async () => {
    judgeFetch.mockResolvedValue(bootstrapResponse(JUDGE_ID, false))
    await bootstrapJudge()
    expect(await storedRound()).toBeNull()

    judgeFetch.mockResolvedValue(bootstrapResponse(JUDGE_ID, true))
    expect(await bootstrapJudge({ onlyIfQueueIdle: true })).toBe('written')
    expect((await storedRound())?.type).toBe('semifinal')
  })

  it.each<QueueItemState>(['pending', 'sending'])(
    'ne touche à rien quand un élément est %s',
    async (state) => {
      judgeFetch.mockResolvedValue(bootstrapResponse(JUDGE_ID, false))
      await bootstrapJudge()
      await judgeDb.queue.put(queueItem('a', state))
      judgeFetch.mockResolvedValue(bootstrapResponse(JUDGE_ID, true))

      expect(await bootstrapJudge({ onlyIfQueueIdle: true })).toBe('skipped')
      expect(await storedRound()).toBeNull()
      expect(await judgeDb.queue.count()).toBe(1)
    },
  )

  it.each<QueueItemState>(['acked', 'conflict', 'rejected'])(
    'n’est pas bloquée par un élément %s',
    async (state) => {
      judgeFetch.mockResolvedValue(bootstrapResponse(JUDGE_ID, false))
      await bootstrapJudge()
      await judgeDb.queue.put(queueItem('a', state))
      judgeFetch.mockResolvedValue(bootstrapResponse(JUDGE_ID, true))

      expect(await bootstrapJudge({ onlyIfQueueIdle: true })).toBe('written')
      expect(await storedRound()).not.toBeNull()
      // L'élément de file, lui, n'est jamais supprimé.
      expect(await judgeDb.queue.count()).toBe(1)
    },
  )

  it('une saisie enregistrée PENDANT le téléchargement fait renoncer à l’écriture', async () => {
    judgeFetch.mockResolvedValue(bootstrapResponse(JUDGE_ID, false))
    await bootstrapJudge()

    // Le juge enregistre une saisie pendant que le réseau répond.
    judgeFetch.mockImplementation(async () => {
      await judgeDb.queue.put(queueItem('during-download', 'pending'))
      return bootstrapResponse(JUDGE_ID, true)
    })

    expect(await bootstrapJudge({ onlyIfQueueIdle: true })).toBe('skipped')
    expect(await storedRound()).toBeNull()
  })

  it('ne vide jamais la base quand le cache appartient à un autre juge', async () => {
    judgeFetch.mockResolvedValue(bootstrapResponse(OTHER_JUDGE_ID, false))
    await bootstrapJudge()
    await judgeDb.queue.put(queueItem('autre-juge', 'acked'))
    judgeFetch.mockResolvedValue(bootstrapResponse(JUDGE_ID, true))

    expect(await bootstrapJudge({ onlyIfQueueIdle: true })).toBe('skipped')
    expect((await judgeDb.meta.get('judge'))?.judgeId).toBe(OTHER_JUDGE_ID)
    expect(await judgeDb.queue.count()).toBe(1)
  })

  it('propage une erreur réseau sans rien écrire', async () => {
    judgeFetch.mockResolvedValue(bootstrapResponse(JUDGE_ID, false))
    await bootstrapJudge()
    judgeFetch.mockRejectedValue(new Error('Réseau coupé'))

    await expect(bootstrapJudge({ onlyIfQueueIdle: true })).rejects.toThrow('Réseau coupé')
    expect(await storedRound()).toBeNull()
  })
})

// --- Conservation des saisies en conflit / rejetées (ADR-055) ---

const ROUND_ID = '00000000-0000-4000-8000-0000000000c1'
const OTHER_ROUND_ID = '00000000-0000-4000-8000-0000000000c2'
const COMPETITOR_ID = '00000000-0000-4000-8000-0000000000d1'

const localAscent = {
  id: '00000000-0000-4000-8000-0000000000e1',
  holdNumber: 20,
  modifier: 'none' as const,
  isTop: false,
  status: 'valid' as const,
  climbTimeMs: null,
  recordedAt: '2026-09-19T10:00:00.000Z',
}

function detailWith(
  roundId: string | null,
  ascent: typeof localAscent | null,
): JudgeBootstrapResponse['routes'][number] {
  return {
    route: { id: ROUTE_ID, number: 3, name: null, holdCount: 40, categories: [] },
    round: roundId ? { id: roundId, type: 'semifinal' } : null,
    timingEnabled: false,
    competitors: [
      {
        id: COMPETITOR_ID,
        bib: 7,
        firstName: 'Léa',
        lastName: 'Martin',
        categoryLabel: 'U16',
        ascent,
      },
    ],
  }
}

function heldItem(state: QueueItemState): QueueItem<QueuePayload> {
  return {
    ...queueItem('held', state),
    payload: { ...queueItem('held', state).payload, competitorId: COMPETITOR_ID },
  }
}

describe('preserveHeldAscents', () => {
  it.each<QueueItemState>(['conflict', 'rejected'])(
    'garde la saisie locale « faite » quand le serveur n’a aucun passage actif (%s)',
    (state) => {
      const merged = preserveHeldAscents(
        [detailWith(ROUND_ID, localAscent)],
        [detailWith(ROUND_ID, null)],
        [heldItem(state)],
      )
      expect(merged[0]?.competitors[0]?.ascent).toEqual(localAscent)
    },
  )

  it('sans élément retenu, la vérité du serveur l’emporte (le compétiteur repasse à faire)', () => {
    const merged = preserveHeldAscents(
      [detailWith(ROUND_ID, localAscent)],
      [detailWith(ROUND_ID, null)],
      [],
    )
    expect(merged[0]?.competitors[0]?.ascent).toBeNull()
  })

  it('ne remplace jamais un passage que le serveur connaît', () => {
    const serverAscent = {
      ...localAscent,
      id: '00000000-0000-4000-8000-0000000000e2',
      holdNumber: 33,
    }
    const merged = preserveHeldAscents(
      [detailWith(ROUND_ID, localAscent)],
      [detailWith(ROUND_ID, serverAscent)],
      [heldItem('conflict')],
    )
    expect(merged[0]?.competitors[0]?.ascent).toEqual(serverAscent)
  })

  it('ne conserve rien quand la voie est passée à un autre tour', () => {
    const merged = preserveHeldAscents(
      [detailWith(ROUND_ID, localAscent)],
      [detailWith(OTHER_ROUND_ID, null)],
      [heldItem('conflict')],
    )
    expect(merged[0]?.competitors[0]?.ascent).toBeNull()
  })

  it('ne conserve rien quand la voie n’a plus de tour ouvert', () => {
    const merged = preserveHeldAscents(
      [detailWith(ROUND_ID, localAscent)],
      [detailWith(null, null)],
      [heldItem('conflict')],
    )
    expect(merged[0]?.competitors[0]?.ascent).toBeNull()
  })
})

describe('bootstrapJudge({ onlyIfQueueIdle }) — conflit conservé de bout en bout', () => {
  it('une saisie en conflit reste « faite » après l’actualisation', async () => {
    judgeFetch.mockResolvedValue({
      ...bootstrapResponse(JUDGE_ID, true),
      routes: [detailWith(ROUND_ID, localAscent)],
    })
    await bootstrapJudge()
    await judgeDb.queue.put(heldItem('conflict'))
    judgeFetch.mockResolvedValue({
      ...bootstrapResponse(JUDGE_ID, true),
      routes: [detailWith(ROUND_ID, null)],
    })

    expect(await bootstrapJudge({ onlyIfQueueIdle: true })).toBe('written')

    const stored = (await judgeDb.routeDetails.get(ROUTE_ID))?.detail
    expect(stored?.competitors[0]?.ascent).toEqual(localAscent)
  })

  it('la connexion (sans option) repart toujours de la vérité du serveur', async () => {
    judgeFetch.mockResolvedValue({
      ...bootstrapResponse(JUDGE_ID, true),
      routes: [detailWith(ROUND_ID, localAscent)],
    })
    await bootstrapJudge()
    await judgeDb.queue.put(heldItem('conflict'))
    judgeFetch.mockResolvedValue({
      ...bootstrapResponse(JUDGE_ID, true),
      routes: [detailWith(ROUND_ID, null)],
    })

    await bootstrapJudge()

    expect((await judgeDb.routeDetails.get(ROUTE_ID))?.detail.competitors[0]?.ascent).toBeNull()
  })
})
