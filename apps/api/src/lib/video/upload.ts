import {
  VIDEO_CHUNK_SIZE,
  type VideoAsset,
  type VideoMimeType,
  type VideoUpload,
} from '@climbcontest/contracts'
import { asset, assetUpload, route, type Database } from '@climbcontest/db'
import { and, eq, lt } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'

import { notifyPublic } from '../notify-public'
import { StorageOffsetError, type StorageAdapter } from '../storage'
import { ApiError } from '../../middleware/problem'
import { SNIFF_BYTES, sniffVideoType } from './sniff'

export interface VideoServiceDeps {
  db: Database
  storage: StorageAdapter
  maxBytes: number
  now: () => Date
}

/** Un envoi abandonné est purgé après ce délai (`cleanupExpiredUploads`). */
export const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000

/** L'offset annoncé ne correspond pas : le client doit reprendre à `expectedOffset`. */
export class UploadOffsetMismatchError extends Error {
  constructor(public readonly expectedOffset: number) {
    super(`Offset inattendu : reprendre à ${expectedOffset}.`)
  }
}

const megabytes = (bytes: number) => Math.round(bytes / (1024 * 1024))

const ACCEPTED_FORMATS_MESSAGE =
  'Formats acceptés : MP4, MOV (QuickTime) et WebM. Convertissez la vidéo (par exemple en MP4 H.264) puis réessayez.'

type UploadRow = typeof assetUpload.$inferSelect

function toDto(row: UploadRow, receivedBytes: number, maxBytes: number): VideoUpload {
  return {
    uploadId: row.id,
    status: row.status as VideoUpload['status'],
    declaredSizeBytes: row.declaredSizeBytes,
    receivedBytes,
    chunkSize: VIDEO_CHUNK_SIZE,
    maxBytes,
  }
}

async function findUpload(
  db: Database,
  competitionId: string,
  routeId: string,
  uploadId: string,
): Promise<UploadRow> {
  const row = await db.query.assetUpload.findFirst({
    where: and(
      eq(assetUpload.id, uploadId),
      eq(assetUpload.competitionId, competitionId),
      eq(assetUpload.routeId, routeId),
    ),
  })
  if (!row) throw new ApiError(404, 'Envoi introuvable', "Cet envoi n'existe pas ou a expiré.")
  return row
}

/** Vérifie que la voie existe dans cette compétition (et n'est pas supprimée). */
export async function assertRouteInCompetition(
  db: Database,
  competitionId: string,
  routeId: string,
): Promise<void> {
  const row = await db.query.route.findFirst({
    where: and(eq(route.id, routeId), eq(route.competitionId, competitionId)),
  })
  if (!row || row.deletedAt !== null) {
    throw new ApiError(404, 'Voie introuvable', "Cette voie n'existe pas.")
  }
}

export async function createUpload(
  deps: VideoServiceDeps,
  params: {
    competitionId: string
    routeId: string
    userId: string
    sizeBytes: number
    mimeType: VideoMimeType
  },
): Promise<VideoUpload> {
  const { db, storage, maxBytes, now } = deps
  await assertRouteInCompetition(db, params.competitionId, params.routeId)

  if (params.sizeBytes > maxBytes) {
    throw new ApiError(
      413,
      'Vidéo trop volumineuse',
      `Cette vidéo pèse ${megabytes(params.sizeBytes)} Mo, la limite est de ${megabytes(maxBytes)} Mo. Réduisez sa taille ou sa résolution, ou utilisez un lien YouTube ou Vimeo.`,
    )
  }

  // Un seul envoi actif par voie : en commencer un nouveau abandonne
  // l'ancien (et libère l'espace qu'il occupait).
  const previous = await db.query.assetUpload.findMany({
    where: and(eq(assetUpload.routeId, params.routeId), eq(assetUpload.status, 'uploading')),
  })
  for (const old of previous) {
    await storage.abortUpload(old.storageKey)
    await db
      .update(assetUpload)
      .set({ status: 'aborted', updatedAt: now() })
      .where(eq(assetUpload.id, old.id))
  }

  // La clé se termine par l'identifiant du futur `asset` : jamais dérivée du
  // nom de fichier ni d'une entrée client (ADR-058).
  const assetId = uuidv7()
  const storageKey = `competitions/${params.competitionId}/videos/${assetId}`
  await storage.beginUpload(storageKey)

  const [row] = await db
    .insert(assetUpload)
    .values({
      competitionId: params.competitionId,
      routeId: params.routeId,
      storageKey,
      declaredMimeType: params.mimeType,
      declaredSizeBytes: params.sizeBytes,
      status: 'uploading',
      createdBy: params.userId,
      expiresAt: new Date(now().getTime() + UPLOAD_TTL_MS),
    })
    .returning()
  if (!row) throw new ApiError(500, 'Erreur interne', "Impossible de démarrer l'envoi.")
  return toDto(row, 0, maxBytes)
}

