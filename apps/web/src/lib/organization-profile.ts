import type {
  Address,
  OrganizationPhoto,
  OrganizationProfile,
  OrganizationType,
  PublicAddress,
  PublicOrganization,
  UpdateOrganizationInput,
} from '@climbcontest/contracts'

/** Fiche de l'organisation (Lot 25, ADR-088). */
export const ORGANIZATION_TYPE_LABELS: Record<OrganizationType, string> = {
  club: 'Club',
  gym: 'Salle',
  other: 'Autre',
}

export const ORGANIZATION_TYPE_OPTIONS = (
  Object.entries(ORGANIZATION_TYPE_LABELS) as [OrganizationType, string][]
).map(([value, label]) => ({ value, label }))

export function isOrganizationType(value: string): value is OrganizationType {
  return value in ORGANIZATION_TYPE_LABELS
}

export const DESCRIPTION_MAX_LENGTH = 2000

export const PUBLIC_CONTACT_WARNING =
  'Ces coordonnées seront visibles de tous sur la page publique de vos compétitions. Préférez l’adresse et le téléphone du club à ceux d’un bénévole.'

export interface OrganizationForm {
  name: string
  type: string
  description: string
  contactEmail: string
  contactPhone: string
  websiteUrl: string
  address: Address | null
}

export function formFromProfile(profile: OrganizationProfile): OrganizationForm {
  return {
    name: profile.name,
    type: profile.type,
    description: profile.description ?? '',
    contactEmail: profile.contactEmail ?? '',
    contactPhone: profile.contactPhone ?? '',
    websiteUrl: profile.websiteUrl ?? '',
    address: profile.address,
  }
}

/**
 * « www.club.fr » devient « https://www.club.fr » : la plupart des bénévoles
 * n'écrivent pas le préfixe. Un « http:// » explicite est laissé tel quel, pour
 * que la validation dise quoi faire au lieu de le réécrire en silence.
 */
export function normalizeWebsite(text: string): string | null {
  const value = text.trim()
  if (value === '') return null
  return /^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`
}

function emptyToNull(text: string): string | null {
  const value = text.trim()
  return value === '' ? null : value
}

/** Ce que le formulaire envoie : un champ vidé vaut `null`, jamais une chaîne vide. */
export function inputFromForm(form: OrganizationForm): UpdateOrganizationInput {
  return {
    name: form.name.trim(),
    ...(isOrganizationType(form.type) ? { type: form.type } : {}),
    description: emptyToNull(form.description),
    contactEmail: emptyToNull(form.contactEmail),
    contactPhone: emptyToNull(form.contactPhone),
    websiteUrl: normalizeWebsite(form.websiteUrl),
    address: form.address,
  }
}

/**
 * Lien « Itinéraire » (ADR-088 point 10) : Google Maps en lien universel, qui
 * ouvre l'application installée sur Android comme sur iPhone. Les coordonnées
 * si on les a, sinon le libellé tel qu'il a été saisi.
 */
export function directionsUrl(address: PublicAddress): string {
  const destination =
    address.latitude !== null && address.longitude !== null
      ? `${address.latitude},${address.longitude}`
      : address.label
  const params = new URLSearchParams({ api: '1', destination })
  return `https://www.google.com/maps/dir/?${params.toString()}`
}

/**
 * Un lien `tel:` sans les espaces ni la ponctuation, que certains téléphones
 * refusent. Le « (0) » d'un « +33 (0)3 … » ne se compose pas.
 */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/\(0\)/g, '').replace(/[^\d+]/g, '')}`
}

/** La fiche telle que le public la verra : sans identifiant, ni de l'organisation ni BAN. */
export function publicView(
  profile: OrganizationProfile,
  photos: readonly OrganizationPhoto[] = [],
): PublicOrganization {
  return {
    name: profile.name,
    type: profile.type,
    description: profile.description,
    contactEmail: profile.contactEmail,
    contactPhone: profile.contactPhone,
    websiteUrl: profile.websiteUrl,
    address: profile.address && {
      label: profile.address.label,
      postcode: profile.address.postcode,
      city: profile.address.city,
      latitude: profile.address.latitude,
      longitude: profile.address.longitude,
    },
    photos: [...photos],
  }
}
