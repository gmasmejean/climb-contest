import { assignRanksFromGroups, clusterBySortedKey } from '../../rank-groups'
import type { RoundContext, RoundRankEntry, RoundRanking, RouteRanking } from '../../types'

export function rankRound(routeRankings: readonly RouteRanking[], ctx: RoundContext): RoundRanking {
  if (routeRankings.length === 0) {
    throw new Error('Un tour doit avoir au moins une voie.')
  }

  return ctx.format === 'phases'
    ? rankRoundPhases(routeRankings, ctx)
    : rankRoundContest(routeRankings, ctx)
}

// ---- Phases format (SPEC.md §4.3): geometric mean of per-route ranks ----
//
// Comparing the product of ranks instead of (r1×…×rk)^(1/k) gives a
// rigorously identical order (the k-th root is strictly increasing), and
// never goes through Math.pow to sort — see ROADMAP.md's warning about the
// √(1×4) vs √(2×2) floating-point trap. Math.pow is only used for the
// *displayed* value.

interface PhasesCompetitor {
  readonly competitorId: string
  readonly product: number
}

function rankRoundPhases(
  routeRankings: readonly RouteRanking[],
  ctx: Extract<RoundContext, { format: 'phases' }>,
): RoundRanking {
  const competitorIds = requireConsistentCompetitorIds(routeRankings)
  const rankMapsByRoute = routeRankings.map(buildRankMap)

  const competitors: PhasesCompetitor[] = competitorIds.map((competitorId) => ({
    competitorId,
    product: rankMapsByRoute.reduce(
      (product, rankMap) => product * requireRank(rankMap, competitorId),
      1,
    ),
  }))

  const productGroups = clusterBySortedKey(competitors, (competitor) => competitor.product, 'asc')
  const previousRankById = buildPreviousRankById(ctx.previousRoundRanking)
  const tieGroups = productGroups.flatMap((group) => breakTiesByCountback(group, previousRankById))
  const ranked = assignRanksFromGroups(tieGroups)
  const routeCount = routeRankings.length

  const entries: RoundRankEntry[] = ranked.map(({ item, rank }) => ({
    competitorId: item.competitorId,
    rank,
    combinedRank: roundTo(Math.pow(item.product, 1 / routeCount), 2),
  }))

  return { entries }
}

function buildRankMap(routeRanking: RouteRanking): ReadonlyMap<string, number> {
  return new Map(routeRanking.entries.map((entry) => [entry.competitorId, entry.rank]))
}

function requireRank(rankMap: ReadonlyMap<string, number>, competitorId: string): number {
  const rank = rankMap.get(competitorId)
  /* v8 ignore next 3 -- requireConsistentCompetitorIds already guarantees this presence */
  if (rank === undefined) {
    throw new Error(`Compétiteur ${competitorId} absent du classement d'une voie du tour.`)
  }
  return rank
}

/**
 * Every competitor in the round must appear in the ranking of every route
 * of that round (including as a DNS ascent, SPEC.md §9 case 25) — otherwise
 * the geometric mean would silently combine different competitor sets from
 * one route to another.
 *
 * Note: this only catches an INCONSISTENCY between the routes actually
 * passed in. It cannot catch a competitor who is missing from every single
 * route of the round (never given even a DNS ascent) — nothing in the
 * `ScoringEngine` interface (SPEC.md §4.6) gives this function a full
 * competitor roster to compare against. Building every competitor's DNS
 * placeholder ascent before scoring a round is a caller precondition (see
 * DECISIONS.md ADR-021).
 */
function requireConsistentCompetitorIds(routeRankings: readonly RouteRanking[]): readonly string[] {
  const allIds = new Set<string>()
  for (const routeRanking of routeRankings) {
    for (const entry of routeRanking.entries) {
      allIds.add(entry.competitorId)
    }
  }

  for (const routeRanking of routeRankings) {
    const ids = new Set(routeRanking.entries.map((entry) => entry.competitorId))
    if (ids.size !== allIds.size) {
      throw new Error(
        `Incohérence entre les voies du tour : la voie ${routeRanking.routeId} n'a pas le même ensemble de compétiteurs que les autres voies. Chaque compétiteur doit avoir un passage (y compris DNS) sur chaque voie.`,
      )
    }
  }

  return [...allIds]
}

function buildPreviousRankById(
  previousRoundRanking: RoundRanking | undefined,
): ReadonlyMap<string, number> | undefined {
  if (previousRoundRanking === undefined) {
    return undefined
  }
  return new Map(previousRoundRanking.entries.map((entry) => [entry.competitorId, entry.rank]))
}

