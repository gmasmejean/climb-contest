import { user, type Database } from '@climbcontest/db'
import { eq } from 'drizzle-orm'
import type { Context, MiddlewareHandler, Next } from 'hono'

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

/**
 * ADR-087 point 8 : le rôle est relu en base, pas pris dans le jeton — une
 * rétrogradation ou une désactivation prend effet tout de suite sur ces
 * actions sensibles, sans attendre l'expiration du jeton (15 min).
 */
export function requireOwner(db: Database): MiddlewareHandler {
  return async (c, next) => {
    const organizer = c.get('organizer')
    const row = await db.query.user.findFirst({ where: eq(user.id, organizer.sub) })
    if (
      !row ||
      row.organizationId !== organizer.organizationId ||
      row.role !== 'owner' ||
      row.deactivatedAt !== null
    ) {
      throw new ApiError(
        403,
        'Accès refusé',
        'Seul le propriétaire de l’organisation peut effectuer cette action.',
      )
    }
    await next()
  }
}
