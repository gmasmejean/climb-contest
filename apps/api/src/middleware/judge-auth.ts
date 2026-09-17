import { judge, type Database } from '@climbcontest/db'
import { and, eq, isNull } from 'drizzle-orm'
import type { Context, Next } from 'hono'

import type { JudgeTokenSigner } from '../lib/jwt'
import { ApiError } from './problem'

type JudgeRow = typeof judge.$inferSelect

declare module 'hono' {
  interface ContextVariableMap {
    judge: JudgeRow
  }
}

/**
 * Vérifie le JWT juge puis recharge le juge depuis la base à chaque appel —
 * contrairement au JWT organisateur (court, 15 min), le JWT juge vit
 * plusieurs jours : on ne peut pas se contenter de faire confiance à ses
 * claims pour la révocation (SPEC.md § 3.2 : « un juge révoqué est
 * déconnecté au prochain appel »). Voir DECISIONS.md ADR-026.
 */
export function requireJudge(signer: JudgeTokenSigner, db: Database) {
  return async (c: Context, next: Next) => {
    const header = c.req.header('authorization')
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined
    if (!token) {
      throw new ApiError(401, 'Authentification requise', 'Jeton d’accès manquant.')
    }

    let claims: { sub: string; competitionId: string }
    try {
      claims = await signer.verify(token)
    } catch {
      throw new ApiError(401, 'Authentification requise', 'Jeton d’accès invalide ou expiré.')
    }

    const row = await db.query.judge.findFirst({
      where: and(
        eq(judge.id, claims.sub),
        eq(judge.competitionId, claims.competitionId),
        isNull(judge.deletedAt),
      ),
    })
    if (!row) {
      throw new ApiError(401, 'Accès introuvable', "Cet accès n'existe plus.")
    }
    if (row.revokedAt) {
      throw new ApiError(
        401,
        'Accès révoqué',
        'Cet accès a été révoqué par l’organisateur — contactez-le pour en obtenir un nouveau.',
      )
    }
    c.set('judge', row)
    await next()
  }
}
