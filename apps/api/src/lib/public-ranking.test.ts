import { describe, expect, it } from 'vitest'

import { mergeRosterWithDnsPlaceholders } from './public-ranking'

describe('mergeRosterWithDnsPlaceholders — précondition ADR-021 de rankRound', () => {
  it('reprend le passage réel de chaque membre du roster qui a grimpé', () => {
    const merged = mergeRosterWithDnsPlaceholders(
      ['a', 'b'],
      [
        {
          competitorId: 'a',
          routeId: 'r1',
          holdNumber: 25,
          holdCount: 40,
          modifier: 'plus',
          isTop: false,
          status: 'valid',
          climbTimeMs: null,
        },
        {
          competitorId: 'b',
          routeId: 'r1',
          holdNumber: null,
          holdCount: 40,
          modifier: 'none',
          isTop: true,
          status: 'valid',
          climbTimeMs: null,
        },
      ],
      40,
    )

    expect(merged.get('a')).toEqual({
      competitorId: 'a',
      holdNumber: 25,
      holdCount: 40,
      modifier: 'plus',
      isTop: false,
      status: 'valid',
      climbTimeMs: null,
    })
    expect(merged.get('b')?.isTop).toBe(true)
  })

  it('synthétise un DNS pour tout membre du roster absent des lignes réelles de cette voie', () => {
    const merged = mergeRosterWithDnsPlaceholders(['a', 'b', 'c'], [], 40)

    expect(merged.size).toBe(3)
    for (const competitorId of ['a', 'b', 'c']) {
      expect(merged.get(competitorId)).toEqual({
        competitorId,
        holdNumber: null,
        holdCount: 40,
        modifier: 'none',
        isTop: false,
        status: 'dns',
        climbTimeMs: null,
      })
    }
  })

  it("ignore une ligne réelle pour un compétiteur hors roster (ex. déjà éliminé au tour précédent)", () => {
    const merged = mergeRosterWithDnsPlaceholders(
      ['a'],
      [
        {
          competitorId: 'a',
          routeId: 'r1',
          holdNumber: 30,
          holdCount: 40,
          modifier: 'none',
          isTop: false,
          status: 'valid',
          climbTimeMs: null,
        },
        {
          competitorId: 'ghost',
          routeId: 'r1',
          holdNumber: 10,
          holdCount: 40,
          modifier: 'none',
          isTop: false,
          status: 'valid',
          climbTimeMs: null,
        },
      ],
      40,
    )

    expect(merged.size).toBe(1)
    expect(merged.has('ghost')).toBe(false)
  })

  it('produit un roster vide sans erreur (catégorie sans compétiteur)', () => {
    const merged = mergeRosterWithDnsPlaceholders([], [], 40)
    expect(merged.size).toBe(0)
  })
})
