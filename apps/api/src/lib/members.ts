import type { Member, MemberRole, MemberStatus } from '@climbcontest/contracts'
import type { user } from '@climbcontest/db'

type UserRow = typeof user.$inferSelect

/**
 * Statut d'un membre (ADR-087 point 2), calculé à la lecture : jamais stocké,
 * donc jamais en désaccord avec les colonnes dont il découle.
 */
export function memberStatus(row: UserRow, now: Date): MemberStatus {
  if (row.deactivatedAt) return 'deactivated'
  if (row.passwordHash) return 'active'
  if (row.pendingTokenExpiresAt && row.pendingTokenExpiresAt.getTime() > now.getTime()) {
    return 'invited'
  }
  return 'invitation_expired'
}

export function isPendingInvitation(row: UserRow): boolean {
  return row.passwordHash === null && row.pendingTokenPurpose === 'invitation'
}

export function toMember(row: UserRow, now: Date): Member {
  const role: MemberRole = row.role === 'owner' ? 'owner' : 'organizer'
  return {
    id: row.id,
    displayName: row.displayName,
    email: row.email,
    role,
    status: memberStatus(row, now),
    invitationExpiresAt:
      isPendingInvitation(row) && row.pendingTokenExpiresAt
        ? row.pendingTokenExpiresAt.toISOString()
        : null,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    deactivatedAt: row.deactivatedAt?.toISOString() ?? null,
  }
}

/** Un owner qui peut agir : rôle owner, compte activé, non désactivé. */
export function isActiveOwner(row: UserRow): boolean {
  return row.role === 'owner' && row.passwordHash !== null && row.deactivatedAt === null
}

/**
 * ADR-086 point 7 : vrai si retirer `targetId` des owners actifs (rétrogradation
 * ou désactivation) laisserait l'organisation sans aucun owner actif.
 */
export function removesLastActiveOwner(members: readonly UserRow[], targetId: string): boolean {
  const target = members.find((member) => member.id === targetId)
  if (!target || !isActiveOwner(target)) return false
  return !members.some((member) => member.id !== targetId && isActiveOwner(member))
}

/** Ordre d'affichage : nom, à la française (accents, casse). */
export function compareMembers(a: Member, b: Member): number {
  return a.displayName.localeCompare(b.displayName, 'fr', { sensitivity: 'base' })
}
