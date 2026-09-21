import { competition, judge, type Database } from '@climbcontest/db'
import { and, eq, isNull } from 'drizzle-orm'
import type { Context, Next } from 'hono'

import type { JudgeTokenSigner } from '../lib/jwt'
import { ApiError } from './problem'

type JudgeRow = typeof judge.$inferSelect

declare module 'hono' {
  interface ContextVariableMap {
    judge: JudgeRow
    /** ADR-078 : vrai seulement sur une route qui tolère un accès révoqué. */
    judgeRevoked: boolean
  }
}

export interface RequireJudgeOptions {
  /**
   * ADR-078 : routes qui REÇOIVENT quand même l'appel d'un juge révoqué (le lot
   * de saisies, et lui seul) — à charge pour elles de lire `judgeRevoked` et de
   * mettre ce qu'elles reçoivent en quarantaine. Partout ailleurs : 401.
   */
  allowRevoked?: (c: Context) => boolean
}

/**
 * Vérifie le JWT juge puis recharge le juge depuis la base à chaque appel —
 * contrairement au JWT organisateur (court, 15 min), le JWT juge vit
 * plusieurs jours : on ne peut pas se contenter de faire confiance à ses
 * claims pour la révocation (SPEC.md § 3.2 : « un juge révoqué est
 * déconnecté au prochain appel »). Voir DECISIONS.md ADR-026.
 */
export function requireJudge(
  signer: JudgeTokenSigner,
  db: Database,
  now: () => Date = () => new Date(),
  options: RequireJudgeOptions = {},
) {
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
    const revoked = row.revokedAt !== null
    if (revoked && !options.allowRevoked?.(c)) {
      throw new ApiError(
        401,
        'Accès révoqué',
        'Cet accès a été révoqué par l’organisateur — contactez-le pour en obtenir un nouveau.',
        'judge_revoked',
      )
    }
    // Compétition à la corbeille (Lot 11, ADR-063) : plus aucune saisie tant
    // qu'elle n'est pas restaurée. Une erreur HTTP fait revenir TOUTES les
    // saisies en file locale (`SyncEngine`, hors ligne) : rien n'est perdu, et
    // elles remontent après restauration.
    const live = await db.query.competition.findFirst({
      columns: { id: true },
      where: and(eq(competition.id, row.competitionId), isNull(competition.deletedAt)),
    })
    if (!live) {
      throw new ApiError(
        404,
        'Compétition indisponible',
        'Cette compétition n’est plus disponible — contactez l’organisateur. Vos saisies restent enregistrées sur ce téléphone.',
      )
    }
    c.set('judge', row)
    c.set('judgeRevoked', revoked)
    // Un accès révoqué qui vide sa file n'est pas un « signe de vie » : le
    // tableau de bord ne doit pas le montrer comme un juge actif.
    if (revoked) {
      await next()
      return
    }
    // Lot 8 : « dernier signe de vie » du juge pour le tableau de bord —
    // avant, seule la connexion (routes/judge-auth.ts) le mettait à jour, ce
    // qui aurait affiché un juge actif toute la journée comme « muet depuis
    // 8h ». Un seul point d'écriture, ici, plutôt que dupliqué dans
    // bootstrap/batch.
    await db.update(judge).set({ lastSeenAt: now() }).where(eq(judge.id, row.id))
    await next()
  }
}
