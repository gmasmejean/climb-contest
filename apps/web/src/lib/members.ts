import type { Member, MemberRole } from '@climbcontest/contracts'

/**
 * Présentation des membres de l'organisation (Lot 24, ADR-087) : libellés et
 * actions proposées. Pur, pour que l'écran n'ait qu'à afficher.
 */

export const ROLE_LABELS: Record<MemberRole, string> = {
  owner: 'Propriétaire',
  organizer: 'Organisateur',
}

export interface StatusLabel {
  text: string
  tone: 'neutral' | 'success' | 'warning' | 'danger'
  detail: string | null
}

const shortDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })

export function statusLabel(member: Member): StatusLabel {
  switch (member.status) {
    case 'active':
      return { text: 'Actif', tone: 'success', detail: null }
    case 'invited':
      return {
        text: 'Invitation envoyée',
        tone: 'warning',
        detail: member.invitationExpiresAt
          ? `Lien valable jusqu’au ${shortDate(member.invitationExpiresAt)}`
          : null,
      }
    case 'invitation_expired':
      return {
        text: 'Invitation expirée',
        tone: 'danger',
        detail: 'Renvoyez l’invitation pour lui donner un nouveau lien.',
      }
    case 'deactivated':
      return {
        text: 'Désactivé',
        tone: 'neutral',
        detail: member.deactivatedAt ? `Depuis le ${shortDate(member.deactivatedAt)}` : null,
      }
  }
}

export type MemberAction =
  | 'resend-invitation'
  | 'cancel-invitation'
  | 'make-owner'
  | 'make-organizer'
  | 'deactivate'
  | 'reactivate'

export const ACTION_LABELS: Record<MemberAction, string> = {
  'resend-invitation': 'Renvoyer l’invitation',
  'cancel-invitation': 'Annuler l’invitation',
  'make-owner': 'Rendre propriétaire',
  'make-organizer': 'Rendre organisateur',
  deactivate: 'Désactiver',
  reactivate: 'Réactiver',
}

/** Actions qui demandent une confirmation : elles retirent un accès. */
export const CONFIRMED_ACTIONS: ReadonlySet<MemberAction> = new Set([
  'cancel-invitation',
  'deactivate',
])

/**
 * Ce qu'un owner peut faire sur une ligne. Rien sur la sienne (ADR-087
 * point 10) ; un organizer ne voit jamais d'action. Le serveur revérifie tout.
 */
export function memberActions(
  member: Member,
  viewer: { id: string; isOwner: boolean },
): MemberAction[] {
  if (!viewer.isOwner || member.id === viewer.id) return []
  switch (member.status) {
    case 'invited':
    case 'invitation_expired':
      return ['resend-invitation', 'cancel-invitation']
    case 'active':
      return [member.role === 'owner' ? 'make-organizer' : 'make-owner', 'deactivate']
    case 'deactivated':
      return ['reactivate']
  }
}
