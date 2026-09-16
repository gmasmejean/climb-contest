import {
  createRoundInputSchema,
  reorderRoundsInputSchema,
  roundSchema,
  setRoundRoutesInputSchema,
  updateRoundInputSchema,
} from '@climbcontest/contracts'
import { round, roundRoute, routeCategory, type Database } from '@climbcontest/db'
import { zValidator } from '@hono/zod-validator'
import { and, asc, eq, isNull, max } from 'drizzle-orm'
import { Hono, type Context, type Next } from 'hono'

import type { AccessTokenSigner } from '../lib/jwt'
import { requireOrganizer } from '../middleware/auth'
import { requireCompetitionAccess } from '../middleware/competition-access'
import { ApiError, problem } from '../middleware/problem'

export interface RoundRouteDeps {
  db: Database
  accessTokenSigner: AccessTokenSigner
}

/**
 * Les tours ne sont gérés par l'organisateur qu'en format phases — en
 * contest, le round unique est implicite et synchronisé par le serveur
 * (voir lib/contest-round.ts, DECISIONS.md).
 */
function requirePhasesFormat() {
  return async (c: Context, next: Next) => {
    if (c.get('competition').format !== 'phases') {
      throw new ApiError(
        400,
        'Fonctionnalité indisponible',
        'Les tours ne se gèrent que pour une compétition au format phases.',
      )
    }
    await next()
  }
}

export function createRoundRoutes(deps: RoundRouteDeps): Hono {
  const app = new Hono()
  const { db, accessTokenSigner } = deps

  app.use(
    '*',
    requireOrganizer(accessTokenSigner),
    requireCompetitionAccess(db),
    requirePhasesFormat(),
  )

  app.get('/', async (c) => {
    const competitionId = c.get('competition').id
    const rows = await db.query.round.findMany({
      where: and(eq(round.competitionId, competitionId), isNull(round.deletedAt)),
      orderBy: [asc(round.displayOrder)],
    })
    return c.json(rows.map((row) => roundSchema.parse(row)))
  })

  app.post(
    '/',
    zValidator('json', createRoundInputSchema, (result, c) => {
      if (!result.success) return problem(c, 400, 'Tour invalide', result.error.issues[0]?.message)
    }),
    async (c) => {
      const competitionId = c.get('competition').id
      const input = c.req.valid('json')

      const maxOrderRows = await db
        .select({ maxOrder: max(round.displayOrder) })
        .from(round)
        .where(eq(round.competitionId, competitionId))
      const displayOrder = (maxOrderRows[0]?.maxOrder ?? -1) + 1

      const [created] = await db
        .insert(round)
        .values({
          competitionId,
          type: input.type,
          style: input.style,
          qualifyingCount: input.qualifyingCount ?? null,
          displayOrder,
        })
        .returning()
      if (!created) throw new ApiError(500, 'Erreur interne', 'Impossible de créer le tour.')
      return c.json(roundSchema.parse(created), 201)
    },
  )

  app.patch(
    '/:roundId',
    zValidator('json', updateRoundInputSchema, (result, c) => {
      if (!result.success)
        return problem(c, 400, 'Requête invalide', result.error.issues[0]?.message)
    }),
    async (c) => {
      const competitionId = c.get('competition').id
      const roundId = c.req.param('roundId')
      const input = c.req.valid('json')

      const existing = await db.query.round.findFirst({
        where: and(
          eq(round.id, roundId),
          eq(round.competitionId, competitionId),
          isNull(round.deletedAt),
        ),
      })
      if (!existing) throw new ApiError(404, 'Tour introuvable', "Ce tour n'existe pas.")

      const [updated] = await db
        .update(round)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(round.id, roundId))
        .returning()
      if (!updated)
        throw new ApiError(500, 'Erreur interne', 'Impossible de mettre à jour le tour.')
      return c.json(roundSchema.parse(updated))
    },
  )

  app.post(
    '/reorder',
    zValidator('json', reorderRoundsInputSchema, (result, c) => {
      if (!result.success)
        return problem(c, 400, 'Requête invalide', result.error.issues[0]?.message)
    }),
    async (c) => {
      const competitionId = c.get('competition').id
      const { orderedIds } = c.req.valid('json')

      const existing = await db.query.round.findMany({
        where: and(eq(round.competitionId, competitionId), isNull(round.deletedAt)),
      })
      const existingIds = new Set(existing.map((row) => row.id))
      if (orderedIds.length !== existingIds.size || orderedIds.some((id) => !existingIds.has(id))) {
        throw new ApiError(
          400,
          'Réordonnancement invalide',
          'La liste doit contenir exactement tous les tours actifs de la compétition.',
        )
      }

      await db.transaction(async (tx) => {
        for (const [index, id] of orderedIds.entries()) {
          await tx
            .update(round)
            .set({ displayOrder: -(index + 1) })
            .where(eq(round.id, id))
        }
        for (const [index, id] of orderedIds.entries()) {
          await tx.update(round).set({ displayOrder: index }).where(eq(round.id, id))
        }
      })

      const rows = await db.query.round.findMany({
        where: and(eq(round.competitionId, competitionId), isNull(round.deletedAt)),
        orderBy: [asc(round.displayOrder)],
      })
      return c.json(rows.map((row) => roundSchema.parse(row)))
    },
  )

  app.get('/:roundId/routes', async (c) => {
    const competitionId = c.get('competition').id
    const roundId = c.req.param('roundId')

    const existingRound = await db.query.round.findFirst({
      where: and(
        eq(round.id, roundId),
        eq(round.competitionId, competitionId),
        isNull(round.deletedAt),
      ),
    })
    if (!existingRound) throw new ApiError(404, 'Tour introuvable', "Ce tour n'existe pas.")

    const rows = await db.query.roundRoute.findMany({ where: eq(roundRoute.roundId, roundId) })
    return c.json(rows.map((row) => ({ routeId: row.routeId, categoryId: row.categoryId })))
  })

  app.put(
    '/:roundId/routes',
    zValidator('json', setRoundRoutesInputSchema, (result, c) => {
      if (!result.success)
        return problem(c, 400, 'Requête invalide', result.error.issues[0]?.message)
    }),
    async (c) => {
      const competitionId = c.get('competition').id
      const roundId = c.req.param('roundId')
      const { assignments } = c.req.valid('json')

      const existingRound = await db.query.round.findFirst({
        where: and(
          eq(round.id, roundId),
          eq(round.competitionId, competitionId),
          isNull(round.deletedAt),
        ),
      })
      if (!existingRound) throw new ApiError(404, 'Tour introuvable', "Ce tour n'existe pas.")

      for (const assignment of assignments) {
        const link = await db.query.routeCategory.findFirst({
          where: and(
            eq(routeCategory.routeId, assignment.routeId),
            eq(routeCategory.categoryId, assignment.categoryId),
          ),
        })
        if (!link) {
          throw new ApiError(
            400,
            'Affectation invalide',
            "Cette voie n'est pas affectée à cette catégorie — affectez-la d'abord depuis l'onglet Voies.",
          )
        }
      }

      await db.transaction(async (tx) => {
        await tx.delete(roundRoute).where(eq(roundRoute.roundId, roundId))
        if (assignments.length > 0) {
          await tx
            .insert(roundRoute)
            .values(
              assignments.map((a) => ({ roundId, routeId: a.routeId, categoryId: a.categoryId })),
            )
        }
      })

      const rows = await db.query.roundRoute.findMany({ where: eq(roundRoute.roundId, roundId) })
      return c.json(rows.map((row) => ({ routeId: row.routeId, categoryId: row.categoryId })))
    },
  )

  return app
}
