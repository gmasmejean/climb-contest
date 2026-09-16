import { describe, expect, it } from 'vitest'

import type { RoundRanking, RouteRankEntry, RouteRanking } from '../../types'
import { rankRoute } from './rank-route'
import { rankRound } from './rank-round'

function routeRanking(
  routeId: string,
  holdCount: number,
  entries: Array<Omit<RouteRankEntry, 'rank'> & { rank: number }>,
): RouteRanking {
  return { routeId, holdCount, entries }
}

/** Builds a RouteRanking from raw scores: rank is derived (1 = best score). */
function contestRouteRanking(
  routeId: string,
  holdCount: number,
  scores: Record<string, number>,
): RouteRanking {
  const sorted = Object.entries(scores).sort(([, a], [, b]) => b - a)
  return {
    routeId,
    holdCount,
    entries: sorted.map(([competitorId, scoreValue], index) => ({
      competitorId,
      scoreValue,
      rank: index + 1,
    })),
  }
}

function ranksById(ranking: RoundRanking): Record<string, number> {
  return Object.fromEntries(ranking.entries.map((entry) => [entry.competitorId, entry.rank]))
}

function combinedRanksById(ranking: RoundRanking): Record<string, number> {
  return Object.fromEntries(
    ranking.entries.map((entry) => [entry.competitorId, entry.combinedRank]),
  )
}

