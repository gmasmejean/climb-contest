import { ascent, category, competitor, routeCategory, type Database } from '@climbcontest/db'
import { and, eq, inArray, isNull } from 'drizzle-orm'

type CompetitorRow = typeof competitor.$inferSelect
type AscentRow = typeof ascent.$inferSelect

/**
 * Statuts comptant comme « toujours en lice » pour le calcul d'une
 * progression — un compétiteur retiré ou disqualifié n'est plus attendu sur
 * une voie. Partagé entre l'écran juge (Lot 5) et le tableau de bord
 * organisateur (Lot 8) : les deux doivent compter la même chose.
 */
export const EXPECTED_COMPETITOR_STATUSES = ['registered', 'present'] as const

export async function categoryLabelsByRoute(
  db: Database,
  routeIds: string[],
): Promise<Map<string, { id: string; label: string }[]>> {
  if (routeIds.length === 0) return new Map()
  const links = await db
    .select({ routeId: routeCategory.routeId, id: category.id, label: category.label })
    .from(routeCategory)
    .innerJoin(category, eq(category.id, routeCategory.categoryId))
    .where(inArray(routeCategory.routeId, routeIds))
  const map = new Map<string, { id: string; label: string }[]>()
  for (const link of links) {
    const list = map.get(link.routeId) ?? []
    list.push({ id: link.id, label: link.label })
    map.set(link.routeId, list)
  }
  return map
}

export async function expectedCompetitors(
  db: Database,
  competitionId: string,
  categoryIds: string[],
): Promise<CompetitorRow[]> {
  if (categoryIds.length === 0) return []
  return db.query.competitor.findMany({
    where: and(
      eq(competitor.competitionId, competitionId),
      inArray(competitor.categoryId, categoryIds),
      inArray(competitor.status, [...EXPECTED_COMPETITOR_STATUSES]),
      isNull(competitor.deletedAt),
    ),
  })
}

export async function activeAscentsFor(
  db: Database,
  roundId: string,
  routeId: string,
  competitorIds: string[],
): Promise<Map<string, AscentRow>> {
  if (competitorIds.length === 0) return new Map()
  const rows = await db.query.ascent.findMany({
    where: and(
      eq(ascent.roundId, roundId),
      eq(ascent.routeId, routeId),
      inArray(ascent.competitorId, competitorIds),
      isNull(ascent.supersededBy),
      isNull(ascent.conflictGroup),
    ),
  })
  return new Map(rows.map((row) => [row.competitorId, row]))
}
