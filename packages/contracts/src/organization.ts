import { z } from 'zod'

import { addressSchema, publicAddressSchema } from './address'
import { ROUTE_PHOTO_MAX_BYTES } from './route-photo'

/**
 * Membres de l'organisation (Lot 24, DECISIONS.md ADR-087). Le statut est
 * calculé par le serveur, jamais stocké : pas encore de mot de passe = invité
 * (ou invitation expirée), `deactivated_at` non nul = désactivé.
 */
export const memberRoleSchema = z.enum(['owner', 'organizer'])
export type MemberRole = z.infer<typeof memberRoleSchema>

export const memberStatusSchema = z.enum(['invited', 'invitation_expired', 'active', 'deactivated'])
export type MemberStatus = z.infer<typeof memberStatusSchema>

export const memberSchema = z.strictObject({
  id: z.uuid(),
  displayName: z.string(),
  email: z.email(),
  role: memberRoleSchema,
  status: memberStatusSchema,
  /** Fin de validité du lien d'invitation, pour un membre pas encore activé. */
  invitationExpiresAt: z.iso.datetime().nullable(),
  lastLoginAt: z.iso.datetime().nullable(),
  deactivatedAt: z.iso.datetime().nullable(),
})
export type Member = z.infer<typeof memberSchema>

export const memberListSchema = z.array(memberSchema)

export const changeMemberRoleInputSchema = z.strictObject({
  role: memberRoleSchema,
})
export type ChangeMemberRoleInput = z.infer<typeof changeMemberRoleInputSchema>

/**
 * Fiche de l'organisation (Lot 25, DECISIONS.md ADR-088). Un champ vidé vaut
 * `null` : le formulaire n'envoie jamais de chaîne vide.
 */
export const organizationTypeSchema = z.enum(['club', 'gym', 'other'])
export type OrganizationType = z.infer<typeof organizationTypeSchema>

const PHONE_MESSAGE =
  'Numéro de téléphone invalide : chiffres, espaces et + . - ( ) seulement, 6 chiffres au moins.'

const contactPhoneSchema = z
  .string()
  .trim()
  .max(30, PHONE_MESSAGE)
  .regex(/^[0-9+().\s-]+$/, PHONE_MESSAGE)
  .refine((value) => (value.match(/\d/g)?.length ?? 0) >= 6, PHONE_MESSAGE)

const websiteUrlSchema = z
  .url({
    protocol: /^https$/,
    error: 'Adresse du site invalide : elle doit commencer par https://.',
  })
  .max(500)

export const organizationProfileSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  type: organizationTypeSchema,
  description: z.string().nullable(),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
  websiteUrl: z.string().nullable(),
  address: addressSchema.nullable(),
})
export type OrganizationProfile = z.infer<typeof organizationProfileSchema>

export const updateOrganizationInputSchema = z
  .strictObject({
    name: z
      .string()
      .trim()
      .min(1, 'Indiquez le nom de l’organisation.')
      .max(120, 'Le nom ne peut pas dépasser 120 caractères.'),
    type: organizationTypeSchema,
    description: z
      .string()
      .trim()
      .min(1)
      .max(2000, 'La description ne peut pas dépasser 2 000 caractères.')
      .nullable(),
    contactEmail: z.email('Adresse e-mail invalide.').max(254).nullable(),
    contactPhone: contactPhoneSchema.nullable(),
    websiteUrl: websiteUrlSchema.nullable(),
    address: addressSchema.nullable(),
  })
  .partial()
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationInputSchema>

/**
 * Photos de la fiche (Lot 27, DECISIONS.md ADR-090) : même chaîne que la photo
 * de voie (JPEG ré-encodé dans le navigateur, signature vérifiée par le
 * serveur), 6 actives au plus. Une liste est toujours dans l'ordre d'affichage.
 */
export const ORGANIZATION_PHOTO_MAX_COUNT = 6
export const ORGANIZATION_PHOTO_MAX_BYTES = ROUTE_PHOTO_MAX_BYTES
export const ORGANIZATION_PHOTO_ALT_MAX_LENGTH = 200

export const organizationPhotoSchema = z.strictObject({
  id: z.uuid(),
  altText: z.string().nullable(),
})
export type OrganizationPhoto = z.infer<typeof organizationPhotoSchema>

export const organizationPhotoListSchema = z.array(organizationPhotoSchema)

/** `PATCH /organization/photos/:id` — `null` retire le texte. */
export const updateOrganizationPhotoInputSchema = z.strictObject({
  altText: z
    .string()
    .trim()
    .min(1)
    .max(
      ORGANIZATION_PHOTO_ALT_MAX_LENGTH,
      `La description ne peut pas dépasser ${ORGANIZATION_PHOTO_ALT_MAX_LENGTH} caractères.`,
    )
    .nullable(),
})
export type UpdateOrganizationPhotoInput = z.infer<typeof updateOrganizationPhotoInputSchema>

/** `PUT /organization/photos/order` — toutes les photos actives, dans le nouvel ordre. */
export const reorderOrganizationPhotosInputSchema = z.strictObject({
  photoIds: z
    .array(z.uuid())
    .max(ORGANIZATION_PHOTO_MAX_COUNT)
    .refine((ids) => new Set(ids).size === ids.length, 'Une photo apparaît deux fois.'),
})
export type ReorderOrganizationPhotosInput = z.infer<typeof reorderOrganizationPhotosInputSchema>

/** L'encart « Organisation » de la page publique d'une compétition. */
export const publicOrganizationSchema = z.strictObject({
  name: z.string(),
  type: organizationTypeSchema,
  description: z.string().nullable(),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
  websiteUrl: z.string().nullable(),
  address: publicAddressSchema.nullable(),
  photos: z.array(organizationPhotoSchema).max(ORGANIZATION_PHOTO_MAX_COUNT),
})
export type PublicOrganization = z.infer<typeof publicOrganizationSchema>
