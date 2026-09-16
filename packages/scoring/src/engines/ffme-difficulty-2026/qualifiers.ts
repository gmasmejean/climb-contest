import type { RoundRanking } from '../../types'

/**
 * SPEC.md §4.4: the top `qualifyingCount` competitors qualify for the next
 * round. On a tie at the boundary, ALL tied competitors qualify (SPEC.md §9
 * case #19) — so the next round can end up with more participants than
 * `qualifyingCount`. Outside the `ScoringEngine` interface (SPEC.md §4.6
 * doesn't list it), but explicitly requested by ROADMAP.md Lot 2, point 3.
 */
export function getQualifiers(ranking: RoundRanking, qualifyingCount: number): readonly string[] {
  if (qualifyingCount < 1) {
    throw new Error('qualifyingCount doit être un entier positif.')
  }

  const boundaryRank = findBoundaryRank(ranking, qualifyingCount)
  if (boundaryRank === undefined) {
    return ranking.entries.map((entry) => entry.competitorId)
  }

  return ranking.entries
    .filter((entry) => entry.rank <= boundaryRank)
    .map((entry) => entry.competitorId)
}

function findBoundaryRank(ranking: RoundRanking, qualifyingCount: number): number | undefined {
  const sortedByRank = [...ranking.entries].sort((a, b) => a.rank - b.rank)
  return sortedByRank[qualifyingCount - 1]?.rank
}
