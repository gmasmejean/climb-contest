import {
  organizationTypeSchema,
  type OrganizationPhoto,
  type OrganizationProfile,
  type PublicOrganization,
  type UpdateOrganizationInput,
} from '@climbcontest/contracts'
import type { organization } from '@climbcontest/db'

import { addressColumns, addressOf, publicAddressOf } from './address'

type OrganizationRow = typeof organization.$inferSelect
type OrganizationUpdate = Partial<typeof organization.$inferInsert>

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

/**
 * L'encart public : les mêmes champs, sans identifiant (ni l'organisation, ni
 * BAN), et les photos actives dans l'ordre (ADR-090).
 */
export function toPublicOrganization(
  row: OrganizationRow,
  photos: readonly OrganizationPhoto[],
): PublicOrganization {
  return {
    name: row.name,
    type: toOrganizationType(row.type),
    description: row.description,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    websiteUrl: row.websiteUrl,
    address: publicAddressOf(row),
    photos: [...photos],
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
