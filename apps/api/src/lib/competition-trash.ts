import {
  activityLog,
  ascent,
  ascentEvent,
  asset,
  assetUpload,
  category,
  competition,
  competitionDeletionLog,
  competitor,
  judge,
  judgeRoute,
  round,
  roundCategory,
  roundQualifier,
  roundRoute,
  route,
  routeCategory,
  type Database,
} from '@climbcontest/db'
import { and, eq, inArray, isNotNull, isNull, ne, or } from 'drizzle-orm'

import { ApiError } from '../middleware/problem'
import type { StorageAdapter } from './storage'

/**
 * Corbeille des compétitions en deux temps (Lot 11, ADR-063) :
 *  1. `trashCompetition` — réversible : pose `deleted_at`, coupe les accès
 *     juge et public, laisse toutes les données en base ;
 *  2. `permanentlyDeleteCompetition` — irréversible, seulement depuis la
 *     corbeille : efface les fichiers puis toutes les lignes.
 * Chaque étape écrit une ligne dans `competition_deletion_log`, qui survit à la
 * suppression (CLAUDE.md, règle n°3).
 */

type CompetitionRow = typeof competition.$inferSelect

/**
 * Toutes les tables qui référencent `competition`, directement ou par
 * transitivité, dans l'ordre où `permanentlyDeleteCompetition` les vide. Aucune
 * clé étrangère du schéma n'a de `ON DELETE CASCADE` : une table oubliée ferait
 * échouer la suppression, et une table AJOUTÉE plus tard doit l'être ici. Un
 * test compare cette liste au catalogue Postgres pour que ça ne passe pas
 * inaperçu.
 */
export const COMPETITION_OWNED_TABLES = [
  'ascent_event',
  'ascent',
  'round_qualifier',
  'round_category',
  'round_route',
  'route_category',
  'judge_route',
  'asset_upload',
  'route',
  'asset',
  'judge',
  'competitor',
  'round',
  'category',
  'activity_log',
] as const

export const COMPETITION_RUNNING_ERROR = () =>
  new ApiError(
    409,
    'Compétition en cours',
    'Cette compétition est « En cours » : des juges peuvent être en train de saisir. Clôturez-la d’abord (Infos → Changer le statut), puis remettez-la à la corbeille. Si des catégories sont encore ouvertes, fermez-les avant dans l’onglet Pilotage.',
  )

const NOT_FOUND = () =>
  new ApiError(404, 'Compétition introuvable', "Cette compétition n'existe pas.")

/** Met une compétition à la corbeille. Refusée si elle est « En cours ». */
export async function trashCompetition(
  db: Database,
  current: CompetitionRow,
  actorUserId: string,
  now: Date,
): Promise<CompetitionRow> {
  return db.transaction(async (tx) => {
    // Une seule requête conditionnelle : le statut lu par le middleware peut
    // avoir changé depuis (un autre organisateur vient de passer en « En cours »).
    const [row] = await tx
      .update(competition)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          eq(competition.id, current.id),
          isNull(competition.deletedAt),
          ne(competition.status, 'running'),
        ),
      )
      .returning()
    if (!row) {
      const fresh = await tx.query.competition.findFirst({
        where: eq(competition.id, current.id),
      })
      if (fresh && fresh.deletedAt === null && fresh.status === 'running') {
        throw COMPETITION_RUNNING_ERROR()
      }
      throw NOT_FOUND()
    }
    await tx.insert(competitionDeletionLog).values({
      competitionId: row.id,
      clubId: row.clubId,
      competitionName: row.name,
      action: 'trashed',
      actorUserId,
      createdAt: now,
    })
    return row
  })
}

/**
 * Sort une compétition de la corbeille : elle redevient exactement ce qu'elle
 * était. Idempotente : restaurer une compétition déjà active (double clic, deux
 * organisateurs en même temps) la renvoie telle quelle, sans erreur ni trace.
 */
export async function restoreCompetition(
  db: Database,
  current: CompetitionRow,
  actorUserId: string,
  now: Date,
): Promise<CompetitionRow> {
  if (current.deletedAt === null) return current
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(competition)
      .set({ deletedAt: null, updatedAt: now })
      .where(and(eq(competition.id, current.id), isNotNull(competition.deletedAt)))
      .returning()
    if (!row) {
      // Restaurée entre-temps par quelqu'un d'autre.
      const fresh = await tx.query.competition.findFirst({ where: eq(competition.id, current.id) })
      if (fresh) return fresh
      throw NOT_FOUND()
    }
    await tx.insert(competitionDeletionLog).values({
      competitionId: row.id,
      clubId: row.clubId,
      competitionName: row.name,
      action: 'restored',
      actorUserId,
      createdAt: now,
    })
    return row
  })
}

