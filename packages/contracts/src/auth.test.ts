import { describe, expect, it } from 'vitest'

import { acceptInviteInputSchema, loginInputSchema, registerInputSchema } from './auth'
import { organizerSchema } from './entities'

describe('registerInputSchema', () => {
  it('accepte une inscription valide', () => {
    const result = registerInputSchema.safeParse({
      email: 'alex@club-demo.test',
      password: 'un-mot-de-passe-solide',
      displayName: 'Alex Organisateur',
      clubName: 'Club Démo',
    })
    expect(result.success).toBe(true)
  })

  it("refuse un mot de passe trop court", () => {
    const result = registerInputSchema.safeParse({
      email: 'alex@club-demo.test',
      password: 'trop-court',
      displayName: 'Alex',
      clubName: 'Club Démo',
    })
    expect(result.success).toBe(false)
  })

  it('refuse un e-mail invalide', () => {
    const result = registerInputSchema.safeParse({
      email: 'pas-un-email',
      password: 'un-mot-de-passe-solide',
      displayName: 'Alex',
      clubName: 'Club Démo',
    })
    expect(result.success).toBe(false)
  })
})

describe('loginInputSchema', () => {
  it('refuse un mot de passe vide', () => {
    const result = loginInputSchema.safeParse({ email: 'alex@club-demo.test', password: '' })
    expect(result.success).toBe(false)
  })
})

describe('acceptInviteInputSchema', () => {
  it('exige un mot de passe suffisamment long', () => {
    const result = acceptInviteInputSchema.safeParse({ token: 'abc', password: 'short' })
    expect(result.success).toBe(false)
  })
})

describe('organizerSchema', () => {
  it('ne laisse jamais transiter le hash de mot de passe ou les jetons en attente', () => {
    const row = {
      id: '0189dcd5-5311-7d40-8db0-9496a2eef37b',
      clubId: '0189dcd5-5311-7d40-8db0-9496a2eef370',
      email: 'alex@club-demo.test',
      passwordHash: '$argon2id$secret',
      displayName: 'Alex',
      role: 'owner',
      lastLoginAt: null,
      emailVerifiedAt: new Date(),
      invitedByUserId: null,
      pendingTokenHash: 'should-never-leak',
      pendingTokenPurpose: null,
      pendingTokenExpiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    const parsed = organizerSchema.parse(row)

    expect(parsed).not.toHaveProperty('passwordHash')
    expect(parsed).not.toHaveProperty('pendingTokenHash')
    expect(parsed.email).toBe('alex@club-demo.test')
  })
})
