import {
  createRouteInputSchema,
  reorderRoutesInputSchema,
  routeSchema,
  updateRouteInputSchema,
} from '@climbcontest/contracts'
import { ascent, category, route, routeCategory, type Database } from '@climbcontest/db'
import { zValidator } from '@hono/zod-validator'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { Hono } from 'hono'

import { addContestRoundRoute, removeContestRoundRoute } from '../lib/contest-round'
import type { AccessTokenSigner } from '../lib/jwt'
import { isUniqueViolation } from '../lib/pg-errors'
import { requireOrganizer } from '../middleware/auth'
import { requireCompetitionAccess } from '../middleware/competition-access'
import { ApiError, problem } from '../middleware/problem'

export interface RouteRouteDeps {
  db: Database
  accessTokenSigner: AccessTokenSigner
}

async function categoryIdsByRoute(
  db: Database,
  routeIds: string[],
): Promise<Map<string, string[]>> {
  if (routeIds.length === 0) return new Map()
  const links = await db.query.routeCategory.findMany({
    where: inArray(routeCategory.routeId, routeIds),
  })
  const map = new Map<string, string[]>()
  for (const link of links) {
    const list = map.get(link.routeId) ?? []
    list.push(link.categoryId)
    map.set(link.routeId, list)
  }
  return map
}

async function assertOwnCategories(db: Database, competitionId: string, categoryIds: string[]) {
  if (categoryIds.length === 0) return
  const rows = await db.query.category.findMany({
    where: and(
      inArray(category.id, categoryIds),
      eq(category.competitionId, competitionId),
      isNull(category.deletedAt),
    ),
  })
  if (rows.length !== new Set(categoryIds).size) {
    throw new ApiError(
      400,
      'Catégorie invalide',
      "Une des catégories affectées n'appartient pas à cette compétition.",
    )
  }
}