export interface PermanentDeleteDeps {
  db: Database
  storage?: StorageAdapter | undefined
  now: () => Date
}

/**
 * Suppression définitive d'une compétition DÉJÀ à la corbeille : les fichiers
 * d'abord, puis les lignes en une transaction.
 *
 * Même ordre que la purge RGPD (`purgePersonalData`) : si la base échoue
 * ensuite, une vidéo « introuvable » est bénine, alors qu'un fichier oublié sur
 * le disque, qui montre peut-être des mineurs, ne l'est pas. Les fichiers de
 * TOUS les médias sont supprimés, y compris ceux déjà retirés d'une voie
 * (`deleted_at`), que la purge laisse de côté puisqu'elle les a déjà traités.
 */
export async function permanentlyDeleteCompetition(
  deps: PermanentDeleteDeps,
  current: CompetitionRow,
  actorUserId: string,
): Promise<void> {
  const { db, storage, now } = deps
  if (current.deletedAt === null) {
    throw new ApiError(
      409,
      'Pas dans la corbeille',
      'Seule une compétition qui est dans la corbeille peut être supprimée définitivement. Rien n’a été supprimé.',
    )
  }

  const assets = await db
    .select({ storageKey: asset.storageKey })
    .from(asset)
    .where(eq(asset.competitionId, current.id))
  const sessions = await db
    .select({ storageKey: assetUpload.storageKey })
    .from(assetUpload)
    .where(and(eq(assetUpload.competitionId, current.id), eq(assetUpload.status, 'uploading')))
  if (!storage && (assets.length > 0 || sessions.length > 0)) {
    // Jamais de suppression « à moitié » : sans stockage, on ne peut pas garantir
    // que les vidéos disparaissent, donc on ne touche à rien.
    throw new ApiError(
      500,
      'Stockage indisponible',
      'Les vidéos de cette compétition ne peuvent pas être supprimées pour le moment. Rien n’a été supprimé — réessayez plus tard.',
    )
  }
  if (storage) {
    for (const row of assets) await storage.delete(row.storageKey)
    for (const row of sessions) await storage.abortUpload(row.storageKey)
  }

  const deletedAt = now()
  await db.transaction(async (tx) => {
    const competitionId = current.id
    const ascentIds = tx
      .select({ id: ascent.id })
      .from(ascent)
      .where(eq(ascent.competitionId, competitionId))
    const roundIds = tx
      .select({ id: round.id })
      .from(round)
      .where(eq(round.competitionId, competitionId))
    const routeIds = tx
      .select({ id: route.id })
      .from(route)
      .where(eq(route.competitionId, competitionId))
    const judgeIds = tx
      .select({ id: judge.id })
      .from(judge)
      .where(eq(judge.competitionId, competitionId))

    // Voir COMPETITION_OWNED_TABLES : cet ordre est celui des clés étrangères.
    await tx.delete(ascentEvent).where(inArray(ascentEvent.ascentId, ascentIds))
    await tx.delete(ascent).where(eq(ascent.competitionId, competitionId))
    await tx
      .delete(roundQualifier)
      .where(
        or(
          inArray(roundQualifier.roundId, roundIds),
          inArray(roundQualifier.sourceRoundId, roundIds),
        ),
      )
    await tx.delete(roundCategory).where(inArray(roundCategory.roundId, roundIds))
    await tx.delete(roundRoute).where(inArray(roundRoute.roundId, roundIds))
    await tx.delete(routeCategory).where(inArray(routeCategory.routeId, routeIds))
    await tx.delete(judgeRoute).where(inArray(judgeRoute.judgeId, judgeIds))
    await tx.delete(assetUpload).where(eq(assetUpload.competitionId, competitionId))
    await tx.delete(route).where(eq(route.competitionId, competitionId))
    await tx.delete(asset).where(eq(asset.competitionId, competitionId))
    await tx.delete(judge).where(eq(judge.competitionId, competitionId))
    await tx.delete(competitor).where(eq(competitor.competitionId, competitionId))
    await tx.delete(round).where(eq(round.competitionId, competitionId))
    await tx.delete(category).where(eq(category.competitionId, competitionId))
    await tx.delete(activityLog).where(eq(activityLog.competitionId, competitionId))
    await tx.delete(competition).where(eq(competition.id, competitionId))

    await tx.insert(competitionDeletionLog).values({
      competitionId,
      clubId: current.clubId,
      competitionName: current.name,
      action: 'deleted',
      actorUserId,
      createdAt: deletedAt,
    })
  })
}