describe('rankRound — format phases (SPEC.md §4.3 / §9)', () => {
  it('Cas #11 — A(1,4) B(2,2) : ex aequo au premier tour (pas de contre-performance disponible)', () => {
    const v1 = routeRanking('v1', 40, [
      { competitorId: 'A', rank: 1, scoreValue: 39 },
      { competitorId: 'B', rank: 2, scoreValue: 35 },
    ])
    const v2 = routeRanking('v2', 40, [
      { competitorId: 'A', rank: 4, scoreValue: 20 },
      { competitorId: 'B', rank: 2, scoreValue: 30 },
    ])

    const ranking = rankRound([v1, v2], { format: 'phases' })

    expect(combinedRanksById(ranking)).toEqual({ A: 2, B: 2 })
    expect(ranksById(ranking)).toEqual({ A: 1, B: 1 })
  })

  it('Cas #11 (bis) — départagé par contre-performance quand un tour précédent existe', () => {
    const v1 = routeRanking('v1', 40, [
      { competitorId: 'A', rank: 1, scoreValue: 39 },
      { competitorId: 'B', rank: 2, scoreValue: 35 },
    ])
    const v2 = routeRanking('v2', 40, [
      { competitorId: 'A', rank: 4, scoreValue: 20 },
      { competitorId: 'B', rank: 2, scoreValue: 30 },
    ])
    const previousRoundRanking: RoundRanking = {
      entries: [
        { competitorId: 'A', rank: 1, combinedRank: 1 },
        { competitorId: 'B', rank: 2, combinedRank: 2 },
      ],
    }

    const ranking = rankRound([v1, v2], { format: 'phases', previousRoundRanking })

    expect(ranksById(ranking)).toEqual({ A: 1, B: 2 })
    expect(combinedRanksById(ranking)).toEqual({ A: 2, B: 2 })
  })

  it('Cas #12 — A(1,9) B(3,3) → ex aequo', () => {
    const v1 = routeRanking('v1', 40, [
      { competitorId: 'A', rank: 1, scoreValue: 39 },
      { competitorId: 'B', rank: 3, scoreValue: 30 },
    ])
    const v2 = routeRanking('v2', 40, [
      { competitorId: 'A', rank: 9, scoreValue: 15 },
      { competitorId: 'B', rank: 3, scoreValue: 28 },
    ])

    const ranking = rankRound([v1, v2], { format: 'phases' })

    expect(combinedRanksById(ranking)).toEqual({ A: 3, B: 3 })
    expect(ranksById(ranking)).toEqual({ A: 1, B: 1 })
  })

  it('Cas #13 — A(1,1) B(2,2) C(3,3) → A, B, C sans ambiguïté', () => {
    const v1 = routeRanking('v1', 40, [
      { competitorId: 'A', rank: 1, scoreValue: 39 },
      { competitorId: 'B', rank: 2, scoreValue: 35 },
      { competitorId: 'C', rank: 3, scoreValue: 30 },
    ])
    const v2 = routeRanking('v2', 40, [
      { competitorId: 'A', rank: 1, scoreValue: 38 },
      { competitorId: 'B', rank: 2, scoreValue: 34 },
      { competitorId: 'C', rank: 3, scoreValue: 29 },
    ])

    const ranking = rankRound([v1, v2], { format: 'phases' })

    expect(combinedRanksById(ranking)).toEqual({ A: 1, B: 2, C: 3 })
    expect(ranksById(ranking)).toEqual({ A: 1, B: 2, C: 3 })
  })

  it('Cas #14 — A(1,4) B(2,3) → A puis B (A=2.00, B=2.45) : la moyenne géométrique départage sans ambiguïté', () => {
    const v1 = routeRanking('v1', 40, [
      { competitorId: 'A', rank: 1, scoreValue: 39 },
      { competitorId: 'B', rank: 2, scoreValue: 35 },
    ])
    const v2 = routeRanking('v2', 40, [
      { competitorId: 'A', rank: 4, scoreValue: 20 },
      { competitorId: 'B', rank: 3, scoreValue: 25 },
    ])

    const ranking = rankRound([v1, v2], { format: 'phases' })

    expect(ranksById(ranking)).toEqual({ A: 1, B: 2 })
    expect(combinedRanksById(ranking)).toEqual({ A: 2, B: 2.45 })
  })

  it('Cas #25 (intégration) — absence sur une voie : ne perturbe pas la moyenne géométrique des autres', () => {
    const v1 = rankRoute(
      [
        {
          competitorId: 'A',
          holdNumber: 30,
          holdCount: 40,
          modifier: 'none',
          isTop: false,
          status: 'valid',
          climbTimeMs: null,
        },
        {
          competitorId: 'B',
          holdNumber: 20,
          holdCount: 40,
          modifier: 'none',
          isTop: false,
          status: 'valid',
          climbTimeMs: null,
        },
        {
          competitorId: 'C',
          holdNumber: null,
          holdCount: 40,
          modifier: 'none',
          isTop: false,
          status: 'dns',
          climbTimeMs: null,
        },
        {
          competitorId: 'D',
          holdNumber: null,
          holdCount: 40,
          modifier: 'none',
          isTop: false,
          status: 'dns',
          climbTimeMs: null,
        },
      ],
      { id: 'v1', holdCount: 40 },
    )
    const v2 = rankRoute(
      [
        {
          competitorId: 'A',
          holdNumber: 25,
          holdCount: 40,
          modifier: 'none',
          isTop: false,
          status: 'valid',
          climbTimeMs: null,
        },
        {
          competitorId: 'B',
          holdNumber: 28,
          holdCount: 40,
          modifier: 'none',
          isTop: false,
          status: 'valid',
          climbTimeMs: null,
        },
        {
          competitorId: 'C',
          holdNumber: 15,
          holdCount: 40,
          modifier: 'none',
          isTop: false,
          status: 'valid',
          climbTimeMs: null,
        },
        {
          competitorId: 'D',
          holdNumber: 10,
          holdCount: 40,
          modifier: 'none',
          isTop: false,
          status: 'valid',
          climbTimeMs: null,
        },
      ],
      { id: 'v2', holdCount: 40 },
    )

    // On v1, C and D (DNS) must share the same unfavorable rank (3), not 3 and 4.
    expect(v1.entries.find((entry) => entry.competitorId === 'C')?.rank).toBe(3)
    expect(v1.entries.find((entry) => entry.competitorId === 'D')?.rank).toBe(3)

    const ranking = rankRound([v1, v2], { format: 'phases' })

    // Ranks stay well-defined (no error, no NaN) despite the absence.
    expect(ranking.entries).toHaveLength(4)
    expect(ranking.entries.every((entry) => Number.isFinite(entry.combinedRank))).toBe(true)
  })

  it('lève une erreur explicite si un compétiteur manque sur une des voies du tour', () => {
    const v1 = routeRanking('v1', 40, [{ competitorId: 'A', rank: 1, scoreValue: 39 }])
    const v2 = routeRanking('v2', 40, [
      { competitorId: 'A', rank: 1, scoreValue: 38 },
      { competitorId: 'B', rank: 2, scoreValue: 30 },
    ])

    expect(() => rankRound([v1, v2], { format: 'phases' })).toThrow(/Incohérence/)
  })

  it("lève une erreur explicite si aucune voie n'est fournie", () => {
    expect(() => rankRound([], { format: 'phases' })).toThrow(/au moins une voie/)
  })

  it('reste ex aequo quand aucun des membres du groupe ne figure au tour précédent', () => {
    const v1 = routeRanking('v1', 40, [
      { competitorId: 'A', rank: 1, scoreValue: 39 },
      { competitorId: 'B', rank: 1, scoreValue: 39 },
    ])
    const previousRoundRanking: RoundRanking = {
      entries: [{ competitorId: 'Z', rank: 1, combinedRank: 1 }],
    }

    const ranking = rankRound([v1], { format: 'phases', previousRoundRanking })

    expect(ranksById(ranking)).toEqual({ A: 1, B: 1 })
  })

  it('reste ex aequo pour tout le groupe si un seul de ses membres est absent du tour précédent', () => {
    const v1 = routeRanking('v1', 40, [
      { competitorId: 'A', rank: 1, scoreValue: 39 },
      { competitorId: 'B', rank: 1, scoreValue: 39 },
      { competitorId: 'C', rank: 1, scoreValue: 39 },
    ])
    // A and B have a previous rank, C does not : countback cannot fairly
    // discriminate C from A and B, so the whole group of three must stay
    // tied — not just C being pushed to the back.
    const previousRoundRanking: RoundRanking = {
      entries: [
        { competitorId: 'A', rank: 1, combinedRank: 1 },
        { competitorId: 'B', rank: 2, combinedRank: 2 },
      ],
    }

    const ranking = rankRound([v1], { format: 'phases', previousRoundRanking })

    expect(ranksById(ranking)).toEqual({ A: 1, B: 1, C: 1 })
  })
})

