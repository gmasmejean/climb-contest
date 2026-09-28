import {
  ORGANIZATION_PHOTO_MAX_BYTES,
  ORGANIZATION_PHOTO_MAX_COUNT,
  type OrganizationPhoto,
} from '@climbcontest/contracts'
import { organization, organizationPhoto, type Database } from '@climbcontest/db'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'

import { ApiError } from '../middleware/problem'
import { isJpeg, ROUTE_PHOTO_MIME_TYPE } from './route-photo'
import type { StorageAdapter } from './storage'

/**
 * Photos de la fiche de l'organisation (Lot 27, DECISIONS.md ADR-090). Même
 * chaîne que la photo de voie (ADR-066) : JPEG reconnu à sa signature, 8 Mio,
 * fichier écrit avant la transaction. 6 photos actives au plus ; la
 * suppression est logique et s'annule.
 */
export interface OrganizationPhotoServiceDeps {
  db: Database
  storage: StorageAdapter
  now: () => Date
}

type PhotoRow = typeof organizationPhoto.$inferSelect
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]

export const ORGANIZATION_PHOTO_MIME_TYPE = ROUTE_PHOTO_MIME_TYPE

const PHOTO_NOT_FOUND = () =>
  new ApiError(404, 'Photo introuvable', 'Cette photo n’existe pas ou a été supprimée.')

const TOO_MANY_PHOTOS = () =>
  new ApiError(
    409,
    'Six photos au plus',
    `La fiche a déjà ${ORGANIZATION_PHOTO_MAX_COUNT} photos. Supprimez-en une avant d’en ajouter.`,
  )

export function toOrganizationPhoto(row: PhotoRow): OrganizationPhoto {
  return { id: row.id, altText: row.altText }
}

const activePhotos = (organizationId: string) =>
  and(eq(organizationPhoto.organizationId, organizationId), isNull(organizationPhoto.deletedAt))

/** Les photos actives, dans l'ordre d'affichage. */
export async function listOrganizationPhotos(
  db: Database | Tx,
  organizationId: string,
): Promise<PhotoRow[]> {
  return db
    .select()
    .from(organizationPhoto)
    .where(activePhotos(organizationId))
    .orderBy(asc(organizationPhoto.position), asc(organizationPhoto.id))
}

/**
 * Verrouille la ligne de l'organisation le temps de la transaction : deux
 * envois (ou une restauration et un envoi) simultanés ne dépassent pas six.
 */
async function lockOrganization(tx: Tx, organizationId: string): Promise<void> {
  await tx
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .for('update')
}

const nextPosition = (photos: readonly PhotoRow[]) =>
  photos.reduce((max, photo) => Math.max(max, photo.position + 1), 0)

const megabytes = (bytes: number) => Math.round(bytes / (1024 * 1024))

export async function addOrganizationPhoto(
  deps: OrganizationPhotoServiceDeps,
  params: { organizationId: string; userId: string; body: Uint8Array },
): Promise<OrganizationPhoto> {
  const { db, storage, now } = deps
  if (params.body.byteLength === 0) {
    throw new ApiError(400, 'Photo vide', 'Le fichier ne contient aucun octet.')
  }
  if (params.body.byteLength > ORGANIZATION_PHOTO_MAX_BYTES) {
    throw new ApiError(
      413,
      'Photo trop volumineuse',
      `Cette photo pèse ${megabytes(params.body.byteLength)} Mo, la limite est de ${megabytes(ORGANIZATION_PHOTO_MAX_BYTES)} Mo.`,
    )
  }
  if (!isJpeg(params.body)) {
    throw new ApiError(
      400,
      'Format non accepté',
      "Ce fichier n'est pas une photo JPEG. Choisissez une photo prise avec le téléphone.",
    )
  }
  // Refus rapide, avant d'écrire le fichier ; la transaction revérifie sous verrou.
  if (
    (await listOrganizationPhotos(db, params.organizationId)).length >= ORGANIZATION_PHOTO_MAX_COUNT
  ) {
    throw TOO_MANY_PHOTOS()
  }

  const photoId = uuidv7()
  const storageKey = `organizations/${params.organizationId}/photos/${photoId}`
  try {
    await storage.beginUpload(storageKey)
    await storage.appendChunk(storageKey, 0, params.body)
    await storage.completeUpload(storageKey)
  } catch (error) {
    await storage.abortUpload(storageKey)
    await storage.delete(storageKey)
    throw error
  }

  try {
    const row = await db.transaction(async (tx) => {
      await lockOrganization(tx, params.organizationId)
      const photos = await listOrganizationPhotos(tx, params.organizationId)
      if (photos.length >= ORGANIZATION_PHOTO_MAX_COUNT) throw TOO_MANY_PHOTOS()
      const at = now()
      const [inserted] = await tx
        .insert(organizationPhoto)
        .values({
          id: photoId,
          organizationId: params.organizationId,
          storageKey,
          mimeType: ORGANIZATION_PHOTO_MIME_TYPE,
          sizeBytes: params.body.byteLength,
          position: nextPosition(photos),
          uploadedBy: params.userId,
          createdAt: at,
          updatedAt: at,
        })
        .returning()
      if (!inserted) throw new ApiError(500, 'Erreur interne', "Impossible d'ajouter la photo.")
      return inserted
    })
    return toOrganizationPhoto(row)
  } catch (error) {
    // Refusée ou écriture en base échouée : le fichier n'est référencé par personne.
    await storage.delete(storageKey)
    throw error
  }
}

