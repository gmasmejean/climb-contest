import {
  ROUTE_PHOTO_MAX_BYTES,
  routePhotoHoldsSchema,
  type RouteHold,
  type RoutePhoto,
} from '@climbcontest/contracts'
import { ascent, asset, route, type Database } from '@climbcontest/db'
import { and, eq, isNull } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'

import { ApiError } from '../middleware/problem'
import type { StorageAdapter } from './storage'

/**
 * Photo annotée d'une voie (Lot 15, ADR-066). Une seule photo par voie ; le
 * client la ré-encode toujours en JPEG, donc le serveur n'accepte que du
 * JPEG, reconnu à ses octets de signature et jamais au type déclaré.
 */
export interface RoutePhotoServiceDeps {
  db: Database
  storage: StorageAdapter
  now: () => Date
}

type RouteRow = typeof route.$inferSelect

export const ROUTE_PHOTO_MIME_TYPE = 'image/jpeg'

/** Un JPEG commence par FF D8 FF (SOI puis le premier marqueur). */
export function isJpeg(head: Uint8Array): boolean {
  return head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff
}

/** Les prises stockées, relues à travers leur schéma : jamais un jsonb pris tel quel. */
export function readStoredHolds(row: Pick<RouteRow, 'photoHolds'>): RouteHold[] {
  if (row.photoHolds === null) return []
  const parsed = routePhotoHoldsSchema.safeParse(row.photoHolds)
  if (!parsed.success) {
    throw new ApiError(
      500,
      'Erreur interne',
      'Les prises enregistrées pour cette voie sont illisibles.',
    )
  }
  return parsed.data
}

/** Ce que l'écran juge reçoit : l'identifiant de l'image et ses prises. `null` sans photo. */
export function toJudgePhoto(
  row: Pick<RouteRow, 'photoAssetId' | 'photoHolds'>,
): RoutePhoto | null {
  if (row.photoAssetId === null) return null
  return { assetId: row.photoAssetId, holds: readStoredHolds(row) }
}

async function findRoute(db: Database, competitionId: string, routeId: string): Promise<RouteRow> {
  const row = await db.query.route.findFirst({
    where: and(
      eq(route.id, routeId),
      eq(route.competitionId, competitionId),
      isNull(route.deletedAt),
    ),
  })
  if (!row) throw new ApiError(404, 'Voie introuvable', "Cette voie n'existe pas.")
  return row
}

/**
 * La photo et ses numéros sont figés dès qu'un passage existe (ADR-066,
 * comme `hold_count`, ADR-004) : « prise 12 » ne doit pas changer de place
 * pour des juges qui ont déjà saisi.
 */
async function findEditableRoute(
  db: Database,
  competitionId: string,
  routeId: string,
): Promise<RouteRow> {
  const row = await findRoute(db, competitionId, routeId)
  const existingAscent = await db.query.ascent.findFirst({ where: eq(ascent.routeId, routeId) })
  if (existingAscent) {
    throw new ApiError(
      409,
      'Modification impossible',
      'Un passage existe déjà sur cette voie : sa photo et ses prises ne peuvent plus changer (ADR-066).',
    )
  }
  return row
}

const megabytes = (bytes: number) => Math.round(bytes / (1024 * 1024))

/**
 * Enregistre la photo d'une voie. Remplacer une photo efface aussi les prises :
 * elles étaient placées sur l'ancienne image, des cercles au mauvais endroit
 * seraient pires que pas de cercles.
 */
export async function putRoutePhoto(
  deps: RoutePhotoServiceDeps,
  params: { competitionId: string; routeId: string; userId: string; body: Uint8Array },
): Promise<RoutePhoto> {
  const { db, storage, now } = deps
  const current = await findEditableRoute(db, params.competitionId, params.routeId)

  if (params.body.byteLength === 0) {
    throw new ApiError(400, 'Photo vide', 'Le fichier ne contient aucun octet.')
  }
  if (params.body.byteLength > ROUTE_PHOTO_MAX_BYTES) {
    throw new ApiError(
      413,
      'Photo trop volumineuse',
      `Cette photo pèse ${megabytes(params.body.byteLength)} Mo, la limite est de ${megabytes(ROUTE_PHOTO_MAX_BYTES)} Mo.`,
    )
  }
  if (!isJpeg(params.body)) {
    throw new ApiError(
      400,
      'Format non accepté',
      "Ce fichier n'est pas une photo JPEG. Choisissez une photo prise avec le téléphone.",
    )
  }

  // La clé se termine par l'identifiant du futur `asset` : jamais dérivée d'une
  // entrée client (ADR-058).
  const assetId = uuidv7()
  const storageKey = `competitions/${params.competitionId}/photos/${assetId}`
  try {
    await storage.beginUpload(storageKey)
    await storage.appendChunk(storageKey, 0, params.body)
    await storage.completeUpload(storageKey)
  } catch (error) {
    await storage.abortUpload(storageKey)
    await storage.delete(storageKey)
    throw error
  }

  let replacedAssetId: string | null
  try {
    replacedAssetId = await db.transaction(async (tx) => {
      await tx.insert(asset).values({
        id: assetId,
        competitionId: params.competitionId,
        kind: 'route_photo',
        storageKey,
        mimeType: ROUTE_PHOTO_MIME_TYPE,
        sizeBytes: params.body.byteLength,
        uploadedBy: params.userId,
      })
      await tx
        .update(route)
        .set({ photoAssetId: assetId, photoHolds: null, updatedAt: now() })
        .where(eq(route.id, params.routeId))
      if (current.photoAssetId) {
        await tx
          .update(asset)
          .set({ deletedAt: now(), updatedAt: now() })
          .where(eq(asset.id, current.photoAssetId))
      }
      return current.photoAssetId
    })
  } catch (error) {
    // L'écriture en base a échoué : le fichier n'est référencé par personne.
    await storage.delete(storageKey)
    throw error
  }

  // L'ancien fichier n'est supprimé qu'APRÈS le commit : si la transaction
  // avait échoué, l'ancienne photo serait restée référencée.
  if (replacedAssetId) {
    const old = await db.query.asset.findFirst({ where: eq(asset.id, replacedAssetId) })
    if (old) await storage.delete(old.storageKey)
  }
  return { assetId, holds: [] }
}