/**
 * Countback (SPEC.md §4.2/§4.4): the better rank in the previous round wins.
 * A single level of lookback is enough — see DECISIONS.md ADR-021 for the
 * reasoning (the previous round's own ranking was already broken by ITS
 * previous round).
 *
 * If there is no previous round, OR if even a single member of the group is
 * missing from it, the whole group stays a true tie: countback can only
 * fairly discriminate when every tied competitor has a known previous rank
 * to compare.
 */
function breakTiesByCountback(
  group: readonly PhasesCompetitor[],
  previousRankById: ReadonlyMap<string, number> | undefined,
): PhasesCompetitor[][] {
  if (group.length < 2 || previousRankById === undefined) {
    return [[...group]]
  }

  const everyoneHasAPreviousRank = group.every((competitor) =>
    previousRankById.has(competitor.competitorId),
  )
  if (!everyoneHasAPreviousRank) {
    return [[...group]]
  }

  return clusterBySortedKey(
    group,
    (competitor) => requirePreviousRank(previousRankById, competitor.competitorId),
    'asc',
  )
}

function requirePreviousRank(
  previousRankById: ReadonlyMap<string, number>,
  competitorId: string,
): number {
  const rank = previousRankById.get(competitorId)
  /* v8 ignore next 3 -- breakTiesByCountback only calls this once every member of the group has been confirmed present */
  if (rank === undefined) {
    throw new Error(`Compétiteur ${competitorId} absent du classement du tour précédent.`)
  }
  return rank
}

// ---- Contest format (SPEC.md §4.5): sum of the M best scoreValue ----

interface RouteScore {
  readonly scoreValue: number
  readonly holdCount: number
}

interface ContestCompetitor {
  readonly competitorId: string
  readonly total: number
  readonly tops: number
  readonly attempted: number
}

function rankRoundContest(
  routeRankings: readonly RouteRanking[],
  ctx: Extract<RoundContext, { format: 'contest' }>,
): RoundRanking {
  const scoresByCompetitor = new Map<string, RouteScore[]>()

  for (const routeRanking of routeRankings) {
    for (const entry of routeRanking.entries) {
      const scores = scoresByCompetitor.get(entry.competitorId) ?? []
      scores.push({ scoreValue: entry.scoreValue, holdCount: routeRanking.holdCount })
      scoresByCompetitor.set(entry.competitorId, scores)
    }
  }

  const competitors: ContestCompetitor[] = [...scoresByCompetitor.entries()].map(
    ([competitorId, scores]) => {
      // Sorting by scoreValue alone is order-dependent (Array.sort is stable)
      // whenever more routes tie at the cutoff value than fit in the M slots
      // left — the caller's routeRankings array order would then silently
      // decide which tied route gets counted. Breaking that tie by "is this a
      // TOP" makes the M-best selection deterministic regardless of input
      // order, and prefers an actual TOP over a numerically-equal but
      // untopped climb on a different route when there is a genuine choice.
      const sortedDesc = [...scores].sort(
        (a, b) => b.scoreValue - a.scoreValue || Number(isTopScore(b)) - Number(isTopScore(a)),
      )
      const counted = sortedDesc.slice(0, ctx.routesCounted)

      return {
        competitorId,
        total: counted.reduce((sum, score) => sum + score.scoreValue, 0),
        tops: counted.filter(isTopScore).length,
        // Interpretation not covered by any of SPEC.md §9's 25 test cases
        // (case 17 only exercises the "number of tops" tie-break): "routes
        // attempted" = every route of the competitor with a score > 0, not
        // only the M retained ones. See DECISIONS.md ADR-021 and RULES.md.
        attempted: scores.filter((score) => score.scoreValue > 0).length,
      }
    },
  )

  const totalGroups = clusterBySortedKey(competitors, (competitor) => competitor.total, 'desc')
  const tieGroups = totalGroups.flatMap(breakContestTies)
  const ranked = assignRanksFromGroups(tieGroups)

  const entries: RoundRankEntry[] = ranked.map(({ item, rank }) => ({
    competitorId: item.competitorId,
    rank,
    combinedRank: item.total,
  }))

  return { entries }
}

function isTopScore(score: RouteScore): boolean {
  return score.scoreValue === score.holdCount + 1
}

/** SPEC.md §4.5: number of tops descending, then routes attempted ascending, then true tie. */
function breakContestTies(group: readonly ContestCompetitor[]): ContestCompetitor[][] {
  if (group.length < 2) {
    return [[...group]]
  }

  const byTopsDesc = clusterBySortedKey(group, (competitor) => competitor.tops, 'desc')

  return byTopsDesc.flatMap((topsGroup) =>
    topsGroup.length < 2
      ? [topsGroup]
      : clusterBySortedKey(topsGroup, (competitor) => competitor.attempted, 'asc'),
  )
}

function roundTo(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals)
  return Math.round(value * factor) / factor
}
