import { describe, expect, it } from 'vitest'

import type { CompetitionContext, FinalRanking, RouteRankEntry, RouteRanking } from '../../types'
import { rankFinal } from './rank-final'
import { rankRound } from './rank-round'

function routeRanking(
  routeId: string,
  holdCount: number,
  entries: Array<Omit<RouteRankEntry, 'rank'> & { rank: number }>,
): RouteRanking {
  return { routeId, holdCount, entries }
}

function ranksById(ranking: FinalRanking): Record<string, number> {
  return Object.fromEntries(ranking.entries.map((entry) => [entry.competitorId, entry.rank]))
}

function reachedRoundById(ranking: FinalRanking): Record<string, string> {
  return Object.fromEntries(
    ranking.entries.map((entry) => [entry.competitorId, entry.reachedRoundId]),
  )
}

function rankFor(ranking: FinalRanking, competitorId: string): number {
  const entry = ranking.entries.find((candidate) => candidate.competitorId === competitorId)
  if (entry === undefined) {
    throw new Error(`Compétiteur ${competitorId} absent du classement final.`)
  }
  return entry.rank
}

describe('rankFinal — SPEC.md §4.4 / §9', () => {
  it('Cas #18 — A 8e en demi, B 3e en demi, égalité en finale → B devant A', () => {
    const semiRanking = {
      entries: Array.from({ length: 8 }, (_, i) => ({
        competitorId: `C${i + 1}`,
        rank: i + 1,
        combinedRank: i + 1,
      })),
    }
    // C3 = "B" (3rd in semi), C8 = "A" (8th in semi) — both qualify for the final.
    const semiRankingRenamed = {
      entries: semiRanking.entries.map((entry) =>
        entry.competitorId === 'C3'
          ? { ...entry, competitorId: 'B' }
          : entry.competitorId === 'C8'
            ? { ...entry, competitorId: 'A' }
            : entry,
      ),
    }

    // In the final, A and B are in a strict tie on the single route.
    const finalRoute = routeRanking('final-route', 40, [
      { competitorId: 'A', scoreValue: 35, rank: 1 },
      { competitorId: 'B', scoreValue: 35, rank: 1 },
    ])

    const finalRoundRanking = rankRound([finalRoute], {
      format: 'phases',
      previousRoundRanking: semiRankingRenamed,
    })

    // The countback tie-break must already separate A and B at the round level.
    expect(finalRoundRanking.entries.find((entry) => entry.competitorId === 'A')?.rank).toBe(2)
    expect(finalRoundRanking.entries.find((entry) => entry.competitorId === 'B')?.rank).toBe(1)

    const ctx: CompetitionContext = {
      roundRankings: [
        { roundId: 'semi', ranking: semiRankingRenamed },
        { roundId: 'final', ranking: finalRoundRanking },
      ],
    }

    const result = rankFinal(ctx)

    expect(rankFor(result, 'B')).toBeLessThan(rankFor(result, 'A'))
  })

  it('Cas #20 — un finaliste, même dernier, devant un demi-finaliste non qualifié', () => {
    const semiRanking = {
      entries: [
        { competitorId: 'A', rank: 1, combinedRank: 1 },
        { competitorId: 'C', rank: 2, combinedRank: 2 },
        { competitorId: 'B', rank: 3, combinedRank: 3 },
      ],
    }
    const finalRanking = {
      entries: [
        { competitorId: 'C', rank: 1, combinedRank: 1 },
        { competitorId: 'A', rank: 2, combinedRank: 2 },
      ],
    }

    const result = rankFinal({
      roundRankings: [
        { roundId: 'semi', ranking: semiRanking },
        { roundId: 'final', ranking: finalRanking },
      ],
    })

    expect(rankFor(result, 'A')).toBeLessThan(rankFor(result, 'B'))

    const reachedRound = reachedRoundById(result)
    expect(reachedRound.A).toBe('final')
    expect(reachedRound.B).toBe('semi')
  })

  it('un format contest à un seul tour implicite : le classement final est celui du tour', () => {
    const onlyRoundRanking = {
      entries: [
        { competitorId: 'A', rank: 1, combinedRank: 83 },
        { competitorId: 'B', rank: 2, combinedRank: 75 },
      ],
    }

    const result = rankFinal({ roundRankings: [{ roundId: 'contest', ranking: onlyRoundRanking }] })

    expect(ranksById(result)).toEqual({ A: 1, B: 2 })
  })

  it("lève une erreur explicite si aucun tour n'est fourni", () => {
    expect(() => rankFinal({ roundRankings: [] })).toThrow(/au moins un tour/)
  })
})
