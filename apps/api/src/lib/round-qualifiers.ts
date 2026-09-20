import type { RoundQualifiersResponse, RoundStatus } from '@climbcontest/contracts'
import {
  ascent,
  category,
  competition,
  competitor,
  round,
  roundQualifier,
  roundRoute,
  type Database,
} from '@climbcontest/db'
import { getQualifiers } from '@climbcontest/scoring'
import { and, asc, desc, eq, gt, inArray, isNull, lt } from 'drizzle-orm'

import { computeCategoryRounds } from './public-ranking'
import { loadStatuses, pairKey } from './round-category'
import { ApiError } from '../middleware/problem'

/** Ce que la transaction du changement de statut fournit — `Database` complet n'est pas satisfait par un client de transaction. */
type QualifierWriter = Pick<Database, 'insert' | 'delete'>

type CompetitionRow = typeof competition.$inferSelect
type RoundRow = typeof round.$inferSelect

const ROUND_TYPE_LABELS: Record<string, string> = {
  qualification: 'Qualification',
  semifinal: 'Demi-finale',
  final: 'Finale',
}

function roundLabel(row: Pick<RoundRow, 'type'>): string {
  return ROUND_TYPE_LABELS[row.type] ?? row.type
}

interface PreviousRound {
  roundId: string
  type: RoundRow['type']
  /** ADR-065 : le statut du COUPLE (tour précédent, cette catégorie). */
  status: RoundStatus
  qualifyingCount: number | null
}

/** Les catégories qu'un tour fait grimper, via `round_route`. */
export async function categoryIdsOfRound(db: Database, roundId: string): Promise<string[]> {
  const rows = await db
    .select({ categoryId: roundRoute.categoryId })
    .from(roundRoute)
    .where(eq(roundRoute.roundId, roundId))
  return [...new Set(rows.map((row) => row.categoryId))]
}

/**
 * Pour chaque catégorie de `target`, le tour qui la précède : le tour de
 * `display_order` immédiatement inférieur qui a au moins une voie pour cette
 * catégorie (une catégorie peut sauter un tour). Absent de la map = premier
 * tour de cette catégorie.
 */
async function previousRoundByCategory(
  db: Database,
  competitionId: string,
  target: Pick<RoundRow, 'id' | 'displayOrder'>,
  categoryIds: readonly string[],
): Promise<Map<string, PreviousRound>> {
  if (categoryIds.length === 0) return new Map()
  const rows = await db
    .select({
      categoryId: roundRoute.categoryId,
      roundId: round.id,
      type: round.type,
      qualifyingCount: round.qualifyingCount,
    })
    .from(roundRoute)
    .innerJoin(round, eq(round.id, roundRoute.roundId))
    .where(
      and(
        eq(round.competitionId, competitionId),
        isNull(round.deletedAt),
        lt(round.displayOrder, target.displayOrder),
        inArray(roundRoute.categoryId, [...categoryIds]),
      ),
    )
    .orderBy(desc(round.displayOrder))

  const byCategory = new Map<string, PreviousRound>()
  for (const row of rows) {
    // Trié par `display_order` décroissant : la première ligne vue pour une
    // catégorie est le tour précédent immédiat.
    if (!byCategory.has(row.categoryId)) {
      byCategory.set(row.categoryId, {
        roundId: row.roundId,
        type: row.type,
        status: 'draft',
        qualifyingCount: row.qualifyingCount,
      })
    }
  }
  const statuses = await loadStatuses(
    db,
    [...byCategory].map(([categoryId, previous]) => ({ roundId: previous.roundId, categoryId })),
  )
  for (const [categoryId, previous] of byCategory) {
    previous.status = statuses.get(pairKey(previous.roundId, categoryId)) ?? 'draft'
  }
  return byCategory
}

export interface QualifierPlanEntry {
  categoryId: string
  sourceRoundId: string
  qualifiers: { competitorId: string; sourceRank: number }[]
}

/**
 * Prépare la liste des qualifiés d'un tour qui va passer de `draft` à `open`
 * (ADR-054). Lecture seule : l'écriture est faite par `saveFrozenQualifiers`
 * dans la transaction qui change le statut.
 *
 * ADR-065 : ne concerne que les `categoryIds` demandées. Refuse d'ouvrir tant
 * que le tour précédent de l'une d'elles n'est pas `closed` ou `published`
 * POUR CETTE CATÉGORIE — sinon la liste serait calculée sur un classement
 * encore en cours de saisie. Les autres catégories du tour précédent, qui
 * peuvent encore grimper, ne bloquent rien.
 */
