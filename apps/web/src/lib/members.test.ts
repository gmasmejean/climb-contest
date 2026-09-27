import type { Member } from '@climbcontest/contracts'
import { describe, expect, it } from 'vitest'

import { memberActions, statusLabel } from './members'

function member(overrides: Partial<Member> = {}): Member {
  return {
    id: 'm1',
    displayName: 'Camille',
    email: 'camille@club.test',
    role: 'organizer',
    status: 'active',
    invitationExpiresAt: null,
    lastLoginAt: null,
    deactivatedAt: null,
    ...overrides,
  }
}

const owner = { id: 'me', isOwner: true }

describe('memberActions', () => {
  it('rien pour un organizer, rien sur sa propre ligne', () => {
    expect(memberActions(member(), { id: 'me', isOwner: false })).toEqual([])
    expect(memberActions(member({ id: 'me', role: 'owner' }), owner)).toEqual([])
  })

  it('une invitation se relance ou s’annule, même expirée', () => {
    expect(memberActions(member({ status: 'invited' }), owner)).toEqual([
      'resend-invitation',
      'cancel-invitation',
    ])
    expect(memberActions(member({ status: 'invitation_expired' }), owner)).toEqual([
      'resend-invitation',
      'cancel-invitation',
    ])
  })

  it('un compte actif change de rôle ou se désactive', () => {
    expect(memberActions(member(), owner)).toEqual(['make-owner', 'deactivate'])
    expect(memberActions(member({ role: 'owner' }), owner)).toEqual([
      'make-organizer',
      'deactivate',
    ])
  })

  it('un compte désactivé se réactive, et c’est tout', () => {
    expect(memberActions(member({ status: 'deactivated' }), owner)).toEqual(['reactivate'])
  })
})

describe('statusLabel', () => {
  it('dit jusqu’à quand le lien d’invitation est valable', () => {
    const label = statusLabel(
      member({ status: 'invited', invitationExpiresAt: '2026-10-04T10:00:00.000Z' }),
    )
    expect(label).toMatchObject({ text: 'Invitation envoyée', tone: 'warning' })
    expect(label.detail).toBe('Lien valable jusqu’au 4 octobre')
  })

  it('une invitation expirée dit quoi faire', () => {
    expect(statusLabel(member({ status: 'invitation_expired' })).detail).toContain('Renvoyez')
  })
})
