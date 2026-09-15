import type { Context, Next } from 'hono'

import type { AccessTokenClaims, AccessTokenSigner } from '../lib/jwt'
import { ApiError } from './problem'

declare module 'hono' {
  interface ContextVariableMap {
    organizer: AccessTokenClaims
  }
}

export function requireOrganizer(signer: AccessTokenSigner) {
  return async (c: Context, next: Next) => {
    const header = c.req.header('authorization')
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined
    if (!token) {
      throw new ApiError(401, 'Authentification requise', 'Jeton d’accès manquant.')
    }
    try {
      const claims = await signer.verify(token)
      c.set('organizer', claims)
    } catch {
      throw new ApiError(401, 'Authentification requise', 'Jeton d’accès invalide ou expiré.')
    }
    await next()
  }
}

export function requireOwner() {
  return async (c: Context, next: Next) => {
    const organizer = c.get('organizer')
    if (organizer.role !== 'owner') {
      throw new ApiError(
        403,
        'Accès refusé',
        'Seul le propriétaire du club peut effectuer cette action.',
      )
    }
    await next()
  }
}
