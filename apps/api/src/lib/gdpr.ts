import {
  ARCHIVE_AFTER_YEARS,
  PURGE_AFTER_YEARS,
  retentionStatus,
  type PurgePersonalDataResult,
} from '@climbcontest/contracts'
import {
  asset,
  assetUpload,
  ascent,
  ascentEvent,
  activityLog,
  category,
  competition,
  competitor,
  hashToken,
  judge,
  randomToken,
  route,
  type Database,
} from '@climbcontest/db'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'

import type { StorageAdapter } from './storage'
import { ApiError } from '../middleware/problem'

type CompetitionRow = typeof competition.$inferSelect

const REDACTED_FIRST_NAME = 'Supprimé'
const REDACTED_LAST_NAME = '(données supprimées)'
const REDACTED_JUDGE_NAME = 'Juge supprimé'

const isoDay = (date: Date) => date.toISOString().slice(0, 10)

/**
 * Export des données PERSONNELLES d'une compétition (droit d'accès, RGPD) :
 * tout ce qui identifie une personne, et rien d'autre. Ce n'est pas la
 * sauvegarde (`buildCompetitionBackup`) : pas de passages ni d'historique,
 * seulement qui figure dans l'application et avec quelles informations.
 */
export async function buildGdprExport(db: Database, current: CompetitionRow, now: Date) {
  const competitors = await db
    .select({
      bib: competitor.bib,
      firstName: competitor.firstName,
      lastName: competitor.lastName,
      birthYear: competitor.birthYear,
      clubName: competitor.clubName,
      licenseNumber: competitor.licenseNumber,
      status: competitor.status,
      categoryLabel: category.label,
    })
    .from(competitor)
    .innerJoin(category, eq(category.id, competitor.categoryId))
    .where(eq(competitor.competitionId, current.id))
    .orderBy(asc(competitor.bib), asc(competitor.lastName))

  const judges = await db
    .select({ displayName: judge.displayName })
    .from(judge)
    .where(eq(judge.competitionId, current.id))
    .orderBy(asc(judge.displayName))

  const videos = await db
    .select({ routeNumber: route.number, sizeBytes: asset.sizeBytes, mimeType: asset.mimeType })
    .from(asset)
    .innerJoin(route, eq(route.videoAssetId, asset.id))
    .where(and(eq(asset.competitionId, current.id), isNull(asset.deletedAt)))
    .orderBy(asc(route.number))

  return {
    kind: 'export-donnees-personnelles',
    generatedAt: now.toISOString(),
    competition: {
      name: current.name,
      venue: current.venue,
      startsOn: current.startsOn,
      endsOn: current.endsOn,
      purgedAt: current.purgedAt ? current.purgedAt.toISOString() : null,
    },
    retention: {
      archiveAfterYears: ARCHIVE_AFTER_YEARS,
      purgeAfterYears: PURGE_AFTER_YEARS,
      status: retentionStatus(current.endsOn, isoDay(now)),
    },
    personalData: { competitors, judges, videos },
    notes: [
      'Les vidéos téléversées ne sont pas incluses dans ce fichier : elles peuvent montrer des compétiteurs et sont listées ci-dessus.',
      'La sauvegarde complète (résultats et historique) est un autre export : elle contient ces mêmes données personnelles.',
    ],
  }
}

export interface PurgeDeps {
  db: Database
  storage?: StorageAdapter | undefined
  now: () => Date
}

/**
 * Purge des données personnelles d'une compétition (ADR-051), irréversible.
 * Les RÉSULTATS restent (rangs, prises, tours : statistiques sans personne),
 * mais plus aucun nom, année de naissance, club, licence, vidéo ni motif libre.
 * La ligne de la compétition reste, avec `purged_at`, comme trace de la purge.
 *
 * Les fichiers vidéo sont supprimés AVANT la transaction : si elle échoue
 * ensuite, une vidéo « introuvable » est bénine ; un fichier oublié sur le
 * disque, qui montre peut-être des mineurs, ne l'est pas.
 */