export async function planQualifiersForOpening(
  db: Database,
  currentCompetition: CompetitionRow,
  target: RoundRow,
  categoryIds: readonly string[],
): Promise<QualifierPlanEntry[]> {
  const previousByCategory = await previousRoundByCategory(
    db,
    currentCompetition.id,
    target,
    categoryIds,
  )

  const notReady = [...previousByCategory.values()].filter(
    (previous) => previous.status !== 'closed' && previous.status !== 'published',
  )
  if (notReady.length > 0) {
    const names = [...new Set(notReady.map((previous) => `« ${roundLabel(previous)} »`))]
    throw new ApiError(
      409,
      'Tour précédent non terminé',
      `Fermez d’abord ${names.join(' et ')} : la liste des qualifiés de « ${roundLabel(target)} » se calcule sur un classement terminé.`,
    )
  }

  const plan: QualifierPlanEntry[] = []
  for (const [categoryId, previous] of previousByCategory) {
    const { perRound } = await computeCategoryRounds(db, currentCompetition, categoryId, {
      stopAfterRoundId: previous.roundId,
    })
    const previousComputation = perRound.find((r) => r.roundId === previous.roundId)
    if (!previousComputation) continue

    const ranking = previousComputation.ranking
    const rankByCompetitor = new Map(ranking.entries.map((e) => [e.competitorId, e.rank]))
    // Aucun compétiteur dans le classement : `getQualifiers` refuse un
    // `qualifyingCount` de 0, mais le résultat est trivial (personne).
    const ids =
      ranking.entries.length === 0
        ? []
        : getQualifiers(ranking, previous.qualifyingCount ?? ranking.entries.length)

    plan.push({
      categoryId,
      sourceRoundId: previous.roundId,
      qualifiers: ids.map((competitorId) => ({
        competitorId,
        // Non-null : `ids` est extrait de `ranking.entries`.
        sourceRank: rankByCompetitor.get(competitorId)!,
      })),
    })
  }
  return plan
}

/**
 * Écrit la liste dans la transaction qui ouvre le tour. Remplace la liste
 * antérieure des seules `categoryIds` ouvertes : les autres catégories du tour
 * gardent la leur (ADR-065).
 */
export async function saveFrozenQualifiers(
  tx: QualifierWriter,
  roundId: string,
  actorUserId: string,
  categoryIds: readonly string[],
  plan: readonly QualifierPlanEntry[],
): Promise<void> {
  await deleteFrozenQualifiers(tx, roundId, categoryIds)
  const rows = plan.flatMap((entry) =>
    entry.qualifiers.map((q) => ({
      roundId,
      categoryId: entry.categoryId,
      competitorId: q.competitorId,
      sourceRoundId: entry.sourceRoundId,
      sourceRank: q.sourceRank,
      frozenByUserId: actorUserId,
    })),
  )
  if (rows.length > 0) await tx.insert(roundQualifier).values(rows)
}

export async function deleteFrozenQualifiers(
  tx: QualifierWriter,
  roundId: string,
  categoryIds: readonly string[],
): Promise<void> {
  if (categoryIds.length === 0) return
  await tx
    .delete(roundQualifier)
    .where(
      and(
        eq(roundQualifier.roundId, roundId),
        inArray(roundQualifier.categoryId, [...categoryIds]),
      ),
    )
}

/**
 * Rouvrir un tour pour une catégorie dont le tour suivant a déjà été ouvert
 * PÉRIMERAIT la liste figée de celui-ci (ADR-054). Le message dit quoi faire.
 * ADR-065 : seul le tour suivant DE CETTE CATÉGORIE compte.
 */
export async function assertRoundCanBeReopened(
  db: Database,
  competitionId: string,
  target: RoundRow,
  categoryId: string,
): Promise<void> {
  const later = await db
    .selectDistinct({ roundId: round.id, type: round.type })
    .from(roundRoute)
    .innerJoin(round, eq(round.id, roundRoute.roundId))
    .where(
      and(
        eq(round.competitionId, competitionId),
        isNull(round.deletedAt),
        gt(round.displayOrder, target.displayOrder),
        eq(roundRoute.categoryId, categoryId),
      ),
    )
    .orderBy(asc(round.type))

  const statuses = await loadStatuses(
    db,
    later.map((r) => ({ roundId: r.roundId, categoryId })),
  )
  const first = later.find((r) => statuses.get(pairKey(r.roundId, categoryId)) !== 'draft')
  if (first) {
    throw new ApiError(
      409,
      'Réouverture impossible',
      `« ${roundLabel(first)} » est déjà ouvert : sa liste de qualifiés est figée. Remettez-le d’abord en brouillon (possible tant qu’il n’a aucun passage), puis rouvrez « ${roundLabel(target)} ».`,
    )
  }
}

/**
 * Repasser un tour en brouillon efface sa liste figée — donc jamais tant
 * qu'il contient un passage, actif ou en conflit (ADR-054). ADR-065 : on ne
 * regarde que les passages des compétiteurs de la catégorie concernée.
 */
