import { describe, expect, it } from 'vitest'

import type { Ascent, Route, RouteRanking } from '../../types'
import { rankRoute } from './rank-route'

const route: Route = { id: 'route-1', holdCount: 40 }

function ascent(competitorId: string, overrides: Partial<Ascent>): Ascent {
  return {
    competitorId,
    holdNumber: null,
    holdCount: route.holdCount,
    modifier: 'none',
    isTop: false,
    status: 'valid',
    climbTimeMs: null,
    ...overrides,
  }
}

function ranksById(ranking: RouteRanking): Record<string, number> {
  return Object.fromEntries(ranking.entries.map((entry) => [entry.competitorId, entry.rank]))
}

function orderedIds(ranking: RouteRanking): string[] {
  return ranking.entries.map((entry) => entry.competitorId)
}

describe('rankRoute — SPEC.md §4.2 / §9', () => {
  it('Cas #7 — A=30, B=30+, C=29 → B, A, C', () => {
    const ranking = rankRoute(
      [
        ascent('A', { holdNumber: 30 }),
        ascent('B', { holdNumber: 30, modifier: 'plus' }),
        ascent('C', { holdNumber: 29 }),
      ],
      route,
    )
    expect(orderedIds(ranking)).toEqual(['B', 'A', 'C'])
    expect(ranksById(ranking)).toEqual({ B: 1, A: 2, C: 3 })
  })

  it('Cas #8 — A=30, B=30, chrono activé, A plus rapide → A, B', () => {
    const ranking = rankRoute(
      [
        ascent('A', { holdNumber: 30, climbTimeMs: 45_000 }),
        ascent('B', { holdNumber: 30, climbTimeMs: 52_000 }),
      ],
      route,
    )
    expect(orderedIds(ranking)).toEqual(['A', 'B'])
    expect(ranksById(ranking)).toEqual({ A: 1, B: 2 })
  })

  it('Cas #9 — A=30, B=30, pas de chrono, pas de tour précédent → ex aequo 1er, suivant classé 3e', () => {
    const ranking = rankRoute(
      [
        ascent('A', { holdNumber: 30 }),
        ascent('B', { holdNumber: 30 }),
        ascent('C', { holdNumber: 28 }),
      ],
      route,
    )
    expect(ranksById(ranking)).toEqual({ A: 1, B: 1, C: 3 })
  })

  it('Cas #10 — trois tops → tous ex aequo 1ers', () => {
    const ranking = rankRoute(
      [ascent('A', { isTop: true }), ascent('B', { isTop: true }), ascent('C', { isTop: true })],
      route,
    )
    expect(ranksById(ranking)).toEqual({ A: 1, B: 1, C: 1 })
  })

  it('Cas #25 — absence (DNS) sur une voie : les absents partagent le même rang défavorable', () => {
    const ranking = rankRoute(
      [
        ascent('A', { holdNumber: 30 }),
        ascent('B', { holdNumber: 20 }),
        ascent('C', { status: 'dns' }),
        ascent('D', { status: 'dns' }),
      ],
      route,
    )
    expect(ranksById(ranking)).toEqual({ A: 1, B: 2, C: 3, D: 3 })
  })

  it('chrono non appliqué si un seul membre du groupe a un climb_time_ms connu', () => {
    const ranking = rankRoute(
      [ascent('A', { holdNumber: 30, climbTimeMs: 45_000 }), ascent('B', { holdNumber: 30 })],
      route,
    )
    expect(ranksById(ranking)).toEqual({ A: 1, B: 1 })
  })
})
