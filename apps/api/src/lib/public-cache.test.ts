import { describe, expect, it } from 'vitest'

import { createPublicRankingCache } from './public-cache'

function fakeResponse(categoryId: string) {
  return {
    categoryId,
    started: true,
    provisional: false,
    generatedAt: '2026-05-01T10:00:00.000Z',
    entries: [],
  }
}

describe('createPublicRankingCache', () => {
  it("renvoie undefined tant que rien n'a été mis en cache", () => {
    const cache = createPublicRankingCache()
    expect(cache.get('comp-1', 'cat-1')).toBeUndefined()
  })

  it('retrouve une valeur mise en cache pour la même compétition/catégorie', () => {
    const cache = createPublicRankingCache()
    const value = fakeResponse('cat-1')
    cache.set('comp-1', 'cat-1', value)
    expect(cache.get('comp-1', 'cat-1')).toBe(value)
  })

  it('ne mélange jamais deux catégories de la même compétition', () => {
    const cache = createPublicRankingCache()
    cache.set('comp-1', 'cat-1', fakeResponse('cat-1'))
    expect(cache.get('comp-1', 'cat-2')).toBeUndefined()
  })

  it('invalidateCategory ne retire que la catégorie visée', () => {
    const cache = createPublicRankingCache()
    cache.set('comp-1', 'cat-1', fakeResponse('cat-1'))
    cache.set('comp-1', 'cat-2', fakeResponse('cat-2'))
    cache.invalidateCategory('comp-1', 'cat-1')
    expect(cache.get('comp-1', 'cat-1')).toBeUndefined()
    expect(cache.get('comp-1', 'cat-2')).not.toBeUndefined()
  })

  it("invalidateCompetition retire toutes les catégories de la compétition, aucune autre", () => {
    const cache = createPublicRankingCache()
    cache.set('comp-1', 'cat-1', fakeResponse('cat-1'))
    cache.set('comp-1', 'cat-2', fakeResponse('cat-2'))
    cache.set('comp-2', 'cat-1', fakeResponse('cat-1'))
    cache.invalidateCompetition('comp-1')
    expect(cache.get('comp-1', 'cat-1')).toBeUndefined()
    expect(cache.get('comp-1', 'cat-2')).toBeUndefined()
    expect(cache.get('comp-2', 'cat-1')).not.toBeUndefined()
  })

  it('expire une entrée après son TTL (horloge injectée)', () => {
    let now = 0
    const cache = createPublicRankingCache(1000, () => now)
    cache.set('comp-1', 'cat-1', fakeResponse('cat-1'))
    now = 999
    expect(cache.get('comp-1', 'cat-1')).not.toBeUndefined()
    now = 1000
    expect(cache.get('comp-1', 'cat-1')).toBeUndefined()
  })
})
