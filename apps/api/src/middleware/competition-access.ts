import { competition, type Database } from '@climbcontest/db'
import { and, eq, isNotNull, isNull, type SQL } from 'drizzle-orm'
import type { Context, Next } from 'hono'

import { ApiError } from './problem'

type CompetitionRow = typeof competition.$inferSelect

declare module 'hono' {
  interface ContextVariableMap {
    competition: CompetitionRow
  }
}

/** Quelles compétitions le middleware accepte : voir `requireCompetitionAccess`. */
export type CompetitionScope = 'active' | 'trashed' | 'any'

/**
 * Charge la compétition du chemin (`:id`) et vérifie qu'elle appartient à
 * l'organisation de l'organisateur authentifié. Toujours 404 en cas d'échec —
 * jamais 403 — pour ne pas révéler l'existence d'une compétition d'une autre organisation.
 * S'applique après `requireOrganizer`.
 *
 * Par défaut (`scope: 'active'`), une compétition à la corbeille est
 * introuvable, comme si elle n'existait plus. Pour la corbeille (Lot 11,
 * ADR-063) : `'trashed'` ne trouve que les compétitions déjà à la corbeille, et
 * `'any'` trouve les deux — la route décide alors elle-même quoi répondre, avec
 * un message plus précis qu'un 404 (« pas dans la corbeille »).
 */
export function requireCompetitionAccess(db: Database, options: { scope?: CompetitionScope } = {}) {
  const scope = options.scope ?? 'active'
  const trashFilter: SQL | undefined =
    scope === 'active'
      ? isNull(competition.deletedAt)
      : scope === 'trashed'
        ? isNotNull(competition.deletedAt)
        : undefined
  return async (c: Context, next: Next) => {
    const organizer = c.get('organizer')
    const id = c.req.param('id')
    if (!id) {
      throw new ApiError(404, 'Compétition introuvable', "Cette compétition n'existe pas.")
    }
    const row = await db.query.competition.findFirst({
      where: and(
        eq(competition.id, id),
        eq(competition.organizationId, organizer.organizationId),
        trashFilter,
      ),
    })
    if (!row) {
      throw new ApiError(404, 'Compétition introuvable', "Cette compétition n'existe pas.")
    }
    c.set('competition', row)
    await next()
  }
}
