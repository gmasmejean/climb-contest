import { z } from 'zod'

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
