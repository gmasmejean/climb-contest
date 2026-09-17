import { SignJWT, jwtVerify } from 'jose'

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60

export interface AccessTokenClaims {
  sub: string
  clubId: string
  role: 'owner' | 'organizer'
}

export interface AccessTokenSigner {
  sign(claims: AccessTokenClaims): Promise<string>
  verify(token: string): Promise<AccessTokenClaims>
}

class InvalidAccessTokenError extends Error {
  constructor() {
    super('Jeton d’accès invalide.')
  }
}

export function createAccessTokenSigner(secret: string): AccessTokenSigner {
  const key = new TextEncoder().encode(secret)

  return {
    async sign(claims) {
      return new SignJWT({ clubId: claims.clubId, role: claims.role })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(claims.sub)
        .setIssuedAt()
        .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
        .sign(key)
    },
    async verify(token) {
      const { payload } = await jwtVerify(token, key)
      const { sub, clubId, role } = payload
      if (
        typeof sub !== 'string' ||
        typeof clubId !== 'string' ||
        (role !== 'owner' && role !== 'organizer')
      ) {
        throw new InvalidAccessTokenError()
      }
      return { sub, clubId, role }
    },
  }
}

/**
 * Jeton juge (SPEC.md § 3.2) : identité seule (`sub` = judge.id,
 * `competitionId`). Volontairement minimal — jamais de voies assignées
 * embarquées : l'autorisation par voie est revérifiée en base à chaque appel
 * (DECISIONS.md ADR-026), pour que révocation et réassignation prennent
 * effet immédiatement plutôt qu'à l'expiration du jeton.
 */
export interface JudgeTokenClaims {
  sub: string
  competitionId: string
}

export interface JudgeTokenSigner {
  /** `expiresAt` : fin de la compétition + 12h, calculée par l'appelant. */
  sign(claims: JudgeTokenClaims, expiresAt: Date): Promise<string>
  verify(token: string): Promise<JudgeTokenClaims>
}

class InvalidJudgeTokenError extends Error {
  constructor() {
    super('Jeton juge invalide.')
  }
}

export function createJudgeTokenSigner(secret: string): JudgeTokenSigner {
  const key = new TextEncoder().encode(secret)

  return {
    async sign(claims, expiresAt) {
      return new SignJWT({ competitionId: claims.competitionId })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(claims.sub)
        .setIssuedAt()
        .setExpirationTime(expiresAt)
        .sign(key)
    },
    async verify(token) {
      const { payload } = await jwtVerify(token, key)
      const { sub, competitionId } = payload
      if (typeof sub !== 'string' || typeof competitionId !== 'string') {
        throw new InvalidJudgeTokenError()
      }
      return { sub, competitionId }
    },
  }
}
