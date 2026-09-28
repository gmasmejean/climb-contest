import type { Address, PublicAddress } from '@climbcontest/contracts'

/**
 * Passage entre les six colonnes d'adresse (`organization`, `competition`) et
 * le bloc `address` des contrats (ADR-088, ADR-089). Pas de libellé = pas
 * d'adresse : les contraintes `*_address_check` garantissent qu'aucune autre
 * colonne d'adresse n'est alors renseignée.
 */
export interface AddressRow {
  addressLabel: string | null
  postcode: string | null
  city: string | null
  latitude: number | null
  longitude: number | null
  banId: string | null
}

export function addressOf(row: AddressRow): Address | null {
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

/** Ce que le public voit : sans l'identifiant BAN. */
export function publicAddressOf(row: AddressRow): PublicAddress | null {
  const address = addressOf(row)
  return (
    address && {
      label: address.label,
      postcode: address.postcode,
      city: address.city,
      latitude: address.latitude,
      longitude: address.longitude,
    }
  )
}

export function addressColumns(address: Address | null): AddressRow {
  return {
    addressLabel: address?.label ?? null,
    postcode: address?.postcode ?? null,
    city: address?.city ?? null,
    latitude: address?.latitude ?? null,
    longitude: address?.longitude ?? null,
    banId: address?.banId ?? null,
  }
}
