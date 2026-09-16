import { competition, type Database } from '@climbcontest/db'
import { and, eq, isNull } from 'drizzle-orm'
import type { Context, Next } from 'hono'

import { ApiError } from './problem'

type CompetitionRow = typeof competition.$inferSelect

declare module 'hono' {
  interface ContextVariableMap {
    competition: CompetitionRow
  }
}

/**
 * Charge la compétition du chemin (`:id`) et vérifie qu'elle appartient au
 * club de l'organisateur authentifié. Toujours 404 en cas d'échec — jamais
 * 403 — pour ne pas révéler l'existence d'une compétition d'un autre club.
 * S'applique après `requireOrganizer`.
 */
export function requireCompetitionAccess(db: Database) {
  return async (c: Context, next: Next) => {
    const organizer = c.get('organizer')
    const id = c.req.param('id')
    if (!id) {
      throw new ApiError(404, 'Compétition introuvable', "Cette compétition n'existe pas.")
    }
    const row = await db.query.competition.findFirst({
      where: and(
        eq(competition.id, id),
        eq(competition.clubId, organizer.clubId),
        isNull(competition.deletedAt),
      ),
    })
    if (!row) {
      throw new ApiError(404, 'Compétition introuvable', "Cette compétition n'existe pas.")
    }
    c.set('competition', row)
    await next()
  }
}