/** Remplace l'annotation. Les numéros doivent tenir dans `hold_count` (le pavé du juge s'y arrête). */
export async function setRoutePhotoHolds(
  deps: RoutePhotoServiceDeps,
  params: { competitionId: string; routeId: string; holds: RouteHold[] },
): Promise<RoutePhoto> {
  const { db, now } = deps
  const current = await findEditableRoute(db, params.competitionId, params.routeId)
  if (current.photoAssetId === null) {
    throw new ApiError(
      409,
      'Pas de photo',
      "Cette voie n'a pas de photo : téléversez-la avant de placer les prises.",
    )
  }
  const tooHigh = params.holds.find((hold) => hold.number > current.holdCount)
  if (tooHigh) {
    throw new ApiError(
      400,
      'Numéro de prise invalide',
      `La prise ${tooHigh.number} dépasse le nombre de prises de la voie (${current.holdCount}). Augmentez d'abord ce nombre.`,
    )
  }
  const sorted = [...params.holds].sort((a, b) => a.number - b.number)
  await db
    .update(route)
    .set({ photoHolds: sorted, updatedAt: now() })
    .where(eq(route.id, params.routeId))
  return { assetId: current.photoAssetId, holds: sorted }
}

/** Retire la photo (et ses prises). Sans effet si la voie n'en a pas. */
export async function deleteRoutePhoto(
  deps: RoutePhotoServiceDeps,
  params: { competitionId: string; routeId: string },
): Promise<void> {
  const { db, storage, now } = deps
  const current = await findEditableRoute(db, params.competitionId, params.routeId)
  const photoAssetId = current.photoAssetId
  if (photoAssetId === null) return
  const target = await db.query.asset.findFirst({ where: eq(asset.id, photoAssetId) })

  await db.transaction(async (tx) => {
    await tx
      .update(route)
      .set({ photoAssetId: null, photoHolds: null, updatedAt: now() })
      .where(eq(route.id, params.routeId))
    await tx
      .update(asset)
      .set({ deletedAt: now(), updatedAt: now() })
      .where(eq(asset.id, photoAssetId))
  })
  if (target) await storage.delete(target.storageKey)
}

export interface OpenedRoutePhoto {
  assetId: string
  size: number
  stream: ReadableStream<Uint8Array>
}

/** Ouvre le fichier de la photo d'une voie. `null` si la voie n'en a pas. */
export async function openRoutePhoto(
  deps: Pick<RoutePhotoServiceDeps, 'db' | 'storage'>,
  params: { competitionId: string; routeId: string },
): Promise<OpenedRoutePhoto | null> {
  const current = await findRoute(deps.db, params.competitionId, params.routeId)
  if (current.photoAssetId === null) return null
  const assetRow = await deps.db.query.asset.findFirst({
    where: eq(asset.id, current.photoAssetId),
  })
  if (!assetRow || assetRow.deletedAt !== null) return null
  const stored = await deps.storage.open(assetRow.storageKey)
  if (!stored) return null
  return { assetId: assetRow.id, size: stored.size, stream: stored.stream }
}

/** En-têtes d'une photo servie : type vérifié à l'envoi, jamais mis en cache partagé. */
export function routePhotoHeaders(opened: OpenedRoutePhoto): Record<string, string> {
  return {
    'content-type': ROUTE_PHOTO_MIME_TYPE,
    'content-length': String(opened.size),
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; sandbox",
    'cache-control': 'private, no-store',
    etag: `"${opened.assetId}"`,
  }
}
