import type { RoundStatus } from '@climbcontest/contracts'
import { round, roundCategory, type Database } from '@climbcontest/db'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'

/**
 * ADR-065 — le statut d'un tour se porte par catégorie. Une ligne absente de
 * `round_category` vaut `draft` : toute lecture du statut passe par ce module
 * (ou par `statusExpression` dans un `LEFT JOIN`), jamais par une lecture
 * directe de la table qui oublierait cette règle.
 */

type RoundRow = typeof round.$inferSelect

/** Écrit au `LEFT JOIN round_category` : statut effectif, `draft` si pas de ligne. */
export const statusExpression = sql<RoundStatus>`coalesce(${roundCategory.status}, 'draft')`

/** Clé d'une entrée de `loadStatuses`. */
export function pairKey(roundId: string, categoryId: string): string {
  return `${roundId}:${categoryId}`
}

/** Le statut effectif de chaque couple (tour, catégorie) demandé, `draft` par défaut. */
export async function loadStatuses(
  db: Pick<Database, 'select'>,
  pairs: readonly { roundId: string; categoryId: string }[],
): Promise<Map<string, RoundStatus>> {
  const statuses = new Map<string, RoundStatus>()
  if (pairs.length === 0) return statuses
  for (const pair of pairs) statuses.set(pairKey(pair.roundId, pair.categoryId), 'draft')

  const roundIds = [...new Set(pairs.map((pair) => pair.roundId))]
  const rows = await db
    .select({
      roundId: roundCategory.roundId,
      categoryId: roundCategory.categoryId,
      status: roundCategory.status,
    })
    .from(roundCategory)
    .where(inArray(roundCategory.roundId, roundIds))
  for (const row of rows) {
    const key = pairKey(row.roundId, row.categoryId)
    // Seuls les couples demandés sont rendus : la table peut garder une ligne
    // pour une catégorie qui a quitté le tour.
    if (statuses.has(key)) statuses.set(key, row.status as RoundStatus)
  }
  return statuses
}

/**
 * Le tour, s'il existe dans cette compétition (hors corbeille) ET est ouvert
 * pour cette catégorie — c'est la condition d'une saisie de passage. `undefined`
 * sinon, sans dire lequel des deux manque (l'appelant répond « pas ouvert »).
 */
export async function findRoundOpenForCategory(
  db: Pick<Database, 'select'>,
  competitionId: string,
  roundId: string,
  categoryId: string,
): Promise<RoundRow | undefined> {
  const [row] = await db
    .select({ round })
    .from(round)
    .innerJoin(
      roundCategory,
      and(
        eq(roundCategory.roundId, round.id),
        eq(roundCategory.categoryId, categoryId),
        eq(roundCategory.status, 'open'),
      ),
    )
    .where(
      and(eq(round.id, roundId), eq(round.competitionId, competitionId), isNull(round.deletedAt)),
    )
    .limit(1)
  return row?.round
}

/** Écrit (ou met à jour) le statut d'un couple — à appeler dans la transaction du changement. */
export async function setStatus(
  tx: Pick<Database, 'insert'>,
  roundId: string,
  categoryId: string,
  status: RoundStatus,
): Promise<void> {
  await tx
    .insert(roundCategory)
    .values({ roundId, categoryId, status })
    .onConflictDoUpdate({
      target: [roundCategory.roundId, roundCategory.categoryId],
      set: { status, updatedAt: new Date() },
    })
}