export function createRouteRoutes(deps: RouteRouteDeps): Hono {
  const app = new Hono()
  const { db, accessTokenSigner } = deps

  app.use('*', requireOrganizer(accessTokenSigner), requireCompetitionAccess(db))

  app.get('/', async (c) => {
    const competitionId = c.get('competition').id
    const rows = await db.query.route.findMany({
      where: and(eq(route.competitionId, competitionId), isNull(route.deletedAt)),
      orderBy: [asc(route.number)],
    })
    const categoryIds = await categoryIdsByRoute(
      db,
      rows.map((row) => row.id),
    )
    return c.json(
      rows.map((row) => ({
        ...routeSchema.parse(row),
        categoryIds: categoryIds.get(row.id) ?? [],
      })),
    )
  })

  app.post(
    '/',
    zValidator('json', createRouteInputSchema, (result, c) => {
      if (!result.success) return problem(c, 400, 'Voie invalide', result.error.issues[0]?.message)
    }),
    async (c) => {
      const currentCompetition = c.get('competition')
      const input = c.req.valid('json')
      await assertOwnCategories(db, currentCompetition.id, input.categoryIds)

      try {
        const created = await db.transaction(async (tx) => {
          const [row] = await tx
            .insert(route)
            .values({
              competitionId: currentCompetition.id,
              number: input.number,
              name: input.name ?? null,
              holdCount: input.holdCount,
              sector: input.sector ?? null,
              color: input.color ?? null,
              videoUrl: input.videoUrl ?? null,
              notes: input.notes ?? null,
            })
            .returning()
          if (!row) throw new ApiError(500, 'Erreur interne', 'Impossible de créer la voie.')

          if (input.categoryIds.length > 0) {
            await tx
              .insert(routeCategory)
              .values(input.categoryIds.map((categoryId) => ({ routeId: row.id, categoryId })))
            if (currentCompetition.format === 'contest') {
              for (const categoryId of input.categoryIds) {
                await addContestRoundRoute(tx, currentCompetition.id, row.id, categoryId)
              }
            }
          }

          return row
        })
        return c.json({ ...routeSchema.parse(created), categoryIds: input.categoryIds }, 201)
      } catch (error) {
        if (error instanceof ApiError) throw error
        if (isUniqueViolation(error)) {
          throw new ApiError(
            409,
            'Numéro de voie déjà utilisé',
            `La voie n°${input.number} existe déjà.`,
          )
        }
        throw error
      }
    },
  )

  app.patch(
    '/:routeId',
    zValidator('json', updateRouteInputSchema, (result, c) => {
      if (!result.success)
        return problem(c, 400, 'Requête invalide', result.error.issues[0]?.message)
    }),
    async (c) => {
      const currentCompetition = c.get('competition')
      const routeId = c.req.param('routeId')
      const input = c.req.valid('json')

      const existing = await db.query.route.findFirst({
        where: and(
          eq(route.id, routeId),
          eq(route.competitionId, currentCompetition.id),
          isNull(route.deletedAt),
        ),
      })
      if (!existing) throw new ApiError(404, 'Voie introuvable', "Cette voie n'existe pas.")

      if (input.holdCount !== undefined && input.holdCount !== existing.holdCount) {
        const existingAscent = await db.query.ascent.findFirst({
          where: eq(ascent.routeId, routeId),
        })
        if (existingAscent) {
          throw new ApiError(
            409,
            'Modification impossible',
            'Un passage existe déjà sur cette voie — son nombre de prises ne peut plus changer (ADR-004).',
          )
        }
      }

      if (input.categoryIds !== undefined) {
        await assertOwnCategories(db, currentCompetition.id, input.categoryIds)
      }

      try {
        const updated = await db.transaction(async (tx) => {
          const { categoryIds, ...fields } = input
          const [row] =
            Object.keys(fields).length > 0
              ? await tx
                  .update(route)
                  .set({ ...fields, updatedAt: new Date() })
                  .where(eq(route.id, routeId))
                  .returning()
              : [existing]

          if (categoryIds !== undefined) {
            const currentLinks = await tx.query.routeCategory.findMany({
              where: eq(routeCategory.routeId, routeId),
            })
            const currentIds = new Set(currentLinks.map((link) => link.categoryId))
            const nextIds = new Set(categoryIds)
            const toAdd = categoryIds.filter((id) => !currentIds.has(id))
            const toRemove = [...currentIds].filter((id) => !nextIds.has(id))

            if (toAdd.length > 0) {
              await tx
                .insert(routeCategory)
                .values(toAdd.map((categoryId) => ({ routeId, categoryId })))
            }
            for (const categoryId of toRemove) {
              await tx
                .delete(routeCategory)
                .where(
                  and(eq(routeCategory.routeId, routeId), eq(routeCategory.categoryId, categoryId)),
                )
            }
            if (currentCompetition.format === 'contest') {
              for (const categoryId of toAdd)
                await addContestRoundRoute(tx, currentCompetition.id, routeId, categoryId)
              for (const categoryId of toRemove)
                await removeContestRoundRoute(tx, currentCompetition.id, routeId, categoryId)
            }
          }

          return row
        })
        if (!updated)
          throw new ApiError(500, 'Erreur interne', 'Impossible de mettre à jour la voie.')

        const categoryIds = await categoryIdsByRoute(db, [routeId])
        return c.json({
          ...routeSchema.parse(updated),
          categoryIds: categoryIds.get(routeId) ?? [],
        })
      } catch (error) {
        if (error instanceof ApiError) throw error
        if (isUniqueViolation(error)) {
          throw new ApiError(
            409,
            'Numéro de voie déjà utilisé',
            `La voie n°${input.number} existe déjà.`,
          )
        }
        throw error
      }
    },
  )

  app.post(
    '/reorder',
    zValidator('json', reorderRoutesInputSchema, (result, c) => {
      if (!result.success)
        return problem(c, 400, 'Requête invalide', result.error.issues[0]?.message)
    }),
    async (c) => {
      const competitionId = c.get('competition').id
      const { orderedIds } = c.req.valid('json')

      const existing = await db.query.route.findMany({
        where: and(eq(route.competitionId, competitionId), isNull(route.deletedAt)),
      })
      const existingIds = new Set(existing.map((row) => row.id))
      if (orderedIds.length !== existingIds.size || orderedIds.some((id) => !existingIds.has(id))) {
        throw new ApiError(
          400,
          'Réordonnancement invalide',
          'La liste doit contenir exactement toutes les voies actives de la compétition.',
        )
      }

      // Deux passes pour éviter le conflit transitoire avec l'index unique
      // (competition_id, number) : on décale d'abord tout hors de la plage
      // finale, puis on pose les numéros définitifs.
      await db.transaction(async (tx) => {
        for (const [index, id] of orderedIds.entries()) {
          await tx
            .update(route)
            .set({ number: -(index + 1) })
            .where(eq(route.id, id))
        }
        for (const [index, id] of orderedIds.entries()) {
          await tx
            .update(route)
            .set({ number: index + 1 })
            .where(eq(route.id, id))
        }
      })

      const rows = await db.query.route.findMany({
        where: and(eq(route.competitionId, competitionId), isNull(route.deletedAt)),
        orderBy: [asc(route.number)],
      })
      const categoryIds = await categoryIdsByRoute(
        db,
        rows.map((row) => row.id),
      )
      return c.json(
        rows.map((row) => ({
          ...routeSchema.parse(row),
          categoryIds: categoryIds.get(row.id) ?? [],
        })),
      )
    },
  )

  return app
}
