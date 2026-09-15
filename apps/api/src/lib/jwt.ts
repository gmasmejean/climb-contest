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
