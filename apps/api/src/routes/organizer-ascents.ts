import {
  ascentSchema,
  correctAscentByOrganizerInputSchema,
  createAscentByOrganizerInputSchema,
  judgeRouteCompetitorSchema,
  organizerAscentWriteResultSchema,
  organizerRouteAscentsQuerySchema,
  type OrganizerAscentWriteResult,
} from '@climbcontest/contracts'
import { ascent, category, competitor, round, roundRoute, route, type Database } from '@climbcontest/db'
import { zValidator } from '@hono/zod-validator'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { uuidv7 } from 'uuidv7'

import { activeAscentsFor, expectedCompetitors } from '../lib/ascent-progress'
import { supersedeToNewAscent } from '../lib/ascent-correction'
import { createAscentOrConflict, type AscentWriteResult } from '../lib/ascent-write'
import type { AccessTokenSigner } from '../lib/jwt'
import { requireOrganizer } from '../middleware/auth'
import { requireCompetitionAccess } from '../middleware/competition-access'
import { ApiError, problem } from '../middleware/problem'

export interface OrganizerAscentRouteDeps {
  db: Database
  accessTokenSigner: AccessTokenSigner
}

function toResponse(result: AscentWriteResult): OrganizerAscentWriteResult {
  if (result.status === 'conflict') {
    return organizerAscentWriteResultSchema.parse({
      status: 'conflict',
      conflictGroup: result.conflictGroup,
      existing: ascentSchema.parse(result.existing),
      incoming: ascentSchema.parse(result.incoming),
    })
  }
  if (result.status === 'quarantined') {
    // ADR-078 : la quarantaine est réservée au lot d'un juge révoqué.
    throw new Error('Une saisie organisateur ne peut pas être mise en quarantaine.')
  }
  return organizerAscentWriteResultSchema.parse({
    status: result.status,
    ascent: ascentSchema.parse(result.ascent),
  })
}

/**
 * Lot 8 (ROADMAP.md, SPEC.md § 3.1) : saisie de secours (l'organisateur note
 * à la place d'un juge) et correction d'un passage quelconque, avec motif
 * obligatoire. Réutilise `lib/ascent-write.ts`/`lib/ascent-correction.ts` —
 * même mécanique que la saisie/correction juge, avec `recordedByUserId` au
 * lieu de `recordedByJudgeId`.
 *
 * Écart assumé à `SPEC.md` § 7 : la spec esquissait `PATCH /ascents/:id`
 * hors du préfixe compétition. Nesté sous `/competitions/:id/ascents/:id`
 * pour réutiliser `requireCompetitionAccess` comme toutes les autres routes
 * organisateur (DECISIONS.md).
 */
