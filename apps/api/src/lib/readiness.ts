import {
  category,
  competitor,
  judge,
  judgeRoute,
  round,
  roundRoute,
  route,
  routeCategory,
  type Database,
} from '@climbcontest/db'
import type { ReadinessResponse } from '@climbcontest/contracts'
import { and, eq, isNull } from 'drizzle-orm'

const ROUND_TYPE_LABELS: Record<string, string> = {
  qualification: 'Qualification',
  semifinal: 'Demi-finale',
  final: 'Finale',
}

export async function computeReadiness(
  db: Database,
  competitionId: string,
  format: string,
): Promise<ReadinessResponse> {
  const categoriesWithoutRoute = await db
    .select({ id: category.id, label: category.label })
    .from(category)
    .leftJoin(routeCategory, eq(routeCategory.categoryId, category.id))
    .where(
      and(
        eq(category.competitionId, competitionId),
        isNull(category.deletedAt),
        isNull(routeCategory.categoryId),
      ),
    )

  const routesWithoutCategory = await db
    .select({ id: route.id, number: route.number, name: route.name })
    .from(route)
    .leftJoin(routeCategory, eq(routeCategory.routeId, route.id))
    .where(
      and(
        eq(route.competitionId, competitionId),
        isNull(route.deletedAt),
        isNull(routeCategory.routeId),
      ),
    )

  const competitorsWithoutBib = await db
    .select({ id: competitor.id, firstName: competitor.firstName, lastName: competitor.lastName })
    .from(competitor)
    .where(
      and(
        eq(competitor.competitionId, competitionId),
        isNull(competitor.deletedAt),
        isNull(competitor.bib),
      ),
    )

  // Une voie assignée uniquement à un juge révoqué compte comme non
  // couverte — d'où deux requêtes (plutôt qu'un LEFT JOIN filtré, qui
  // produirait un faux positif dès qu'une voie a plusieurs juges dont un
  // seul actif) plutôt qu'une jointure unique.
  const activeAssignments = await db
    .select({ routeId: judgeRoute.routeId })
    .from(judgeRoute)
    .innerJoin(judge, eq(judge.id, judgeRoute.judgeId))
    .where(and(isNull(judge.revokedAt), isNull(judge.deletedAt)))
  const assignedRouteIds = new Set(activeAssignments.map((row) => row.routeId))
  const allRoutes = await db
    .select({ id: route.id, number: route.number, name: route.name })
    .from(route)
    .where(and(eq(route.competitionId, competitionId), isNull(route.deletedAt)))
  const routesWithoutJudge = allRoutes.filter((row) => !assignedRouteIds.has(row.id))

  const checks: ReadinessResponse['checks'] = [
    {
      id: 'category_without_route',
      ok: categoriesWithoutRoute.length === 0,
      items: categoriesWithoutRoute.map((row) => ({ id: row.id, label: row.label })),
    },
    {
      id: 'route_without_category',
      ok: routesWithoutCategory.length === 0,
      items: routesWithoutCategory.map((row) => ({
        id: row.id,
        label: row.name ? `Voie ${row.number} — ${row.name}` : `Voie ${row.number}`,
      })),
    },
    {
      id: 'competitor_without_bib',
      ok: competitorsWithoutBib.length === 0,
      items: competitorsWithoutBib.map((row) => ({
        id: row.id,
        label: `${row.firstName} ${row.lastName}`,
      })),
    },
    {
      id: 'route_without_judge',
      ok: routesWithoutJudge.length === 0,
      items: routesWithoutJudge.map((row) => ({
        id: row.id,
        label: row.name ? `Voie ${row.number} — ${row.name}` : `Voie ${row.number}`,
      })),
    },
  ]

  // Sans objet en mode contest : le round implicite est synchronisé
  // automatiquement (voir routes/categories.ts, routes/routes.ts) et
  // n'est jamais géré par l'organisateur.
  if (format === 'phases') {
    const roundsWithoutRoute = await db
      .select({
        id: round.id,
        type: round.type,
        displayOrder: round.displayOrder,
      })
      .from(round)
      .leftJoin(roundRoute, eq(roundRoute.roundId, round.id))
      .where(
        and(
          eq(round.competitionId, competitionId),
          isNull(round.deletedAt),
          isNull(roundRoute.roundId),
        ),
      )

    checks.push({
      id: 'round_without_route',
      ok: roundsWithoutRoute.length === 0,
      items: roundsWithoutRoute.map((row) => ({
        id: row.id,
        label: `${ROUND_TYPE_LABELS[row.type] ?? row.type} (tour ${row.displayOrder + 1})`,
      })),
    })
  }

  return { ready: checks.every((check) => check.ok), checks }
}
