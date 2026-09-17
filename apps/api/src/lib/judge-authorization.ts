import { judge, judgeRoute, round, roundRoute, route, type Database } from '@climbcontest/db'
import { and, asc, eq, isNull } from 'drizzle-orm'

import { ApiError } from '../middleware/problem'

type JudgeRow = typeof judge.$inferSelect
type RouteRow = typeof route.$inferSelect

/**
 * Vérifie qu'une voie appartient à la compétition du juge ET lui est
 * assignée — toujours en base, jamais via des claims embarqués dans le JWT
 * (voir `middleware/judge-auth.ts`). Un seul message générique, comme
 * `requireCompetitionAccess` : ne jamais distinguer « voie d'une autre
 * compétition » de « voie non assignée », pour ne rien révéler à un juge sur
 * ce qui existe ailleurs.
 */
export async function assertJudgeAssignedToRoute(
  db: Database,
  currentJudge: JudgeRow,
  routeId: string,
): Promise<RouteRow> {
  const row = await db.query.route.findFirst({
    where: and(
      eq(route.id, routeId),
      eq(route.competitionId, currentJudge.competitionId),
      isNull(route.deletedAt),
    ),
  })
  if (!row) {
    throw new ApiError(404, 'Voie introuvable', "Cette voie n'existe pas.")
  }

  const assignment = await db.query.judgeRoute.findFirst({
    where: and(eq(judgeRoute.judgeId, currentJudge.id), eq(judgeRoute.routeId, routeId)),
  })
  if (!assignment) {
    throw new ApiError(404, 'Voie introuvable', "Cette voie n'existe pas.")
  }

  return row
}

export interface OpenRoundForRoute {
  roundId: string
  roundType: (typeof round.$inferSelect)['type']
  // Toutes les catégories que cette voie sert DANS ce tour (round_route
  // peut lier une même voie à plusieurs catégories pour un même tour).
  categoryIds: string[]
}

/**
 * Résout le tour ouvert qui utilise cette voie, pour cette compétition — au
 * plus un en pratique (Lot 5 suppose qu'un organisateur n'ouvre jamais deux
 * tours en même temps sur la même voie ; le cas contraire n'est pas détecté,
 * voir TODO.md : seul le premier tour trouvé, par `display_order`, est
 * retenu). `null` si aucun tour ouvert ne référence la voie : état
 * transitoire normal (tour pas encore ouvert, ou déjà refermé), pas une
 * erreur.
 */
export async function resolveOpenRoundForRoute(
  db: Database,
  competitionId: string,
  routeId: string,
): Promise<OpenRoundForRoute | null> {
  const rows = await db
    .select({ roundId: round.id, roundType: round.type, categoryId: roundRoute.categoryId })
    .from(roundRoute)
    .innerJoin(round, eq(round.id, roundRoute.roundId))
    .where(
      and(
        eq(roundRoute.routeId, routeId),
        eq(round.competitionId, competitionId),
        eq(round.status, 'open'),
        isNull(round.deletedAt),
      ),
    )
    .orderBy(asc(round.displayOrder))

  const first = rows[0]
  if (!first) return null
  return {
    roundId: first.roundId,
    roundType: first.roundType,
    categoryIds: rows.filter((r) => r.roundId === first.roundId).map((r) => r.categoryId),
  }
}
