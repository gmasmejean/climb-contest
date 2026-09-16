import { assignRanksFromGroups, clusterBySortedKey } from '../../rank-groups'
import type { Ascent, Route, RouteRankEntry, RouteRanking } from '../../types'
import { scoreAscent } from './score-ascent'

interface ScoredCompetitor {
  readonly competitorId: string
  readonly scoreValue: number
  readonly climbTimeMs: number | null
}

/**
 * SPEC.md §4.2, without the countback tie-break: that needs the previous
 * round's ranking, which this function doesn't receive (SPEC.md §4.6). It
 * is applied exactly once, in `rankRound`, which covers a single-route
 * round just as well as a multi-route one. See DECISIONS.md ADR-021.
 */
export function rankRoute(ascents: readonly Ascent[], route: Route): RouteRanking {
  const scored: ScoredCompetitor[] = ascents.map((ascent) => ({
    competitorId: ascent.competitorId,
    scoreValue: scoreAscent(ascent, route),
    climbTimeMs: ascent.climbTimeMs,
  }))

  const scoreGroups = clusterBySortedKey(scored, (competitor) => competitor.scoreValue, 'desc')
  const tieGroups = scoreGroups.flatMap(splitByChrono)
  const ranked = assignRanksFromGroups(tieGroups)

  const entries: RouteRankEntry[] = ranked.map(({ item, rank }) => ({
    competitorId: item.competitorId,
    scoreValue: item.scoreValue,
    rank,
  }))

  // ADR-004: editing route.hold_count is blocked as soon as an ascent
  // exists on the route, so route.holdCount always matches the holdCount of
  // every ascent passed in here.
  return { routeId: route.id, holdCount: route.holdCount, entries }
}

/**
 * Breaks a tie by chrono only when the ENTIRE group has a known
 * climb_time_ms — a partially recorded chrono within the same tied group is
 * not a case SPEC.md §8.4 anticipates (timing is rarely used, manual entry
 * only); the group then stays a true tie instead of inventing an
 * unspecified priority rule.
 */
function splitByChrono(group: readonly ScoredCompetitor[]): ScoredCompetitor[][] {
  if (group.length < 2 || group.some((competitor) => competitor.climbTimeMs === null)) {
    return [[...group]]
  }

  return clusterBySortedKey(group, requireClimbTimeMs, 'asc')
}

function requireClimbTimeMs(competitor: ScoredCompetitor): number {
  /* v8 ignore next 3 -- splitByChrono only calls this on a group already confirmed to be entirely non-null */
  if (competitor.climbTimeMs === null) {
    throw new Error('climbTimeMs manquant après vérification de complétude du groupe.')
  }
  return competitor.climbTimeMs
}
