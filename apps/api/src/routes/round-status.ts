import { changeRoundStatusInputSchema, roundSchema } from '@climbcontest/contracts'
import { activityLog, round, roundRoute, type Database } from '@climbcontest/db'
import { zValidator } from '@hono/zod-validator'
import { and, eq, isNull } from 'drizzle-orm'
import { Hono } from 'hono'

import type { AccessTokenSigner } from '../lib/jwt'
import { notifyPublic } from '../lib/notify-public'
import { isValidRoundTransition, roundHasUnresolvedConflicts } from '../lib/round-status'
import { requireOrganizer } from '../middleware/auth'
import { requireCompetitionAccess } from '../middleware/competition-access'
import { ApiError, problem } from '../middleware/problem'

export interface RoundStatusRouteDeps {
  db: Database
  accessTokenSigner: AccessTokenSigner
}

/**
 * Transition de statut d'un tour (Lot 8, DECISIONS.md) — délibérément en
 * dehors de `routes/rounds.ts`, qui réserve toutes ses routes au format
 * phases (`requirePhasesFormat`, appliqué en `app.use('*', ...)` sur tout
 * le sous-chemin `/rounds`). Le tour implicite du format contest (ADR-023)
 * doit pouvoir être ouvert/fermé/publié exactement de la même façon
 * (ADR-040) — cette route est donc format-agnostique.
 *
 * Chemin délibérément `/round-status/:roundId`, PAS `/rounds/:roundId/status` :
 * Hono aplatit le middleware global de `rounds.ts` sur tout `/rounds/*` au
 * moment du montage (`app.route`), donc même un chemin sans handler dans
 * `rounds.ts` (comme `/rounds/:roundId/status`) serait intercepté par
 * `requirePhasesFormat()` avant d'atteindre cette route, quel que soit
 * l'ordre de montage dans `app.ts` — vérifié en écrivant le test avant ce
 * commentaire (échec 400 sur le format contest).
 */
export function createRoundStatusRoutes(deps: RoundStatusRouteDeps): Hono {
  const app = new Hono()
  const { db, accessTokenSigner } = deps

  app.use('*', requireOrganizer(accessTokenSigner), requireCompetitionAccess(db))

  app.post(
    '/round-status/:roundId',
    zValidator('json', changeRoundStatusInputSchema, (result, c) => {
      if (!result.success)
        return problem(c, 400, 'Requête invalide', result.error.issues[0]?.message)
    }),
    async (c) => {
      const organizer = c.get('organizer')
      const competitionId = c.get('competition').id
      const roundId = c.req.param('roundId')
      const { status: nextStatus } = c.req.valid('json')

      const existingRow = await db.query.round.findFirst({
        where: and(
          eq(round.id, roundId),
          eq(round.competitionId, competitionId),
          isNull(round.deletedAt),
        ),
      })
      if (!existingRow) throw new ApiError(404, 'Tour introuvable', "Ce tour n'existe pas.")
      // `round.status` est un `text` + CHECK en base (ADR-018), pas un enum
      // natif — `roundSchema.parse` restreint le type à l'union littérale
      // réelle plutôt qu'un `string` générique.
      const existing = roundSchema.parse(existingRow)

      if (existing.status === nextStatus) {
        return c.json(existing)
      }

      if (!isValidRoundTransition(existing.status, nextStatus)) {
        throw new ApiError(
          409,
          'Transition impossible',
          `Un tour « ${existing.status} » ne peut pas passer directement à « ${nextStatus} ».`,
        )
      }

      if (nextStatus === 'published' && (await roundHasUnresolvedConflicts(db, roundId))) {
        throw new ApiError(
          409,
          'Conflit non résolu',
          'Ce tour contient au moins un conflit de saisie non résolu — tranchez-le avant de publier les résultats.',
        )
      }

      const updated = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(round)
          .set({ status: nextStatus, updatedAt: new Date() })
          .where(eq(round.id, roundId))
          .returning()
        if (!row) throw new ApiError(500, 'Erreur interne', 'Impossible de mettre à jour le tour.')

        await tx.insert(activityLog).values({
          competitionId,
          eventType: 'round_status_changed',
          actorType: 'organizer',
          actorId: organizer.sub,
          entityId: roundId,
          payload: { from: existing.status, to: nextStatus },
        })

        // Même effet de bord que l'ancien PATCH générique (ROADMAP.md Lot 7) :
        // un `ranking_updated` par catégorie concernée accompagne toujours le
        // `round_status_changed`.
        await notifyPublic(tx, { type: 'round_status_changed', competitionId, roundId })
        const categoryLinks = await tx
          .select({ categoryId: roundRoute.categoryId })
          .from(roundRoute)
          .where(eq(roundRoute.roundId, roundId))
        const categoryIds = new Set(categoryLinks.map((link) => link.categoryId))
        for (const categoryId of categoryIds) {
          await notifyPublic(tx, { type: 'ranking_updated', competitionId, categoryId })
        }

        return row
      })

      return c.json(roundSchema.parse(updated))
    },
  )

  return app
}
