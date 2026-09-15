import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { assignRanksFromGroups, clusterBySortedKey } from './rank-groups'

interface Item {
  readonly id: number
  readonly key: number
}

function rankItems(items: readonly Item[]): Array<{ item: Item; rank: number }> {
  return assignRanksFromGroups(clusterBySortedKey(items, (item) => item.key, 'asc'))
}

const itemsArbitrary = fc
  .array(fc.integer({ min: -1000, max: 1000 }))
  .map((keys) => keys.map((key, id): Item => ({ id, key })))

describe('assignRanksFromGroups', () => {
  it('attribue le rang "1, 2, 2, 4" (les ex aequo décalent le rang suivant)', () => {
    const ranked = assignRanksFromGroups([['a'], ['b', 'c'], ['d']])
    expect(ranked).toEqual([
      { item: 'a', rank: 1 },
      { item: 'b', rank: 2 },
      { item: 'c', rank: 2 },
      { item: 'd', rank: 4 },
    ])
  })

  it('ignore les groupes vides sans consommer de rang', () => {
    expect(assignRanksFromGroups([[], ['a'], []])).toEqual([{ item: 'a', rank: 1 }])
  })

  it('renvoie un tableau vide pour aucun groupe', () => {
    expect(assignRanksFromGroups([])).toEqual([])
  })
})

describe('clusterBySortedKey', () => {
  it('trie en ordre croissant par défaut et regroupe les clés égales', () => {
    expect(clusterBySortedKey([10, 20, 20, 30], (n) => n)).toEqual([[10], [20, 20], [30]])
  })

  it('trie en ordre décroissant quand demandé', () => {
    expect(clusterBySortedKey([1, 3, 2], (n) => n, 'desc')).toEqual([[3], [2], [1]])
  })

  it('renvoie un tableau vide pour une entrée vide', () => {
    expect(clusterBySortedKey([], (n: number) => n)).toEqual([])
  })
})

describe('propriétés — classement par groupes', () => {
  it('déterminisme : même entrée, même sortie', () => {
    fc.assert(
      fc.property(itemsArbitrary, (items) => {
        expect(rankItems(items)).toEqual(rankItems(items))
      }),
    )
  })

  it('deux compétiteurs à performance identique reçoivent le même rang', () => {
    fc.assert(
      fc.property(itemsArbitrary, (items) => {
        const ranked = rankItems(items)
        const rankByKey = new Map<number, number>()

        for (const { item, rank } of ranked) {
          const existing = rankByKey.get(item.key)
          if (existing === undefined) {
            rankByKey.set(item.key, rank)
          } else {
            expect(rank).toBe(existing)
          }
        }
      }),
    )
  })

  it('la somme des tailles de groupe ne décale pas le total : aucun trou, aucun doublon', () => {
    fc.assert(
      fc.property(itemsArbitrary, (items) => {
        const ranked = rankItems(items)
        expect(ranked).toHaveLength(items.length)
        expect(new Set(ranked.map(({ item }) => item.id)).size).toBe(items.length)

        for (const item of items) {
          const strictlyBetterCount = items.filter((other) => other.key < item.key).length
          const rank = ranked.find((r) => r.item.id === item.id)?.rank
          expect(rank).toBe(strictlyBetterCount + 1)
        }
      }),
    )
  })
})
