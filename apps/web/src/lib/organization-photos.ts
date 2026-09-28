import { ORGANIZATION_PHOTO_MAX_COUNT, type OrganizationPhoto } from '@climbcontest/contracts'

/**
 * Photos de la fiche de l'organisation (Lot 27, DECISIONS.md ADR-090) :
 * fonctions pures, testées sans navigateur.
 */

/** Une photo prête à afficher : `src` est `null` tant que l'image n'est pas chargée. */
export interface GalleryPhoto {
  id: string
  alt: string
  /** Le texte saisi par l'owner, affiché sous la photo agrandie ; `null` sans texte. */
  caption: string | null
  src: string | null
}

export const PHOTO_CONSENT_WARNING =
  'Ces photos sont publiques. Ne publiez une photo où l’on reconnaît quelqu’un qu’avec son accord.'

/** Sans texte alternatif, la photo est annoncée par sa place et l'organisation (ADR-090 point 5). */
export function photoAlt(
  photo: Pick<OrganizationPhoto, 'altText'>,
  index: number,
  total: number,
  organizationName: string,
): string {
  return photo.altText ?? `Photo ${index + 1} sur ${total} de ${organizationName}`
}

export function galleryPhotos(
  photos: readonly OrganizationPhoto[],
  organizationName: string,
  src: (photoId: string) => string | null,
): GalleryPhoto[] {
  return photos.map((photo, index) => ({
    id: photo.id,
    alt: photoAlt(photo, index, photos.length, organizationName),
    caption: photo.altText,
    src: src(photo.id),
  }))
}

/** L'adresse publique d'une photo, par la compétition affichée. */
export function publicPhotoUrl(slug: string, photoId: string): string {
  return `/api/v1/public/${encodeURIComponent(slug)}/organization/photos/${encodeURIComponent(photoId)}`
}

/**
 * Déplace la photo `id` d'un cran (`-1` : plus tôt, `1` : plus tard). Renvoie
 * `null` si elle est déjà au bout, ou absente : rien à envoyer.
 */
export function movePhoto(ids: readonly string[], id: string, delta: -1 | 1): string[] | null {
  const from = ids.indexOf(id)
  const to = from + delta
  if (from === -1 || to < 0 || to >= ids.length) return null
  const next = [...ids]
  next.splice(from, 1)
  next.splice(to, 0, id)
  return next
}

/** Parmi les fichiers choisis, ceux qui tiennent dans les places libres (ADR-090 point 3). */
export function planUploads<T>(
  files: readonly T[],
  activeCount: number,
): { accepted: T[]; skipped: number } {
  const free = Math.max(0, ORGANIZATION_PHOTO_MAX_COUNT - activeCount)
  return { accepted: files.slice(0, free), skipped: Math.max(0, files.length - free) }
}

export function describeSkipped(skipped: number): string {
  if (skipped === 0) return ''
  const photos = skipped === 1 ? 'photo n’a pas été ajoutée' : 'photos n’ont pas été ajoutées'
  return `${skipped} ${photos} : la fiche en compte ${ORGANIZATION_PHOTO_MAX_COUNT} au plus.`
}
