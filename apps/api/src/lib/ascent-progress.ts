import { ascentMatrixResponseSchema, type AscentMatrixResponse } from '@climbcontest/contracts'
import {
  ascent,
  category,
  competitor,
  round,
  roundRoute,
  route,
  routeCategory,
  type Database,
} from '@climbcontest/db'
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm'

import { restrictToFrozenQualifiers } from './round-qualifiers'

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

/**
 * Les compétiteurs attendus sur ces catégories. Avec `roundId`, la liste est
 * restreinte à la liste figée des qualifiés de ce tour quand elle existe
 * (ADR-054) — sans quoi un juge verrait aussi les non-qualifiés en
 * demi-finale ou en finale. Sans `roundId`, aucune restriction de tour.
 */
export async function expectedCompetitors(
  db: Database,
  competitionId: string,
  categoryIds: string[],
  roundId?: string,
): Promise<CompetitorRow[]> {
  if (categoryIds.length === 0) return []
  const rows = await db.query.competitor.findMany({
    where: and(
      eq(competitor.competitionId, competitionId),
      inArray(competitor.categoryId, categoryIds),
      inArray(competitor.status, [...EXPECTED_COMPETITOR_STATUSES]),
      isNull(competitor.deletedAt),
    ),
  })
  return roundId ? restrictToFrozenQualifiers(db, roundId, rows) : rows
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

/**
 * La grille compétiteurs × voies d'un couple (tour, catégorie) — ROADMAP.md
 * Lot 20, point d'agrégat cadré en début de lot (DECISIONS.md ADR-083).
 *
 * Borné au couple : les voies sont alors les mêmes pour toute la colonne de
 * compétiteurs, et le volume reste celui d'une catégorie (~30 × 4). Réutilise
 * `expectedCompetitors` (donc la restriction aux qualifiés figés d'ADR-054) et
 * `activeAscentsFor` pour compter EXACTEMENT comme le tableau de bord et
 * l'écran juge.
 *
 * Renvoie `null` si le couple n'existe pas — l'appelant en fait un 404.
 *
 * La réponse est validée ici et non dans la route : `ascent.modifier` et
 * `ascent.status` sont des colonnes texte à CHECK, donc typées `string` par
 * Drizzle ; c'est le schéma Zod qui les rétrécit, comme `GET /` le fait déjà
 * avec `judgeRouteCompetitorSchema`.
 */
export async function buildAscentMatrix(
  db: Database,
  competitionId: string,
  roundId: string,
  categoryId: string,
): Promise<AscentMatrixResponse | null> {
  const routes = await db
    .select({
      routeId: route.id,
      number: route.number,
      name: route.name,
      holdCount: route.holdCount,
    })
    .from(roundRoute)
    .innerJoin(round, eq(round.id, roundRoute.roundId))
    .innerJoin(route, eq(route.id, roundRoute.routeId))
    .where(
      and(
        eq(roundRoute.roundId, roundId),
        eq(roundRoute.categoryId, categoryId),
        eq(round.competitionId, competitionId),
        isNull(round.deletedAt),
        isNull(route.deletedAt),
      ),
    )
    .orderBy(route.number)

  if (routes.length === 0) return null

  const competitors = await expectedCompetitors(db, competitionId, [categoryId], roundId)
  const competitorIds = competitors.map((comp) => comp.id)
  const routeIds = routes.map((r) => r.routeId)

  const activeByRoute = new Map<string, Map<string, AscentRow>>()
  for (const r of routes) {
    activeByRoute.set(r.routeId, await activeAscentsFor(db, roundId, r.routeId, competitorIds))
  }

  /*
   * `activeAscentsFor` écarte les saisies en conflit : sans cette seconde
   * requête, une case à trancher s'afficherait vide, donc identique à un
   * passage jamais saisi. Les deux appellent pourtant des gestes opposés.
   * `voidedAt` exclut une saisie déjà refusée (ADR-078).
   */
  const conflicted = new Set<string>()
  if (competitorIds.length > 0) {
    const rows = await db.query.ascent.findMany({
      where: and(
        eq(ascent.roundId, roundId),
        inArray(ascent.routeId, routeIds),
        inArray(ascent.competitorId, competitorIds),
        isNull(ascent.supersededBy),
        isNull(ascent.voidedAt),
        isNotNull(ascent.conflictGroup),
      ),
      columns: { routeId: true, competitorId: true },
    })
    for (const row of rows) conflicted.add(`${row.routeId}:${row.competitorId}`)
  }

  return ascentMatrixResponseSchema.parse({
    roundId,
    categoryId,
    routes,
    competitors: competitors.map((comp) => ({
      competitorId: comp.id,
      bib: comp.bib,
      firstName: comp.firstName,
      lastName: comp.lastName,
      cells: routes.map((r) => {
        const existing = activeByRoute.get(r.routeId)?.get(comp.id)
        return {
          routeId: r.routeId,
          ascent: existing
            ? {
                id: existing.id,
                holdNumber: existing.holdNumber,
                modifier: existing.modifier,
                isTop: existing.isTop,
                status: existing.status,
                climbTimeMs: existing.climbTimeMs,
                recordedAt: existing.recordedAt.toISOString(),
              }
            : null,
          conflict: conflicted.has(`${r.routeId}:${comp.id}`),
        }
      }),
    })),
  })
}
