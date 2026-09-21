import { ROUND_STATUS_TRANSITIONS, type ChangeRoundStatusInput } from '@climbcontest/contracts'
import {
  ascent,
  competitor,
  round,
  roundCategory,
  roundRoute,
  route,
  type Database,
} from '@climbcontest/db'
import { and, asc, eq, inArray, isNotNull, isNull, ne } from 'drizzle-orm'

import { ApiError } from '../middleware/problem'

type RoundStatus = ChangeRoundStatusInput['status']

const ROUND_TYPE_LABELS: Record<string, string> = {
  qualification: 'Qualification',
  semifinal: 'Demi-finale',
  final: 'Finale',
}

/** Lot 8 (DECISIONS.md) — graphe de transition partagé avec `packages/contracts`. */
export function isValidRoundTransition(from: RoundStatus, to: RoundStatus): boolean {
  return ROUND_STATUS_TRANSITIONS[from].includes(to)
}

/**
 * Publier un tour rend son classement définitif et visible du public — un
 * conflit de saisie non résolu sur une de ses voies ne doit jamais se
 * retrouver silencieusement absent (ou pire, arbitrairement retenu) du
 * classement publié. Un conflit est toujours interne à un même
 * (tour, voie, compétiteur) : chercher par `roundId` suffit, pas besoin de
 * remonter par `round_route`.
 *
 * ADR-065 : ne regarde que les compétiteurs de la catégorie publiée — un
 * conflit chez les U18 ne retient pas la publication des U16.
 */
export async function roundHasUnresolvedConflicts(
  db: Database,
  roundId: string,
  categoryId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: ascent.id })
    .from(ascent)
    .innerJoin(competitor, eq(competitor.id, ascent.competitorId))
    .where(
      and(
        eq(ascent.roundId, roundId),
        eq(competitor.categoryId, categoryId),
        isNotNull(ascent.conflictGroup),
        // ADR-078 : une saisie refusée garde son groupe, sans plus rien bloquer.
        isNull(ascent.voidedAt),
      ),
    )
    .limit(1)
  return row !== undefined
}

/**
 * Ouvrir une catégorie d'un tour est refusé tant qu'une voie qu'elle utilise
 * sert déjà dans un AUTRE tour ouvert (ADR-065). Avec un statut par catégorie
 * cela devient possible — la qualification des U18 et la demi-finale des U16
 * peuvent se chevaucher — et l'écran juge ne sait montrer qu'un tour par
 * voie : le juge ne saurait plus qui est en train de grimper.
 */
export async function assertRoutesFreeToOpen(
  db: Database,
  competitionId: string,
  roundId: string,
  categoryId: string,
): Promise<void> {
  const routes = await db
    .select({ routeId: roundRoute.routeId })
    .from(roundRoute)
    .where(and(eq(roundRoute.roundId, roundId), eq(roundRoute.categoryId, categoryId)))
  const routeIds = routes.map((row) => row.routeId)
  if (routeIds.length === 0) return

  const [clash] = await db
    .selectDistinct({
      routeNumber: route.number,
      roundType: round.type,
      displayOrder: round.displayOrder,
    })
    .from(roundRoute)
    .innerJoin(round, eq(round.id, roundRoute.roundId))
    .innerJoin(route, eq(route.id, roundRoute.routeId))
    .innerJoin(
      roundCategory,
      and(
        eq(roundCategory.roundId, roundRoute.roundId),
        eq(roundCategory.categoryId, roundRoute.categoryId),
        eq(roundCategory.status, 'open'),
      ),
    )
    .where(
      and(
        eq(round.competitionId, competitionId),
        isNull(round.deletedAt),
        ne(round.id, roundId),
        inArray(roundRoute.routeId, routeIds),
      ),
    )
    .orderBy(asc(round.displayOrder), asc(route.number))
    .limit(1)

  if (clash) {
    const label = ROUND_TYPE_LABELS[clash.roundType] ?? clash.roundType
    throw new ApiError(
      409,
      'Voie déjà utilisée',
      `La voie ${clash.routeNumber} sert déjà dans « ${label} », qui est ouvert. Fermez-le pour les catégories concernées avant d’ouvrir celui-ci : un juge ne peut suivre qu’un tour à la fois sur une voie.`,
    )
  }
}