export async function getUpload(
  deps: VideoServiceDeps,
  competitionId: string,
  routeId: string,
  uploadId: string,
): Promise<VideoUpload> {
  const row = await findUpload(deps.db, competitionId, routeId, uploadId)
  // Le stockage fait foi pour l'offset de reprise : c'est ce qui est réellement
  // sur le disque, même si la base a un tour de retard après un arrêt brutal.
  const received =
    row.status === 'uploading'
      ? await deps.storage.uploadedBytes(row.storageKey)
      : row.receivedBytes
  return toDto(row, received, deps.maxBytes)
}

export async function receiveChunk(
  deps: VideoServiceDeps,
  params: {
    competitionId: string
    routeId: string
    uploadId: string
    offset: number
    body: Uint8Array
  },
): Promise<VideoUpload> {
  const { db, storage, maxBytes, now } = deps
  const row = await findUpload(db, params.competitionId, params.routeId, params.uploadId)

  if (row.status !== 'uploading') {
    throw new ApiError(409, 'Envoi terminé', 'Cet envoi est déjà terminé ou abandonné.')
  }
  if (row.expiresAt <= now()) {
    throw new ApiError(409, 'Envoi expiré', 'Cet envoi a expiré : recommencez-le.')
  }
  if (params.body.byteLength === 0) {
    throw new ApiError(400, 'Morceau vide', 'Ce morceau ne contient aucun octet.')
  }
  if (params.offset + params.body.byteLength > row.declaredSizeBytes) {
    throw new ApiError(
      400,
      'Trop d’octets',
      'Ce morceau dépasse la taille annoncée pour cette vidéo. Recommencez l’envoi.',
    )
  }

  let received: number
  try {
    received = await storage.appendChunk(row.storageKey, params.offset, params.body)
  } catch (error) {
    if (error instanceof StorageOffsetError)
      throw new UploadOffsetMismatchError(error.expectedOffset)
    throw error
  }
  await db
    .update(assetUpload)
    .set({ receivedBytes: received, updatedAt: now() })
    .where(eq(assetUpload.id, row.id))
  return toDto({ ...row, receivedBytes: received }, received, maxBytes)
}

