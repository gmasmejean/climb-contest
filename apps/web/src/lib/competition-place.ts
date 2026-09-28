import type { Address, OrganizationProfile, PublicAddress } from '@climbcontest/contracts'

/**
 * Lieu d'une compétition (Lot 26, ADR-089) : le nom du lieu (`venue`) et une
 * adresse facultative, copiés depuis la fiche de l'organisation ou saisis.
 * La copie est faite ici, par le formulaire : le serveur ne va jamais
 * chercher l'adresse de l'organisation.
 */
export type PlaceChoice = 'organization' | 'other'

interface AddressColumns {
  addressLabel: string | null
  postcode: string | null
  city: string | null
  latitude: number | null
  longitude: number | null
  banId: string | null
}

/** L'API renvoie la compétition à plat ; le formulaire manie un bloc `address`. */
export function competitionAddress(row: AddressColumns): Address | null {
  if (row.addressLabel === null) return null
  return {
    label: row.addressLabel,
    postcode: row.postcode,
    city: row.city,
    latitude: row.latitude,
    longitude: row.longitude,
    banId: row.banId,
  }
}

/** Le lieu que propose la fiche, s'il y en a un : sans adresse, rien à proposer. */
export function organizationPlace(
  profile: OrganizationProfile | undefined,
): { venue: string; address: Address } | null {
  if (!profile?.address) return null
  return { venue: profile.name, address: profile.address }
}

function normalizeLabel(label: string): string {
  return label.trim().toLocaleLowerCase('fr')
}

/**
 * Deux adresses désignent-elles le même endroit ? Par la position quand les
 * deux en ont une, par le libellé sinon (adresses saisies à la main).
 */
export function samePlace(
  a: PublicAddress | null | undefined,
  b: PublicAddress | null | undefined,
): boolean {
  if (!a || !b) return false
  if (a.latitude !== null && a.longitude !== null && b.latitude !== null && b.longitude !== null) {
    return a.latitude === b.latitude && a.longitude === b.longitude
  }
  return normalizeLabel(a.label) === normalizeLabel(b.label)
}

/**
 * Le choix affiché à l'ouverture du formulaire. À la création (`current`
 * absent) : le lieu de l'organisation dès que sa fiche a une adresse. Sur une
 * compétition existante : seulement si son nom et son adresse sont exactement
 * ceux de la fiche.
 */
export function initialPlaceChoice(
  profile: OrganizationProfile | undefined,
  current?: { venue: string; address: Address | null },
): PlaceChoice {
  const place = organizationPlace(profile)
  if (!place) return 'other'
  if (!current) return 'organization'
  return current.venue === place.venue &&
    current.address !== null &&
    current.address.label === place.address.label &&
    samePlace(current.address, place.address)
    ? 'organization'
    : 'other'
}
