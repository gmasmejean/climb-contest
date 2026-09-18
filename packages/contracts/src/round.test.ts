import { describe, expect, it } from 'vitest'

import {
  changeRoundStatusInputSchema,
  createRoundInputSchema,
  ROUND_STATUS_TRANSITIONS,
  setRoundRoutesInputSchema,
  updateRoundInputSchema,
} from './round'

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

describe('updateRoundInputSchema', () => {
  it('refuse le champ status — un seul chemin d’écriture, changeRoundStatusInputSchema (Lot 8)', () => {
    const result = updateRoundInputSchema.safeParse({ status: 'open' })
    // `.partial()` sans `status` dans sa forme : le champ est simplement
    // ignoré (strip), pas rejeté — mais il ne doit plus être PERSISTÉ par la
    // route qui l'utilise, ce que ce test ne peut pas vérifier seul.
    expect(result.success).toBe(true)
    expect(result.success && 'status' in result.data).toBe(false)
  })
})

describe('changeRoundStatusInputSchema', () => {
  it('accepte chaque valeur de statut', () => {
    for (const status of ['draft', 'open', 'closed', 'published'] as const) {
      expect(changeRoundStatusInputSchema.safeParse({ status }).success).toBe(true)
    }
  })

  it('refuse un statut inconnu', () => {
    expect(changeRoundStatusInputSchema.safeParse({ status: 'archived' }).success).toBe(false)
  })
})

describe('ROUND_STATUS_TRANSITIONS', () => {
  it('est séquentiel, avec réouverture et dépublication possibles', () => {
    expect(ROUND_STATUS_TRANSITIONS.draft).toEqual(['open'])
    expect(ROUND_STATUS_TRANSITIONS.open).toEqual(['closed'])
    expect(ROUND_STATUS_TRANSITIONS.closed).toEqual(['open', 'published'])
    expect(ROUND_STATUS_TRANSITIONS.published).toEqual(['closed'])
  })

  it('n’autorise jamais de sauter directement à published depuis draft ou open', () => {
    expect(ROUND_STATUS_TRANSITIONS.draft).not.toContain('published')
    expect(ROUND_STATUS_TRANSITIONS.open).not.toContain('published')
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
