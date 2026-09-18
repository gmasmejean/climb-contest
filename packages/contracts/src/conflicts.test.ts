import { describe, expect, it } from 'vitest'

import { resolveConflictInputSchema } from './conflicts'

describe('resolveConflictInputSchema', () => {
  it('accepte le choix d’une valeur existante sans motif', () => {
    const result = resolveConflictInputSchema.safeParse({
      resolution: 'choose',
      ascentId: '0189dcd5-5311-7d40-8db0-9496a2eef37b',
    })
    expect(result.success).toBe(true)
  })

  it('refuse une nouvelle valeur sans motif', () => {
    const result = resolveConflictInputSchema.safeParse({
      resolution: 'new_value',
      holdNumber: 25,
      modifier: 'none',
      isTop: false,
      status: 'valid',
    })
    expect(result.success).toBe(false)
  })

  it('accepte une nouvelle valeur avec motif', () => {
    const result = resolveConflictInputSchema.safeParse({
      resolution: 'new_value',
      reason: 'Vérifié avec les deux juges après visionnage.',
      holdNumber: 25,
      modifier: 'none',
      isTop: false,
      status: 'valid',
    })
    expect(result.success).toBe(true)
  })

  it('accepte une nouvelle valeur en DSQ (réservé à l’organisateur)', () => {
    const result = resolveConflictInputSchema.safeParse({
      resolution: 'new_value',
      reason: 'Chute non contrôlée sur prise dangereuse, décision jury.',
      holdNumber: null,
      modifier: 'none',
      isTop: false,
      status: 'dsq',
    })
    expect(result.success).toBe(true)
  })

  it('refuse une résolution inconnue', () => {
    const result = resolveConflictInputSchema.safeParse({ resolution: 'ignore' })
    expect(result.success).toBe(false)
  })
})