export async function completeUpload(
  deps: VideoServiceDeps,
  params: { competitionId: string; routeId: string; uploadId: string; userId: string },
): Promise<VideoAsset> {
  const { db, storage, now } = deps
  const row = await findUpload(db, params.competitionId, params.routeId, params.uploadId)

  if (row.status !== 'uploading') {
    throw new ApiError(409, 'Envoi terminé', 'Cet envoi est déjà terminé ou abandonné.')
  }
  const received = await storage.uploadedBytes(row.storageKey)
  if (received !== row.declaredSizeBytes) {
    throw new ApiError(
      409,
      'Envoi incomplet',
      `Il manque ${row.declaredSizeBytes - received} octets : reprenez l’envoi à l’octet ${received}.`,
    )
  }

  // Le type déclaré n'est jamais une preuve : on lit le contenu (ADR-058).
  const detected = sniffVideoType(await storage.readHead(row.storageKey, SNIFF_BYTES))
  if (!detected) {
    await storage.abortUpload(row.storageKey)
    await db
      .update(assetUpload)
      .set({ status: 'aborted', updatedAt: now() })
      .where(eq(assetUpload.id, row.id))
    throw new ApiError(
      400,
      'Format non accepté',
      `Ce fichier n’est pas une vidéo reconnue. ${ACCEPTED_FORMATS_MESSAGE}`,
    )
  }

  await storage.completeUpload(row.storageKey)
  const assetId = row.storageKey.split('/').at(-1)!

  const replaced = await db.transaction(async (tx) => {
    const current = await tx.query.route.findFirst({ where: eq(route.id, params.routeId) })
    await tx.insert(asset).values({
      id: assetId,
      competitionId: params.competitionId,
      kind: 'video',
      storageKey: row.storageKey,
      mimeType: detected,
      sizeBytes: row.declaredSizeBytes,
      uploadedBy: params.userId,
    })
    // Un envoi terminé remplace le lien externe (ADR-058, décision 5).
    await tx
      .update(route)
      .set({ videoAssetId: assetId, videoUrl: null, updatedAt: now() })
      .where(eq(route.id, params.routeId))
    await tx
      .update(assetUpload)
      .set({ status: 'completed', receivedBytes: received, updatedAt: now() })
      .where(eq(assetUpload.id, row.id))
    if (current?.videoAssetId) {
      await tx
        .update(asset)
        .set({ deletedAt: now(), updatedAt: now() })
        .where(eq(asset.id, current.videoAssetId))
    }
    await notifyPublic(tx, {
      type: 'route_updated',
      competitionId: params.competitionId,
      routeId: params.routeId,
    })
    return current?.videoAssetId ?? null
  })

  // Le fichier de la vidéo remplacée n'est supprimé qu'APRÈS le commit : si la
  // transaction avait échoué, l'ancienne vidéo serait restée référencée.
  if (replaced) {
    const old = await db.query.asset.findFirst({ where: eq(asset.id, replaced) })
    if (old) await storage.delete(old.storageKey)
  }

  return { assetId, mimeType: detected, sizeBytes: row.declaredSizeBytes }
}

export async function abortUpload(
  deps: VideoServiceDeps,
  params: { competitionId: string; routeId: string; uploadId: string },
): Promise<void> {
  const row = await findUpload(deps.db, params.competitionId, params.routeId, params.uploadId)
  if (row.status !== 'uploading') return
  await deps.storage.abortUpload(row.storageKey)
  await deps.db
    .update(assetUpload)
    .set({ status: 'aborted', updatedAt: deps.now() })
    .where(eq(assetUpload.id, row.id))
}

/** Retire la vidéo téléversée d'une voie. Sans effet si elle n'en a pas. */
export async function deleteRouteVideo(
  deps: VideoServiceDeps,
  params: { competitionId: string; routeId: string },
): Promise<void> {
  const { db, storage, now } = deps
  await assertRouteInCompetition(db, params.competitionId, params.routeId)
  const current = await db.query.route.findFirst({ where: eq(route.id, params.routeId) })
  if (!current?.videoAssetId) return
  const target = await db.query.asset.findFirst({ where: eq(asset.id, current.videoAssetId) })

  await db.transaction(async (tx) => {
    await tx
      .update(route)
      .set({ videoAssetId: null, updatedAt: now() })
      .where(eq(route.id, params.routeId))
    await tx
      .update(asset)
      .set({ deletedAt: now(), updatedAt: now() })
      .where(eq(asset.id, current.videoAssetId!))
    await notifyPublic(tx, {
      type: 'route_updated',
      competitionId: params.competitionId,
      routeId: params.routeId,
    })
  })
  if (target) await storage.delete(target.storageKey)
}

/**
 * Purge les envois abandonnés (jamais terminés au bout de `UPLOAD_TTL_MS`) :
 * sans elle, un envoi interrompu occuperait le disque pour toujours.
 */
export async function cleanupExpiredUploads(deps: VideoServiceDeps): Promise<number> {
  const { db, storage, now } = deps
  const expired = await db.query.assetUpload.findMany({
    where: and(eq(assetUpload.status, 'uploading'), lt(assetUpload.expiresAt, now())),
  })
  for (const row of expired) {
    await storage.abortUpload(row.storageKey)
    await db
      .update(assetUpload)
      .set({ status: 'aborted', updatedAt: now() })
      .where(eq(assetUpload.id, row.id))
  }
  return expired.length
}