export function createOrganizerAscentRoutes(deps: OrganizerAscentRouteDeps): Hono {
  const app = new Hono()
  const { db, accessTokenSigner } = deps

  app.use('*', requireOrganizer(accessTokenSigner), requireCompetitionAccess(db))

  /**
   * Liste les compétiteurs d'une voie pour un tour donné, avec leur passage
   * actif s'il existe — même besoin que l'écran juge (`buildRouteDetail`,
   * `judge-ascents.ts`) pour que l'onglet Pilotage « Voies » propose
   * correction ou saisie de secours.
   */
  app.get(
    '/',
    zValidator('query', organizerRouteAscentsQuerySchema, (result, c) => {
      if (!result.success)
        return problem(c, 400, 'Requête invalide', result.error.issues[0]?.message)
    }),
    async (c) => {
      const competitionId = c.get('competition').id
      const { roundId, routeId } = c.req.valid('query')

      const links = await db
        .select({ categoryId: roundRoute.categoryId })
        .from(roundRoute)
        .innerJoin(round, eq(round.id, roundRoute.roundId))
        .where(
          and(
            eq(roundRoute.roundId, roundId),
            eq(roundRoute.routeId, routeId),
            eq(round.competitionId, competitionId),
          ),
        )
      const categoryIds = links.map((link) => link.categoryId)
      if (categoryIds.length === 0) {
        throw new ApiError(404, 'Tour ou voie introuvable', "Cette voie n'appartient pas à ce tour.")
      }

      const categoryLabels = new Map(
        (
          await db.query.category.findMany({ where: inArray(category.id, categoryIds) })
        ).map((cat) => [cat.id, cat.label]),
      )
      const competitors = await expectedCompetitors(db, competitionId, categoryIds, roundId)
      const ascentsByCompetitor = await activeAscentsFor(
        db,
        roundId,
        routeId,
        competitors.map((comp) => comp.id),
      )

      const response = competitors.map((comp) => {
        const existing = ascentsByCompetitor.get(comp.id)
        return judgeRouteCompetitorSchema.parse({
          id: comp.id,
          bib: comp.bib,
          firstName: comp.firstName,
          lastName: comp.lastName,
          categoryLabel: categoryLabels.get(comp.categoryId) ?? '',
          ascent: existing
            ? {
                id: existing.id,
                holdNumber: existing.holdNumber,
                modifier: existing.modifier,
                isTop: existing.isTop,
                status: existing.status,
                climbTimeMs: existing.climbTimeMs,
                recordedAt: existing.recordedAt.toISOString(),
              }
            : null,
        })
      })
      return c.json(response)
    },
  )

  app.post(
    '/',
    zValidator('json', createAscentByOrganizerInputSchema, (result, c) => {
      if (!result.success)
        return problem(c, 400, 'Passage invalide', result.error.issues[0]?.message)
    }),
    async (c) => {
      const organizer = c.get('organizer')
      const competitionId = c.get('competition').id
      const input = c.req.valid('json')

      const routeRow = await db.query.route.findFirst({
        where: and(eq(route.id, input.routeId), eq(route.competitionId, competitionId), isNull(route.deletedAt)),
      })
      if (!routeRow) throw new ApiError(404, 'Voie introuvable', "Cette voie n'existe pas.")

      const result = await createAscentOrConflict(
        db,
        { kind: 'organizer', userId: organizer.sub },
        {
          id: uuidv7(),
          roundId: input.roundId,
          routeId: input.routeId,
          competitorId: input.competitorId,
          holdNumber: input.holdNumber,
          modifier: input.modifier,
          isTop: input.isTop,
          status: input.status,
          climbTimeMs: input.climbTimeMs,
          recordedAt: input.recordedAt,
          deviceId: `organizer:${organizer.sub}`,
        },
        routeRow,
        competitionId,
      )
      return c.json(toResponse(result), result.status === 'conflict' ? 200 : 201)
    },
  )

  app.patch(
    '/:ascentId',
    zValidator('json', correctAscentByOrganizerInputSchema, (result, c) => {
      if (!result.success)
        return problem(c, 400, 'Correction invalide', result.error.issues[0]?.message)
    }),
    async (c) => {
      const organizer = c.get('organizer')
      const competitionId = c.get('competition').id
      const ascentId = c.req.param('ascentId')
      const input = c.req.valid('json')

      const target = await db.query.ascent.findFirst({
        where: and(
          eq(ascent.id, ascentId),
          eq(ascent.competitionId, competitionId),
          isNull(ascent.supersededBy),
        ),
      })
      if (!target) {
        throw new ApiError(
          404,
          'Passage introuvable',
          "Ce passage n'existe pas ou a déjà été corrigé.",
        )
      }
      if (target.conflictGroup !== null) {
        throw new ApiError(
          409,
          'Correction refusée',
          'Ce passage est en conflit — résolvez-le depuis l’onglet Conflits plutôt que de le corriger directement.',
        )
      }

      if (input.status === 'valid' && !input.isTop) {
        if (input.holdNumber === null || input.holdNumber > target.holdCount) {
          throw new ApiError(
            400,
            'Prise invalide',
            `Le numéro de prise doit être compris entre 1 et ${target.holdCount}.`,
          )
        }
      }

      const targetCompetitor = await db.query.competitor.findFirst({
        where: eq(competitor.id, target.competitorId),
      })
      if (!targetCompetitor) {
        throw new ApiError(404, 'Compétiteur introuvable', "Ce compétiteur n'existe pas.")
      }

      const created = await supersedeToNewAscent(db, {
        sources: [target],
        newId: uuidv7(),
        content: {
          holdNumber: input.holdNumber,
          modifier: input.modifier,
          isTop: input.isTop,
          status: input.status,
          climbTimeMs: input.climbTimeMs,
        },
        actor: { kind: 'organizer', userId: organizer.sub },
        categoryId: targetCompetitor.categoryId,
        eventType: 'corrected',
        reason: input.reason,
      })

      return c.json(ascentSchema.parse(created))
    },
  )

  return app
}