describe('rankRound — format contest (SPEC.md §4.5 / §9)', () => {
  it("Cas #15 et #16 — somme des M meilleures (M=3) ; B n'a grimpé que 2 voies", () => {
    const routeRankings = [
      contestRouteRanking('v1', 40, { A: 30, B: 40 }),
      contestRouteRanking('v2', 40, { A: 28, B: 35 }),
      contestRouteRanking('v3', 40, { A: 25 }),
      contestRouteRanking('v4', 40, { A: 20 }),
      contestRouteRanking('v5', 40, { A: 10 }),
    ]

    const ranking = rankRound(routeRankings, { format: 'contest', routesCounted: 3 })

    expect(combinedRanksById(ranking)).toEqual({ A: 83, B: 75 })
  })

  it('Cas #17 — totaux égaux, départage par nombre de tops', () => {
    const routeRankings = [
      contestRouteRanking('va', 29, { A: 30, B: 30 }),
      contestRouteRanking('vb', 29, { A: 30, B: 28 }),
      contestRouteRanking('vc', 100, { A: 23, B: 25 }),
    ]

    const ranking = rankRound(routeRankings, { format: 'contest', routesCounted: 3 })

    expect(combinedRanksById(ranking)).toEqual({ A: 83, B: 83 })
    expect(ranksById(ranking)).toEqual({ A: 1, B: 2 })
  })

  it('totaux et tops égaux → départage par nombre de voies tentées (moins = mieux)', () => {
    // A: 2 routes attempted, top-2 (M=2) total = 60 (30+30), 0 tops.
    // B: 3 routes attempted, same top-2 retained (35+25=60), 0 tops, but one more route attempted.
    const routeRankings = [
      contestRouteRanking('v1', 40, { A: 30, B: 35 }),
      contestRouteRanking('v2', 40, { A: 30, B: 25 }),
      contestRouteRanking('v3', 40, { B: 15 }),
    ]

    const ranking = rankRound(routeRankings, { format: 'contest', routesCounted: 2 })

    expect(combinedRanksById(ranking)).toEqual({ A: 60, B: 60 })
    expect(ranksById(ranking)).toEqual({ A: 1, B: 2 })
  })

  it('totaux, tops et voies tentées identiques → ex aequo vrai', () => {
    const routeRankings = [
      contestRouteRanking('v1', 40, { A: 30, B: 30 }),
      contestRouteRanking('v2', 40, { A: 28, B: 28 }),
    ]

    const ranking = rankRound(routeRankings, { format: 'contest', routesCounted: 2 })

    expect(ranksById(ranking)).toEqual({ A: 1, B: 1 })
  })

  it('le choix des voies retenues à la limite de M est déterministe, quel que soit leur ordre en entrée', () => {
    // X ties at scoreValue=30 on all 3 routes, but only p is an actual TOP
    // (holdCount 29 → TOP=30). With M=2, only 2 of the 3 tied routes get
    // counted: p must always be one of them, regardless of array order, so
    // X's "tops" count (and therefore its tie-break against Z) does not
    // depend on which order the caller passed the routes in.
    const p = contestRouteRanking('p', 29, { X: 30, Z: 5 })
    const q = contestRouteRanking('q', 40, { X: 30, Z: 30 })
    const s = contestRouteRanking('s', 50, { X: 30, Z: 30 })

    const forward = rankRound([p, q, s], { format: 'contest', routesCounted: 2 })
    const reversed = rankRound([s, q, p], { format: 'contest', routesCounted: 2 })

    expect(combinedRanksById(forward)).toEqual({ X: 60, Z: 60 })
    expect(ranksById(forward)).toEqual({ X: 1, Z: 2 })
    expect(ranksById(reversed)).toEqual({ X: 1, Z: 2 })
  })
})
