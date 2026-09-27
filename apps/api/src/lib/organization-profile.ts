import {
  organizationTypeSchema,
  type Address,
  type OrganizationProfile,
  type PublicOrganization,
  type UpdateOrganizationInput,
} from '@climbcontest/contracts'
import type { organization } from '@climbcontest/db'

type OrganizationRow = typeof organization.$inferSelect
type OrganizationUpdate = Partial<typeof organization.$inferInsert>

/**
 * Passage entre les colonnes à plat de `organization` et le bloc `address`
 * des contrats (ADR-088). Pas de libellé = pas d'adresse : la contrainte
 * `organization_address_check` garantit qu'aucune autre colonne d'adresse
 * n'est alors renseignée.
 */
export function addressOf(row: OrganizationRow): Address | null {
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

export function addressColumns(address: Address | null): OrganizationUpdate {
  return {
    addressLabel: address?.label ?? null,
    postcode: address?.postcode ?? null,
    city: address?.city ?? null,
    latitude: address?.latitude ?? null,
    longitude: address?.longitude ?? null,
    banId: address?.banId ?? null,
  }
}

export function toOrganizationProfile(row: OrganizationRow): OrganizationProfile {
  return {
    id: row.id,
    name: row.name,
    type: toOrganizationType(row.type),
    description: row.description,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    websiteUrl: row.websiteUrl,
    address: addressOf(row),
  }
}

/** L'encart public : les mêmes champs, sans identifiant (ni l'organisation, ni BAN). */
export function toPublicOrganization(row: OrganizationRow): PublicOrganization {
  const address = addressOf(row)
  return {
    name: row.name,
    type: toOrganizationType(row.type),
    description: row.description,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    websiteUrl: row.websiteUrl,
    address: address && {
      label: address.label,
      postcode: address.postcode,
      city: address.city,
      latitude: address.latitude,
      longitude: address.longitude,
    },
  }
}

/** Les colonnes à écrire pour une modification partielle : un champ absent n'est pas touché. */
export function organizationUpdateColumns(input: UpdateOrganizationInput): OrganizationUpdate {
  const { address, ...fields } = input
  const columns: OrganizationUpdate = {}
  if (fields.name !== undefined) columns.name = fields.name
  if (fields.type !== undefined) columns.type = fields.type
  if (fields.description !== undefined) columns.description = fields.description
  if (fields.contactEmail !== undefined) columns.contactEmail = fields.contactEmail
  if (fields.contactPhone !== undefined) columns.contactPhone = fields.contactPhone
  if (fields.websiteUrl !== undefined) columns.websiteUrl = fields.websiteUrl
  return address === undefined ? columns : { ...columns, ...addressColumns(address) }
}

// La colonne est un `text` sous CHECK (ADR-018) : Drizzle la type `string`.
function toOrganizationType(value: string): OrganizationProfile['type'] {
  return organizationTypeSchema.parse(value)
}
