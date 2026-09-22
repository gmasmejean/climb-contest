import type { JudgeRouteDetail } from '@climbcontest/contracts'
import type { QueueItem } from '@climbcontest/sync'
import { describe, expect, it } from 'vitest'

import { describeAscentValue, describeQueueItems } from './queue-description'
import type { QueuePayload } from './queue-payload'

const ROUTE_ID = '0189dcd5-5311-7d40-8db0-9496a2eef301'
const COMPETITOR_ID = '0189dcd5-5311-7d40-8db0-9496a2eef302'
const ROUND_ID = '0189dcd5-5311-7d40-8db0-9496a2eef303'

const detail: JudgeRouteDetail = {
  route: { id: ROUTE_ID, number: 3, name: 'La dalle', holdCount: 40, categories: [], photo: null },
  round: { id: ROUND_ID, type: 'qualification' },
  timingEnabled: false,
  competitors: [
    {
      id: COMPETITOR_ID,
      bib: 47,
      firstName: 'Léa',
      lastName: 'Martin',
      categoryLabel: 'U16 F',
      ascent: null,
    },
  ],
}

function item(
  overrides: Partial<QueueItem<QueuePayload>> & { id: string },
): QueueItem<QueuePayload> {
  return {
    kind: 'create',
    payload: {
      kind: 'create',
      id: overrides.id,
      roundId: ROUND_ID,
      routeId: ROUTE_ID,
      competitorId: COMPETITOR_ID,
      holdNumber: 25,
      modifier: 'plus',
      isTop: false,
      status: 'valid',
      recordedAt: '2026-09-21T10:00:00.000Z',
      deviceId: 'device-1',
    },
    state: 'pending',
    attempts: 0,
    nextAttemptAt: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('describeAscentValue', () => {
  it('écrit chaque forme de résultat en clair', () => {
    const base = { holdNumber: 25, modifier: 'none' as const, isTop: false, status: 'valid' as const }
    expect(describeAscentValue(base)).toBe('prise 25')
    expect(describeAscentValue({ ...base, modifier: 'plus' })).toBe('prise 25+')
    expect(describeAscentValue({ ...base, holdNumber: null, isTop: true })).toBe('TOP')
    expect(describeAscentValue({ ...base, holdNumber: null, status: 'dns' })).toBe('DNS')
    expect(describeAscentValue({ ...base, holdNumber: null, status: 'dnf' })).toBe('DNF')
  })
})

describe('describeQueueItems', () => {
  it('nomme le compétiteur et la voie depuis le cache local', () => {
    expect(describeQueueItems([item({ id: 'a' })], [detail])).toEqual([
      {
        id: 'a',
        competitor: 'Dossard 47 — Léa Martin',
        route: 'Voie 3 — La dalle',
        value: 'prise 25+',
        state: 'pending',
        reason: null,
      },
    ])
  })

  it('le dit quand le cache local ne connaît plus la voie, sans rien inventer', () => {
    const [described] = describeQueueItems([item({ id: 'a' })], [])
    expect(described?.route).toBe('Voie inconnue de ce téléphone')
    expect(described?.competitor).toBe('Compétiteur inconnu de ce téléphone')
  })

  it('porte le motif d’un élément refusé et garde l’ordre de saisie', () => {
    const described = describeQueueItems(
      [
        item({ id: 'b', createdAt: 2, state: 'rejected', rejectedReason: 'Tour fermé.' }),
        item({ id: 'a', createdAt: 1 }),
      ],
      [detail],
    )
    expect(described.map((d) => d.id)).toEqual(['a', 'b'])
    expect(described[1]?.reason).toBe('Tour fermé.')
  })
})
