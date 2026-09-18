import { describe, expect, it } from 'vitest'

import {
  judgeAscentBatchItemInputSchema,
  judgeAscentBatchResultSchema,
  judgeAscentsBatchInputSchema,
} from './judge-ascents-batch'

const ID_1 = '0189dcd5-5311-7d40-8db0-9496a2eef37b'
const ID_2 = '0189dcd5-5311-7d40-8db0-9496a2eef37c'
const ID_3 = '0189dcd5-5311-7d40-8db0-9496a2eef37d'
const ID_4 = '0189dcd5-5311-7d40-8db0-9496a2eef37e'

const validCreateItem = {
  kind: 'create' as const,
  id: ID_1,
  roundId: ID_2,
  routeId: ID_3,
  competitorId: ID_4,
  recordedAt: '2026-09-18T14:03:00.000Z',
  deviceId: 'device-1',
  holdNumber: 25,
  modifier: 'plus' as const,
  isTop: false,
  status: 'valid' as const,
}

const validCorrectItem = {
  kind: 'correct' as const,
  id: ID_1,
  supersedesId: ID_2,
  holdNumber: 30,
  modifier: 'none' as const,
  isTop: false,
  status: 'valid' as const,
}

describe('judgeAscentBatchItemInputSchema', () => {
  it('accepte un item de création valide', () => {
    expect(judgeAscentBatchItemInputSchema.safeParse(validCreateItem).success).toBe(true)
  })

  it('accepte un item de correction valide, avec supersedesId explicite', () => {
    expect(judgeAscentBatchItemInputSchema.safeParse(validCorrectItem).success).toBe(true)
  })

  it('refuse une correction sans supersedesId', () => {
    const withoutTarget = {
      kind: 'correct' as const,
      id: ID_1,
      holdNumber: 30,
      modifier: 'none' as const,
      isTop: false,
      status: 'valid' as const,
    }
    expect(judgeAscentBatchItemInputSchema.safeParse(withoutTarget).success).toBe(false)
  })

  it('refuse un kind inconnu', () => {
    expect(
      judgeAscentBatchItemInputSchema.safeParse({ ...validCreateItem, kind: 'delete' }).success,
    ).toBe(false)
  })

  it('refuse un DNS/DNF portant un numéro de prise (règle partagée par les deux variantes)', () => {
    expect(
      judgeAscentBatchItemInputSchema.safeParse({
        ...validCreateItem,
        status: 'dns',
        holdNumber: 10,
      }).success,
    ).toBe(false)
    expect(
      judgeAscentBatchItemInputSchema.safeParse({
        ...validCorrectItem,
        status: 'dnf',
        holdNumber: 10,
      }).success,
    ).toBe(false)
  })

  it('refuse un TOP portant un numéro de prise', () => {
    expect(
      judgeAscentBatchItemInputSchema.safeParse({
        ...validCreateItem,
        isTop: true,
        holdNumber: 10,
      }).success,
    ).toBe(false)
  })

  it('refuse un passage valide sans TOP sans numéro de prise', () => {
    expect(
      judgeAscentBatchItemInputSchema.safeParse({
        ...validCreateItem,
        isTop: false,
        holdNumber: null,
      }).success,
    ).toBe(false)
  })
})

describe('judgeAscentsBatchInputSchema', () => {
  it('accepte un lot mélangeant créations et corrections', () => {
    expect(
      judgeAscentsBatchInputSchema.safeParse({ items: [validCreateItem, validCorrectItem] })
        .success,
    ).toBe(true)
  })

  it('refuse un lot vide', () => {
    expect(judgeAscentsBatchInputSchema.safeParse({ items: [] }).success).toBe(false)
  })

  it('refuse un lot de plus de 50 éléments', () => {
    const items = Array.from({ length: 51 }, () => validCreateItem)
    expect(judgeAscentsBatchInputSchema.safeParse({ items }).success).toBe(false)
  })
})

describe('judgeAscentBatchResultSchema', () => {
  const ascent = {
    id: ID_1,
    competitionId: ID_2,
    roundId: ID_2,
    routeId: ID_3,
    competitorId: ID_4,
    holdNumber: 25,
    holdCount: 40,
    modifier: 'plus' as const,
    isTop: false,
    status: 'valid' as const,
    scoreValue: '25.5',
    climbTimeMs: null,
    recordedByJudgeId: ID_2,
    recordedByUserId: null,
    recordedAt: new Date('2026-09-18T14:03:00.000Z'),
    syncedAt: new Date('2026-09-18T15:20:00.000Z'),
    deviceId: 'device-1',
    supersededBy: null,
    conflictGroup: null,
    createdAt: new Date('2026-09-18T14:03:00.000Z'),
    updatedAt: new Date('2026-09-18T14:03:00.000Z'),
  }

  it('accepte un résultat accepted avec le passage complet', () => {
    expect(
      judgeAscentBatchResultSchema.safeParse({ id: ID_1, status: 'accepted', ascent }).success,
    ).toBe(true)
  })

  it('accepte un résultat conflict avec les deux valeurs', () => {
    expect(
      judgeAscentBatchResultSchema.safeParse({
        id: ID_1,
        status: 'conflict',
        conflictGroup: ID_2,
        existing: ascent,
        incoming: ascent,
      }).success,
    ).toBe(true)
  })

  it('accepte un résultat rejected avec un motif', () => {
    expect(
      judgeAscentBatchResultSchema.safeParse({
        id: ID_1,
        status: 'rejected',
        reason: 'Tour fermé.',
      }).success,
    ).toBe(true)
  })

  it('refuse un rejected sans motif', () => {
    expect(judgeAscentBatchResultSchema.safeParse({ id: ID_1, status: 'rejected' }).success).toBe(
      false,
    )
  })
})
