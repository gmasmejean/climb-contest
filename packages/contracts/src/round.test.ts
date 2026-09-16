import { describe, expect, it } from 'vitest'

import { createRoundInputSchema, setRoundRoutesInputSchema } from './round'

describe('createRoundInputSchema', () => {
  it('accepte un tour de qualification sans nombre de qualifiés', () => {
    const result = createRoundInputSchema.safeParse({ type: 'qualification', style: 'flash' })
    expect(result.success).toBe(true)
  })

  it('refuse un type de tour inconnu', () => {
    const result = createRoundInputSchema.safeParse({ type: 'demi-finale', style: 'flash' })
    expect(result.success).toBe(false)
  })

  it('refuse un nombre de qualifiés négatif', () => {
    const result = createRoundInputSchema.safeParse({
      type: 'semifinal',
      style: 'onsight',
      qualifyingCount: -1,
    })
    expect(result.success).toBe(false)
  })
})

describe('setRoundRoutesInputSchema', () => {
  it('accepte une liste vide (retire toutes les affectations du tour)', () => {
    expect(setRoundRoutesInputSchema.safeParse({ assignments: [] }).success).toBe(true)
  })

  it('accepte plusieurs affectations voie × catégorie', () => {
    const routeId1 = '0189dcd5-5311-7d40-8db0-9496a2eef37b'
    const routeId2 = '0189dcd5-5311-7d40-8db0-9496a2eef37c'
    const categoryId = '0189dcd5-5311-7d40-8db0-9496a2eef37d'
    const result = setRoundRoutesInputSchema.safeParse({
      assignments: [
        { routeId: routeId1, categoryId },
        { routeId: routeId2, categoryId },
      ],
    })
    expect(result.success).toBe(true)
  })

  it('refuse un identifiant de voie mal formé', () => {
    const result = setRoundRoutesInputSchema.safeParse({
      assignments: [{ routeId: 'r1', categoryId: '0189dcd5-5311-7d40-8db0-9496a2eef37b' }],
    })
    expect(result.success).toBe(false)
  })
})
