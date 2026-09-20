import {
  changeRoundStatusInputSchema,
  changeRoundStatusResponseSchema,
  type RoundStatus,
} from '@climbcontest/contracts'
import { activityLog, category, competition, round, type Database } from '@climbcontest/db'
import { zValidator } from '@hono/zod-validator'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { Hono } from 'hono'

import type { AccessTokenSigner } from '../lib/jwt'
import { notifyPublic } from '../lib/notify-public'
import { loadStatuses, pairKey, setStatus } from '../lib/round-category'
import {
  assertRoundCanBeReopened,
  assertRoundIsEmptyForDraft,
  categoryIdsOfRound,
  deleteFrozenQualifiers,
  getRoundQualifiersView,
  planQualifiersForOpening,
  saveFrozenQualifiers,
  type QualifierPlanEntry,
} from '../lib/round-qualifiers'
import {
  assertRoutesFreeToOpen,
  isValidRoundTransition,
  roundHasUnresolvedConflicts,
} from '../lib/round-status'
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
      const currentCompetition = c.get('competition')
      const competitionId = currentCompetition.id
      const roundId = c.req.param('roundId')
      const { status: nextStatus, categoryIds: requestedIds } = c.req.valid('json')
      const categoryIds = [...new Set(requestedIds)]

      const existingRow = await db.query.round.findFirst({
        where: and(
          eq(round.id, roundId),
          eq(round.competitionId, competitionId),
          isNull(round.deletedAt),
        ),
      })
      if (!existingRow) throw new ApiError(404, 'Tour introuvable', "Ce tour n'existe pas.")

      // Les catégories visées doivent faire partie de CE tour (au moins une voie
      // via `round_route`) et de cette compétition.
      const linked = new Set(await categoryIdsOfRound(db, roundId))
      const found = await db
        .select({ id: category.id, label: category.label })
        .from(category)
        .where(
          and(
            inArray(category.id, categoryIds),
            eq(category.competitionId, competitionId),
            isNull(category.deletedAt),
          ),
        )
      const labelById = new Map(found.map((row) => [row.id, row.label]))
      for (const categoryId of categoryIds) {
        if (!labelById.has(categoryId) || !linked.has(categoryId)) {
          throw new ApiError(
            404,
            'Catégorie introuvable',
            "Cette catégorie ne fait pas partie de ce tour : ajoutez d'abord au moins une voie pour elle.",
          )
        }
      }

      const before = await loadStatuses(
        db,
        categoryIds.map((categoryId) => ({ roundId, categoryId })),
      )
      const statusOf = (categoryId: string): RoundStatus =>
        before.get(pairKey(roundId, categoryId)) ?? 'draft'

      // Tout ce qui peut refuser la transition est évalué AVANT la transaction
      // (lecture seule) ; la transaction ne fait que l'écrire. Tout ou rien : un
      // refus sur une catégorie refuse l'ensemble, et la nomme dès qu'il y en a
      // plusieurs.
      const changes: { categoryId: string; label: string; from: RoundStatus }[] = []
      const plans: QualifierPlanEntry[] = []
      for (const categoryId of categoryIds) {
        const from = statusOf(categoryId)
        if (from === nextStatus) continue
        const label = labelById.get(categoryId) ?? categoryId
        try {
          if (!isValidRoundTransition(from, nextStatus)) {
            throw new ApiError(
              409,
              'Transition impossible',
              `Un tour « ${from} » ne peut pas passer directement à « ${nextStatus} ».`,
            )
          }
          if (
            nextStatus === 'published' &&
            (await roundHasUnresolvedConflicts(db, roundId, categoryId))
          ) {
            throw new ApiError(
              409,
              'Conflit non résolu',
              'Ce tour contient au moins un conflit de saisie non résolu — tranchez-le avant de publier les résultats.',
            )
          }
          if (nextStatus === 'open') {
            if (from === 'draft') {
              // ADR-054 : figeage des qualifiés, calculé pour cette seule catégorie.
              plans.push(
                ...(await planQualifiersForOpening(db, currentCompetition, existingRow, [
                  categoryId,
                ])),
              )
            } else {
              await assertRoundCanBeReopened(db, competitionId, existingRow, categoryId)
            }
            await assertRoutesFreeToOpen(db, competitionId, roundId, categoryId)
          } else if (nextStatus === 'draft') {
            await assertRoundIsEmptyForDraft(db, roundId, categoryId)
          }
        } catch (error) {
          if (error instanceof ApiError && categoryIds.length > 1) {
            throw new ApiError(
              error.status,
              error.title,
              `${label} : ${error.detail ?? error.title}`,
            )
          }
          throw error
        }
        changes.push({ categoryId, label, from })
      }

      // Une fois la transition acceptée, toutes les catégories visées valent
      // `nextStatus` (celles qui l'avaient déjà n'ont pas bougé).
      const respond = (competitionStatus: typeof currentCompetition.status) =>
        c.json(
          changeRoundStatusResponseSchema.parse({
            roundId,
            categories: categoryIds.map((categoryId) => ({ categoryId, status: nextStatus })),
            competitionStatus,
          }),
        )

      // Rien à changer : idempotent, comme avant — aucune écriture ni événement.
      if (changes.length === 0) return respond(currentCompetition.status)

      // ADR-065 : ouvrir une catégorie fait démarrer la compétition (tracé au journal).
      const promotedFrom =
        nextStatus === 'open' && currentCompetition.status !== 'running'
          ? currentCompetition.status
          : null
      const changedIds = changes.map((change) => change.categoryId)

      await db.transaction(async (tx) => {
        for (const change of changes) {
          await setStatus(tx, roundId, change.categoryId, nextStatus)
          const frozen = plans.find((plan) => plan.categoryId === change.categoryId)
          await tx.insert(activityLog).values({
            competitionId,
            eventType: 'round_status_changed',
            actorType: 'organizer',
            actorId: organizer.sub,
            entityId: roundId,
            payload: {
              from: change.from,
              to: nextStatus,
              categoryId: change.categoryId,
              categoryLabel: change.label,
              ...(frozen && {
                qualifiers: [{ categoryId: frozen.categoryId, count: frozen.qualifiers.length }],
              }),
              ...(promotedFrom && { competitionStatusFrom: promotedFrom }),
            },
          })
        }

        if (nextStatus === 'open') {
          const openedFromDraft = changes.filter((change) => change.from === 'draft')
          await saveFrozenQualifiers(
            tx,
            roundId,
            organizer.sub,
            openedFromDraft.map((change) => change.categoryId),
            plans,
          )
        } else if (nextStatus === 'draft') {
          await deleteFrozenQualifiers(tx, roundId, changedIds)
        }

        if (promotedFrom) {
          await tx
            .update(competition)
            .set({ status: 'running', updatedAt: new Date() })
            .where(eq(competition.id, competitionId))
        }

        // Même effet de bord que l'ancien PATCH générique (ROADMAP.md Lot 7) :
        // un `ranking_updated` par catégorie concernée accompagne toujours le
        // `round_status_changed`.
        await notifyPublic(tx, {
          type: 'round_status_changed',
          competitionId,
          roundId,
          categoryIds: changedIds,
        })
        for (const categoryId of changedIds) {
          await notifyPublic(tx, { type: 'ranking_updated', competitionId, categoryId })
        }
      })

      return respond(promotedFrom ? 'running' : currentCompetition.status)
    },
  )

  // ADR-054 : la liste des qualifiés figée à l'ouverture, pour l'écran Pilotage.
  app.get('/round-status/:roundId/qualifiers', async (c) => {
    const competitionId = c.get('competition').id
    const roundId = c.req.param('roundId')
    const row = await db.query.round.findFirst({
      where: and(
        eq(round.id, roundId),
        eq(round.competitionId, competitionId),
        isNull(round.deletedAt),
      ),
    })
    if (!row) throw new ApiError(404, 'Tour introuvable', "Ce tour n'existe pas.")
    return c.json(await getRoundQualifiersView(db, competitionId, row))
  })

  return app
}
