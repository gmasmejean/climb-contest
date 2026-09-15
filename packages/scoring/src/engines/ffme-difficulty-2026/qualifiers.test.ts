import { describe, expect, it } from 'vitest'

import type { RoundRanking } from '../../types'
import { getQualifiers } from './qualifiers'

describe('getQualifiers — SPEC.md §4.4 / §9', () => {
  it('Cas #19 — 10 qualifiés prévus, égalité aux places 10-11 → 11 qualifiés', () => {
    const ranking: RoundRanking = {
      entries: [
        ...Array.from({ length: 9 }, (_, i) => ({
          competitorId: `C${i + 1}`,
          rank: i + 1,
          combinedRank: i + 1,
        })),
        { competitorId: 'C10', rank: 10, combinedRank: 10 },
        { competitorId: 'C11', rank: 10, combinedRank: 10 },
      ],
    }

    const qualifiers = getQualifiers(ranking, 10)

    expect(qualifiers).toHaveLength(11)
    expect(qualifiers).toContain('C10')
    expect(qualifiers).toContain('C11')
  })

  it('qualifie tout le monde si qualifyingCount dépasse le nombre de participants', () => {
    const ranking: RoundRanking = {
      entries: [
        { competitorId: 'A', rank: 1, combinedRank: 1 },
        { competitorId: 'B', rank: 2, combinedRank: 2 },
      ],
    }

    expect(getQualifiers(ranking, 10)).toEqual(['A', 'B'])
  })

  it('sans égalité à la limite, exactement qualifyingCount compétiteurs qualifient', () => {
    const ranking: RoundRanking = {
      entries: [
        { competitorId: 'A', rank: 1, combinedRank: 1 },
        { competitorId: 'B', rank: 2, combinedRank: 2 },
        { competitorId: 'C', rank: 3, combinedRank: 3 },
      ],
    }

    expect(getQualifiers(ranking, 2)).toEqual(['A', 'B'])
  })

  it('lève une erreur explicite si qualifyingCount est inférieur à 1', () => {
    expect(() => getQualifiers({ entries: [] }, 0)).toThrow(/entier positif/)
  })
})