export async function purgePersonalData(
  deps: PurgeDeps,
  current: CompetitionRow,
): Promise<PurgePersonalDataResult> {
  const { db, storage, now } = deps
  if (current.purgedAt) {
    throw new ApiError(
      409,
      'Déjà purgée',
      'Les données personnelles de cette compétition ont déjà été supprimées.',
    )
  }

  const assets = await db
    .select({ id: asset.id, storageKey: asset.storageKey })
    .from(asset)
    .where(and(eq(asset.competitionId, current.id), isNull(asset.deletedAt)))
  const sessions = await db
    .select({ storageKey: assetUpload.storageKey })
    .from(assetUpload)
    .where(and(eq(assetUpload.competitionId, current.id), eq(assetUpload.status, 'uploading')))
  if (storage) {
    for (const row of assets) await storage.delete(row.storageKey)
    for (const row of sessions) await storage.abortUpload(row.storageKey)
  }

  const purgedAt = now()
  return db.transaction(async (tx) => {
    const anonymized = await tx
      .update(competitor)
      .set({
        firstName: REDACTED_FIRST_NAME,
        lastName: REDACTED_LAST_NAME,
        birthYear: null,
        clubName: null,
        licenseNumber: null,
        updatedAt: purgedAt,
      })
      .where(eq(competitor.competitionId, current.id))
      .returning({ id: competitor.id })

    // Juges : plus de nom, plus d'accès. Le jeton est remplacé par un jeton
    // aléatoire jeté aussitôt (la colonne est unique et non nulle).
    const judges = await tx
      .select({ id: judge.id, revokedAt: judge.revokedAt })
      .from(judge)
      .where(eq(judge.competitionId, current.id))
    for (const row of judges) {
      const discarded = randomToken(32)
      await tx
        .update(judge)
        .set({
          displayName: REDACTED_JUDGE_NAME,
          accessTokenHash: hashToken(discarded),
          accessTokenPrefix: discarded.slice(0, 8),
          accessTokenPlain: null,
          pinHash: null,
          pinPlain: null,
          revokedAt: row.revokedAt ?? purgedAt,
          updatedAt: purgedAt,
        })
        .where(eq(judge.id, row.id))
    }

    if (assets.length > 0) {
      await tx
        .update(asset)
        .set({ deletedAt: purgedAt, updatedAt: purgedAt })
        .where(
          inArray(
            asset.id,
            assets.map((row) => row.id),
          ),
        )
    }
    await tx
      .update(assetUpload)
      .set({ status: 'aborted', updatedAt: purgedAt })
      .where(and(eq(assetUpload.competitionId, current.id), eq(assetUpload.status, 'uploading')))
    await tx
      .update(route)
      .set({ videoAssetId: null, videoUrl: null, notes: null, updatedAt: purgedAt })
      .where(eq(route.competitionId, current.id))

    // Motifs libres : un organisateur a pu y écrire un nom ou une blessure.
    await tx
      .update(ascentEvent)
      .set({ reason: null })
      .where(
        inArray(
          ascentEvent.ascentId,
          sql`(select ${ascent.id} from ${ascent} where ${ascent.competitionId} = ${current.id})`,
        ),
      )
    await tx
      .update(activityLog)
      .set({ reason: null })
      .where(eq(activityLog.competitionId, current.id))

    // Le lien public est invalidé : un nouveau slug jamais communiqué.
    await tx
      .update(competition)
      .set({
        purgedAt,
        status: 'archived',
        publicSlug: randomToken(22),
        updatedAt: purgedAt,
      })
      .where(eq(competition.id, current.id))

    return {
      purgedAt: purgedAt.toISOString(),
      anonymizedCompetitors: anonymized.length,
      revokedJudges: judges.length,
      deletedVideos: assets.length,
    }
  })
}
