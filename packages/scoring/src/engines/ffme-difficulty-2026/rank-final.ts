import { assignRanksFromGroups, clusterBySortedKey } from '../../rank-groups'
import type { CompetitionContext, FinalRankEntry, FinalRanking } from '../../types'

interface PlacedCompetitor {
  readonly competitorId: string
  readonly reachedRoundId: string
}

/**
 * SPEC.md §4.4: the final ranking is that of the last round each competitor
 * took part in. A finalist always ranks ahead of a non-qualified
 * semi-finalist, regardless of their performance in the final.
 *
 * `ctx.roundRankings` has already, round by round, been broken by countback
 * chaining to the previous round (see rank-round.ts): by the time this
 * function reads a round's ranking, every resolvable historical gap has
 * already been resolved. All that's left is to stack the rounds, from most
 * to least advanced, respecting the ties already present in each round's
 * ranking.
 */
export function rankFinal(ctx: CompetitionContext): FinalRanking {
  if (ctx.roundRankings.length === 0) {
    throw new Error(
      'Une compétition doit avoir au moins un tour pour calculer un classement final.',
    )
  }

  const placedIds = new Set<string>()
  const tierGroups: PlacedCompetitor[][] = []

  for (const { roundId, ranking } of [...ctx.roundRankings].reverse()) {
    const eligibleEntries = ranking.entries.filter((entry) => !placedIds.has(entry.competitorId))
    const tiesWithinRound = clusterBySortedKey(eligibleEntries, (entry) => entry.rank, 'asc')

    for (const tieGroup of tiesWithinRound) {
      tierGroups.push(
        tieGroup.map((entry) => ({ competitorId: entry.competitorId, reachedRoundId: roundId })),
      )
      for (const entry of tieGroup) {
        placedIds.add(entry.competitorId)
      }
    }
  }

  const ranked = assignRanksFromGroups(tierGroups)

  const entries: FinalRankEntry[] = ranked.map(({ item, rank }) => ({
    competitorId: item.competitorId,
    reachedRoundId: item.reachedRoundId,
    rank,
  }))

  return { entries }
}
