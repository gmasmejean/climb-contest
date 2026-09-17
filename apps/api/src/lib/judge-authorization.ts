import { judge, judgeRoute, route, type Database } from '@climbcontest/db'
import { and, eq, isNull } from 'drizzle-orm'

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
