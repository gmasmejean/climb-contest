import type { user } from '@climbcontest/db'
import { describe, expect, it } from 'vitest'

import { isActiveOwner, memberStatus, removesLastActiveOwner, toMember } from './members'

type UserRow = typeof user.$inferSelect

const NOW = new Date('2026-09-27T10:00:00Z')

function row(overrides: Partial<UserRow> & { id: string }): UserRow {
  return {
    organizationId: 'org',
    email: `${overrides.id}@test.local`,
    passwordHash: 'hash',
    displayName: overrides.id,
    role: 'organizer',
    lastLoginAt: null,
    emailVerifiedAt: NOW,
    invitedByUserId: null,
    pendingTokenHash: null,
    pendingTokenPurpose: null,
    pendingTokenExpiresAt: null,
    deactivatedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

const invited = (id: string, expiresAt: Date) =>
  row({
    id,
    passwordHash: null,
    emailVerifiedAt: null,
    pendingTokenHash: 'h',
    pendingTokenPurpose: 'invitation',
    pendingTokenExpiresAt: expiresAt,
  })

describe('memberStatus (ADR-087)', () => {
  it('actif quand le compte a un mot de passe', () => {
    expect(memberStatus(row({ id: 'a' }), NOW)).toBe('active')
  })

  it('invité tant que le lien est valable, expiré ensuite', () => {
    expect(memberStatus(invited('a', new Date('2026-09-28T00:00:00Z')), NOW)).toBe('invited')
    expect(memberStatus(invited('a', new Date('2026-09-27T09:59:59Z')), NOW)).toBe(
      'invitation_expired',
    )
  })

  it('désactivé l’emporte sur tout le reste', () => {
    expect(memberStatus(row({ id: 'a', deactivatedAt: NOW }), NOW)).toBe('deactivated')
  })
})

describe('toMember', () => {
  it('ne donne la fin de validité que pour une invitation en attente', () => {
    const expiresAt = new Date('2026-10-04T10:00:00Z')
    expect(toMember(invited('a', expiresAt), NOW).invitationExpiresAt).toBe(expiresAt.toISOString())
    // Un owner inscrit mais pas encore vérifié porte aussi un jeton : ce n'est pas une invitation.
    const unverified = row({
      id: 'b',
      emailVerifiedAt: null,
      pendingTokenPurpose: 'email_verification',
      pendingTokenExpiresAt: expiresAt,
    })
    expect(toMember(unverified, NOW).invitationExpiresAt).toBeNull()
  })

  it('n’expose ni mot de passe ni jeton', () => {
    expect(Object.keys(toMember(row({ id: 'a' }), NOW)).sort()).toEqual(
      [
        'deactivatedAt',
        'displayName',
        'email',
        'id',
        'invitationExpiresAt',
        'lastLoginAt',
        'role',
        'status',
      ].sort(),
    )
  })
})

describe('removesLastActiveOwner (ADR-086 point 7)', () => {
  const owner = (id: string, overrides: Partial<UserRow> = {}) =>
    row({ id, role: 'owner', ...overrides })

  it('vrai pour le seul owner actif', () => {
    expect(removesLastActiveOwner([owner('a'), row({ id: 'b' })], 'a')).toBe(true)
  })

  it('faux s’il reste un autre owner actif', () => {
    expect(removesLastActiveOwner([owner('a'), owner('b')], 'a')).toBe(false)
  })

  it('un owner désactivé ou seulement invité ne compte pas', () => {
    const members = [
      owner('a'),
      owner('b', { deactivatedAt: NOW }),
      { ...invited('c', new Date('2026-10-01T00:00:00Z')), role: 'owner' },
    ]
    expect(removesLastActiveOwner(members, 'a')).toBe(true)
  })

  it('faux quand la cible n’est pas un owner actif', () => {
    expect(removesLastActiveOwner([owner('a'), row({ id: 'b' })], 'b')).toBe(false)
    expect(isActiveOwner(owner('x', { passwordHash: null }))).toBe(false)
  })
})