async function findPhoto(
  db: Database | Tx,
  organizationId: string,
  photoId: string,
): Promise<PhotoRow> {
  const row = await db.query.organizationPhoto.findFirst({
    where: and(
      eq(organizationPhoto.id, photoId),
      eq(organizationPhoto.organizationId, organizationId),
    ),
  })
  if (!row) throw PHOTO_NOT_FOUND()
  return row
}

export async function setOrganizationPhotoAltText(
  deps: Pick<OrganizationPhotoServiceDeps, 'db' | 'now'>,
  params: { organizationId: string; photoId: string; altText: string | null },
): Promise<OrganizationPhoto> {
  const current = await findPhoto(deps.db, params.organizationId, params.photoId)
  if (current.deletedAt !== null) throw PHOTO_NOT_FOUND()
  const [updated] = await deps.db
    .update(organizationPhoto)
    .set({ altText: params.altText, updatedAt: deps.now() })
    .where(eq(organizationPhoto.id, current.id))
    .returning()
  if (!updated) throw PHOTO_NOT_FOUND()
  return toOrganizationPhoto(updated)
}

/**
 * Nouvel ordre : exactement les photos actives, chacune une fois. Une liste qui
 * ne correspond plus (un autre owner a ajouté ou supprimé entre-temps) est
 * refusée plutôt que complétée au hasard.
 */
export async function reorderOrganizationPhotos(
  deps: Pick<OrganizationPhotoServiceDeps, 'db' | 'now'>,
  params: { organizationId: string; photoIds: readonly string[] },
): Promise<OrganizationPhoto[]> {
  const { db, now } = deps
  const rows = await db.transaction(async (tx) => {
    await lockOrganization(tx, params.organizationId)
    const photos = await listOrganizationPhotos(tx, params.organizationId)
    const active = new Set(photos.map((photo) => photo.id))
    const matches =
      params.photoIds.length === active.size && params.photoIds.every((id) => active.has(id))
    if (!matches) {
      throw new ApiError(
        409,
        'Les photos ont changé',
        'Les photos de la fiche ont changé entre-temps. Rechargez la page, puis recommencez.',
      )
    }
    const at = now()
    for (const [position, id] of params.photoIds.entries()) {
      await tx
        .update(organizationPhoto)
        .set({ position, updatedAt: at })
        .where(eq(organizationPhoto.id, id))
    }
    return listOrganizationPhotos(tx, params.organizationId)
  })
  return rows.map(toOrganizationPhoto)
}

/** Suppression logique : la photo quitte la fiche, son fichier reste (ADR-090). */
export async function deleteOrganizationPhoto(
  deps: Pick<OrganizationPhotoServiceDeps, 'db' | 'now'>,
  params: { organizationId: string; photoId: string },
): Promise<void> {
  const current = await findPhoto(deps.db, params.organizationId, params.photoId)
  if (current.deletedAt !== null) return
  const at = deps.now()
  await deps.db
    .update(organizationPhoto)
    .set({ deletedAt: at, updatedAt: at })
    .where(eq(organizationPhoto.id, current.id))
}

/** « Annuler » : la photo revient à sa place, s'il en reste une. */
export async function restoreOrganizationPhoto(
  deps: Pick<OrganizationPhotoServiceDeps, 'db' | 'now'>,
  params: { organizationId: string; photoId: string },
): Promise<OrganizationPhoto> {
  const { db, now } = deps
  const row = await db.transaction(async (tx) => {
    await lockOrganization(tx, params.organizationId)
    const current = await findPhoto(tx, params.organizationId, params.photoId)
    if (current.deletedAt === null) return current
    const photos = await listOrganizationPhotos(tx, params.organizationId)
    if (photos.length >= ORGANIZATION_PHOTO_MAX_COUNT) throw TOO_MANY_PHOTOS()
    const [restored] = await tx
      .update(organizationPhoto)
      .set({ deletedAt: null, updatedAt: now() })
      .where(eq(organizationPhoto.id, current.id))
      .returning()
    if (!restored) throw PHOTO_NOT_FOUND()
    return restored
  })
  return toOrganizationPhoto(row)
}

export interface OpenedOrganizationPhoto {
  photoId: string
  size: number
  stream: ReadableStream<Uint8Array>
}

/** Ouvre le fichier d'une photo active de l'organisation. `null` sinon. */
export async function openOrganizationPhoto(
  deps: Pick<OrganizationPhotoServiceDeps, 'db' | 'storage'>,
  params: { organizationId: string; photoId: string },
): Promise<OpenedOrganizationPhoto | null> {
  const row = await deps.db.query.organizationPhoto.findFirst({
    where: and(eq(organizationPhoto.id, params.photoId), activePhotos(params.organizationId)),
  })
  if (!row) return null
  const stored = await deps.storage.open(row.storageKey)
  if (!stored) return null
  return { photoId: row.id, size: stored.size, stream: stored.stream }
}

/**
 * En-têtes d'une photo servie. Le contenu d'un identifiant ne change jamais :
 * `immutable`. Public, une journée au plus (une photo supprimée peut rester
 * ce temps-là dans le cache d'un navigateur) ; privé pour les membres.
 */
export function organizationPhotoHeaders(
  opened: OpenedOrganizationPhoto,
  audience: 'public' | 'members',
): Record<string, string> {
  return {
    'content-type': ORGANIZATION_PHOTO_MIME_TYPE,
    'content-length': String(opened.size),
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; sandbox",
    'cache-control':
      audience === 'public'
        ? 'public, max-age=86400, immutable'
        : 'private, max-age=86400, immutable',
    etag: `"${opened.photoId}"`,
  }
}