export async function assertRoundIsEmptyForDraft(
  db: Database,
  roundId: string,
  categoryId: string,
): Promise<void> {
  const rows = await db
    .select({ id: ascent.id })
    .from(ascent)
    .innerJoin(competitor, eq(competitor.id, ascent.competitorId))
    .where(and(eq(ascent.roundId, roundId), eq(competitor.categoryId, categoryId)))
    .limit(1)
  if (rows.length > 0) {
    throw new ApiError(
      409,
      'Retour en brouillon impossible',
      'Ce tour contient déjà des passages : il ne peut plus être remis en préparation. Fermez-le, ou corrigez les passages depuis l’onglet Voies.',
    )
  }
}

/**
 * Restreint des compétiteurs attendus à la liste figée d'un tour : par
 * catégorie, si une liste existe elle fait foi ; sinon la catégorie n'est
 * pas restreinte (premier tour, ou tour antérieur au Lot 9).
 */
export async function restrictToFrozenQualifiers<T extends { id: string; categoryId: string }>(
  db: Database,
  roundId: string,
  competitors: readonly T[],
): Promise<T[]> {
  if (competitors.length === 0) return []
  const rows = await db
    .select({ categoryId: roundQualifier.categoryId, competitorId: roundQualifier.competitorId })
    .from(roundQualifier)
    .where(eq(roundQualifier.roundId, roundId))
  if (rows.length === 0) return [...competitors]

  const restrictedCategories = new Set(rows.map((row) => row.categoryId))
  const qualified = new Set(rows.map((row) => row.competitorId))
  return competitors.filter(
    (comp) => !restrictedCategories.has(comp.categoryId) || qualified.has(comp.id),
  )
}

/** Refuse la saisie d'un compétiteur absent de la liste figée du tour (ADR-054). */
export async function assertCompetitorQualifiedForRound(
  db: Database,
  roundId: string,
  competitorRow: Pick<typeof competitor.$inferSelect, 'id' | 'categoryId'>,
): Promise<void> {
  const categoryRows = await db
    .select({ competitorId: roundQualifier.competitorId })
    .from(roundQualifier)
    .where(
      and(
        eq(roundQualifier.roundId, roundId),
        eq(roundQualifier.categoryId, competitorRow.categoryId),
      ),
    )
  if (categoryRows.length === 0) return
  if (!categoryRows.some((row) => row.competitorId === competitorRow.id)) {
    throw new ApiError(
      409,
      'Compétiteur non qualifié',
      'Ce compétiteur n’est pas qualifié pour ce tour : sa saisie n’a pas été enregistrée.',
    )
  }
}

/** Vue organisateur : la liste figée par catégorie, avec l'égalité à la limite signalée. */
export async function getRoundQualifiersView(
  db: Database,
  competitionId: string,
  target: RoundRow,
): Promise<RoundQualifiersResponse> {
  const categoryIds = await categoryIdsOfRound(db, target.id)
  if (categoryIds.length === 0) return { roundId: target.id, categories: [] }

  const previousByCategory = await previousRoundByCategory(db, competitionId, target, categoryIds)
  const categories = await db
    .select({ id: category.id, label: category.label, displayOrder: category.displayOrder })
    .from(category)
    .where(inArray(category.id, categoryIds))
    .orderBy(asc(category.displayOrder))

  const frozen = await db
    .select({
      categoryId: roundQualifier.categoryId,
      competitorId: roundQualifier.competitorId,
      sourceRank: roundQualifier.sourceRank,
      frozenAt: roundQualifier.frozenAt,
      bib: competitor.bib,
      firstName: competitor.firstName,
      lastName: competitor.lastName,
    })
    .from(roundQualifier)
    .innerJoin(competitor, eq(competitor.id, roundQualifier.competitorId))
    .where(eq(roundQualifier.roundId, target.id))
    .orderBy(asc(roundQualifier.sourceRank), asc(competitor.lastName))

  return {
    roundId: target.id,
    categories: categories.map((cat) => {
      const rows = frozen.filter((row) => row.categoryId === cat.id)
      const requested = previousByCategory.get(cat.id)?.qualifyingCount ?? null
      const frozenAt = rows.reduce<Date | null>(
        (earliest, row) => (earliest === null || row.frozenAt < earliest ? row.frozenAt : earliest),
        null,
      )
      return {
        categoryId: cat.id,
        categoryLabel: cat.label,
        frozenAt: frozenAt ? frozenAt.toISOString() : null,
        requested,
        count: rows.length,
        tiedAtCutoff: requested !== null && rows.length > requested,
        competitors: rows.map((row) => ({
          competitorId: row.competitorId,
          bib: row.bib,
          firstName: row.firstName,
          lastName: row.lastName,
          sourceRank: row.sourceRank,
        })),
      }
    }),
  }
}
