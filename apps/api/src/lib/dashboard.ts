import type { DashboardAlert, DashboardResponse } from '@climbcontest/contracts'
import {
  ascent,
  category,
  judge,
  judgeRoute,
  round,
  roundCategory,
  roundRoute,
  route,
  type Database,
} from '@climbcontest/db'
import { and, eq, inArray, isNull } from 'drizzle-orm'

import { activeAscentsFor, expectedCompetitors } from './ascent-progress'
import { statusExpression } from './round-category'

const ROUTE_STALLED_THRESHOLD_MS = 15 * 60 * 1000
const JUDGE_SILENT_THRESHOLD_MS = 10 * 60 * 1000

function minutesSince(now: Date, since: Date): number {
  return Math.round((now.getTime() - since.getTime()) / 60_000)
}

/**
 * Vue d'ensemble jour J (ROADMAP.md Lot 8) : progression par catégorie/voie,
 * compétiteurs sans passage, état des juges, alertes. Rafraîchie par
 * polling côté client (DECISIONS.md), donc recalculée à chaque appel — pas
 * de cache, contrairement au classement public (échelle très différente :
 * 1-2 organisateurs, pas 300 spectateurs).
 */
export async function computeDashboard(
  db: Database,
  competitionId: string,
  now: () => Date,
): Promise<DashboardResponse> {
  const nowDate = now()

  const categories = await db.query.category.findMany({
    where: and(eq(category.competitionId, competitionId), isNull(category.deletedAt)),
    orderBy: (c, { asc }) => [asc(c.displayOrder)],
  })

  const roundRoutes = await db
    .select({
      roundId: roundRoute.roundId,
      routeId: roundRoute.routeId,
      categoryId: roundRoute.categoryId,
      // ADR-065 : le statut du couple (tour, catégorie) ; ligne absente = brouillon.
      roundStatus: statusExpression,
      roundUpdatedAt: round.updatedAt,
      pairUpdatedAt: roundCategory.updatedAt,
      routeNumber: route.number,
      routeName: route.name,
    })
    .from(roundRoute)
    .innerJoin(round, eq(round.id, roundRoute.roundId))
    .innerJoin(route, eq(route.id, roundRoute.routeId))
    .leftJoin(
      roundCategory,
      and(
        eq(roundCategory.roundId, roundRoute.roundId),
        eq(roundCategory.categoryId, roundRoute.categoryId),
      ),
    )
    .where(and(eq(round.competitionId, competitionId), isNull(round.deletedAt), isNull(route.deletedAt)))

  const alerts: DashboardAlert[] = []
  const routesByCategory = new Map<string, DashboardResponse['categories'][number]['routes']>()
  const pendingByCompetitor = new Map<
    string,
    { competitorId: string; bib: number | null; firstName: string; lastName: string; categoryLabel: string; remainingRouteNumbers: number[] }
  >()
  const categoryLabelById = new Map(categories.map((cat) => [cat.id, cat.label]))
  // (roundId, categoryId) -> routeIds, uniquement pour les tours fermés
  // (compétiteur sans AUCUN passage sur le tour entier, pas voie par voie).
  const closedRoundCategoryRoutes = new Map<string, { roundId: string; categoryId: string; routeIds: string[] }>()

  for (const rr of roundRoutes) {
    const expected = await expectedCompetitors(db, competitionId, [rr.categoryId], rr.roundId)
    const active = await activeAscentsFor(db, rr.roundId, rr.routeId, expected.map((e) => e.id))
    const lastAscentAt = [...active.values()].reduce<Date | null>(
      (max, a) => (max === null || a.recordedAt > max ? a.recordedAt : max),
      null,
    )

    const list = routesByCategory.get(rr.categoryId) ?? []
    list.push({
      routeId: rr.routeId,
      number: rr.routeNumber,
      name: rr.routeName,
      roundId: rr.roundId,
      roundStatus: rr.roundStatus,
      done: active.size,
      expected: expected.length,
      lastAscentAt: lastAscentAt?.toISOString() ?? null,
    })
    routesByCategory.set(rr.categoryId, list)

    if (rr.roundStatus === 'open') {
      const stillExpected = expected.length - active.size
      if (stillExpected > 0) {
        // Sans passage du tout : on prend l'heure de mise à jour du couple
        // (tour, catégorie) comme approximation de « depuis l'ouverture » — il
        // n'a pas de véritable horodatage d'ouverture séparé (TODO.md, limite
        // connue). Le repli sur le tour ne sert qu'aux lignes sans couple.
        const anchor = lastAscentAt ?? rr.pairUpdatedAt ?? rr.roundUpdatedAt
        const elapsedMs = nowDate.getTime() - anchor.getTime()
        if (elapsedMs >= ROUTE_STALLED_THRESHOLD_MS) {
          alerts.push({
            type: 'route_stalled',
            routeId: rr.routeId,
            routeNumber: rr.routeNumber,
            roundId: rr.roundId,
            minutesSinceLastAscent: lastAscentAt ? minutesSince(nowDate, lastAscentAt) : null,
          })
        }
      }

      for (const comp of expected) {
        if (!active.has(comp.id)) {
          const entry = pendingByCompetitor.get(comp.id) ?? {
            competitorId: comp.id,
            bib: comp.bib,
            firstName: comp.firstName,
            lastName: comp.lastName,
            categoryLabel: categoryLabelById.get(rr.categoryId) ?? '',
            remainingRouteNumbers: [],
          }
          entry.remainingRouteNumbers.push(rr.routeNumber)
          pendingByCompetitor.set(comp.id, entry)
        }
      }
    }

    if (rr.roundStatus === 'closed') {
      const key = `${rr.roundId}:${rr.categoryId}`
      const group = closedRoundCategoryRoutes.get(key) ?? {
        roundId: rr.roundId,
        categoryId: rr.categoryId,
        routeIds: [],
      }
      group.routeIds.push(rr.routeId)
      closedRoundCategoryRoutes.set(key, group)
    }
  }

  for (const group of closedRoundCategoryRoutes.values()) {
    const expected = await expectedCompetitors(db, competitionId, [group.categoryId], group.roundId)
    if (expected.length === 0) continue
    const activeRows = await db.query.ascent.findMany({
      where: and(
        eq(ascent.roundId, group.roundId),
        inArray(ascent.routeId, group.routeIds),
        inArray(
          ascent.competitorId,
          expected.map((e) => e.id),
        ),
        isNull(ascent.supersededBy),
        isNull(ascent.conflictGroup),
      ),
    })
    const competitorsWithAscent = new Set(activeRows.map((row) => row.competitorId))
    for (const comp of expected) {
      if (!competitorsWithAscent.has(comp.id)) {
        alerts.push({
          type: 'competitor_no_ascent',
          competitorId: comp.id,
          bib: comp.bib,
          firstName: comp.firstName,
          lastName: comp.lastName,
          roundId: group.roundId,
        })
      }
    }
  }

  const openRouteIds = new Set(
    roundRoutes.filter((rr) => rr.roundStatus === 'open').map((rr) => rr.routeId),
  )

  const judgeRows = await db.query.judge.findMany({
    where: and(eq(judge.competitionId, competitionId), isNull(judge.deletedAt)),
  })
  const judges: DashboardResponse['judges'] = []
  for (const judgeRow of judgeRows) {
    const assignments = await db.query.judgeRoute.findMany({
      where: eq(judgeRoute.judgeId, judgeRow.id),
    })
    const ascentCountRows = await db.query.ascent.findMany({
      where: eq(ascent.recordedByJudgeId, judgeRow.id),
    })
    judges.push({
      judgeId: judgeRow.id,
      displayName: judgeRow.displayName,
      revokedAt: judgeRow.revokedAt?.toISOString() ?? null,
      lastSeenAt: judgeRow.lastSeenAt?.toISOString() ?? null,
      ascentCount: ascentCountRows.length,
    })

    const assignedToOpenRoute = assignments.some((a) => openRouteIds.has(a.routeId))
    if (!judgeRow.revokedAt && assignedToOpenRoute) {
      const silentMs = judgeRow.lastSeenAt ? nowDate.getTime() - judgeRow.lastSeenAt.getTime() : null
      if (silentMs === null || silentMs >= JUDGE_SILENT_THRESHOLD_MS) {
        alerts.push({
          type: 'judge_silent',
          judgeId: judgeRow.id,
          judgeDisplayName: judgeRow.displayName,
          minutesSinceLastSeen: judgeRow.lastSeenAt ? minutesSince(nowDate, judgeRow.lastSeenAt) : null,
        })
      }
    }
  }

  const conflictRows = await db.query.ascent.findMany({
    where: and(eq(ascent.competitionId, competitionId), isNull(ascent.supersededBy)),
    columns: { conflictGroup: true, routeId: true, competitorId: true },
  })
  const seenConflictGroups = new Set<string>()
  for (const row of conflictRows) {
    if (!row.conflictGroup || seenConflictGroups.has(row.conflictGroup)) continue
    seenConflictGroups.add(row.conflictGroup)
    alerts.push({
      type: 'unresolved_conflict',
      conflictGroup: row.conflictGroup,
      routeId: row.routeId,
      competitorId: row.competitorId,
    })
  }

  return {
    computedAt: nowDate.toISOString(),
    categories: categories.map((cat) => ({
      categoryId: cat.id,
      label: cat.label,
      routes: routesByCategory.get(cat.id) ?? [],
    })),
    competitorsPending: [...pendingByCompetitor.values()],
    judges,
    alerts,
  }
}
