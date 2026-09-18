import { competition, type Database } from '@climbcontest/db'
import { and, eq, isNull } from 'drizzle-orm'

import { ApiError } from '../middleware/problem'

type CompetitionRow = typeof competition.$inferSelect

/**
 * Résout une compétition par son `public_slug` (SPEC.md §6.4 : non
 * devinable, 22 caractères base62) — la seule façon d'atteindre une
 * compétition sans authentification. Toujours 404 générique, comme
 * `requireCompetitionAccess` (middleware organisateur) : ne jamais
 * distinguer « slug inconnu » de « compétition supprimée ».
 */
export async function resolvePublicCompetitionBySlug(
  db: Database,
  slug: string,
): Promise<CompetitionRow> {
  const row = await db.query.competition.findFirst({
    where: and(eq(competition.publicSlug, slug), isNull(competition.deletedAt)),
  })
  if (!row) {
    throw new ApiError(404, 'Compétition introuvable', "Cette page n'existe pas ou plus.")
  }
  return row
}
