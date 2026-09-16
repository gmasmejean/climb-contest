import {
  categorySchema,
  createCategoryInputSchema,
  reorderCategoriesInputSchema,
  updateCategoryInputSchema,
} from '@climbcontest/contracts'
import { category, competitor, type Database } from '@climbcontest/db'
import { zValidator } from '@hono/zod-validator'
import { and, asc, eq, isNull, max } from 'drizzle-orm'
import { Hono } from 'hono'

import { buildFfmeTemplateCategories } from '../lib/ffme-categories'
import type { AccessTokenSigner } from '../lib/jwt'
import { isUniqueViolation } from '../lib/pg-errors'
import { requireOrganizer } from '../middleware/auth'
import { requireCompetitionAccess } from '../middleware/competition-access'
import { ApiError, problem } from '../middleware/problem'

export interface CategoryRouteDeps {
  db: Database
  accessTokenSigner: AccessTokenSigner
}

export function createCategoryRoutes(deps: CategoryRouteDeps): Hono {
  const app = new Hono()
  const { db, accessTokenSigner } = deps

  app.use('*', requireOrganizer(accessTokenSigner), requireCompetitionAccess(db))

  app.get('/', async (c) => {
    const competitionId = c.get('competition').id
    const rows = await db.query.category.findMany({
      where: and(eq(category.competitionId, competitionId), isNull(category.deletedAt)),
      orderBy: [asc(category.displayOrder)],
    })
    return c.json(rows.map((row) => categorySchema.parse(row)))
  })

  app.post(
    '/',
    zValidator('json', createCategoryInputSchema, (result, c) => {
      if (!result.success)
        return problem(c, 400, 'Catégorie invalide', result.error.issues[0]?.message)
    }),
    async (c) => {
      const competitionId = c.get('competition').id
      const input = c.req.valid('json')

      const maxOrderRows = await db
        .select({ maxOrder: max(category.displayOrder) })
        .from(category)
        .where(eq(category.competitionId, competitionId))
      const displayOrder = (maxOrderRows[0]?.maxOrder ?? -1) + 1

      try {
        const [created] = await db
          .insert(category)
          .values({
            competitionId,
            label: input.label,
            sex: input.sex,
            birthYearMin: input.birthYearMin ?? null,
            birthYearMax: input.birthYearMax ?? null,
            displayOrder,
          })
          .returning()
        if (!created) throw new ApiError(500, 'Erreur interne', 'Impossible de créer la catégorie.')
        return c.json(categorySchema.parse(created), 201)
      } catch (error) {
        if (error instanceof ApiError) throw error
        if (isUniqueViolation(error)) {
          throw new ApiError(
            409,
            'Catégorie existante',
            `Une catégorie « ${input.label} » existe déjà pour cette compétition.`,
          )
        }
        throw error
      }
    },
  )

  app.post('/template', async (c) => {
    const currentCompetition = c.get('competition')
    const competitionId = currentCompetition.id

    const existing = await db.query.category.findMany({
      where: and(eq(category.competitionId, competitionId), isNull(category.deletedAt)),
    })
    const existingLabels = new Set(existing.map((row) => row.label))
    const maxOrder = existing.reduce((acc, row) => Math.max(acc, row.displayOrder), -1)

    const template = buildFfmeTemplateCategories(currentCompetition.startsOn).filter(
      (row) => !existingLabels.has(row.label),
    )
    if (template.length === 0) {
      return c.json([])
    }

    const created = await db
      .insert(category)
      .values(
        template.map((row, index) => ({
          competitionId,
          label: row.label,
          sex: row.sex,
          birthYearMin: row.birthYearMin,
          birthYearMax: row.birthYearMax,
          displayOrder: maxOrder + 1 + index,
        })),
      )
      .returning()

    return c.json(
      created.map((row) => categorySchema.parse(row)),
      201,
    )
  })

  app.patch(
    '/:categoryId',
    zValidator('json', updateCategoryInputSchema, (result, c) => {
      if (!result.success)
        return problem(c, 400, 'Requête invalide', result.error.issues[0]?.message)
    }),
    async (c) => {
      const competitionId = c.get('competition').id
      const categoryId = c.req.param('categoryId')
      const input = c.req.valid('json')

      const existing = await db.query.category.findFirst({
        where: and(
          eq(category.id, categoryId),
          eq(category.competitionId, competitionId),
          isNull(category.deletedAt),
        ),
      })
      if (!existing)
        throw new ApiError(404, 'Catégorie introuvable', "Cette catégorie n'existe pas.")

      const [updated] = await db
        .update(category)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(category.id, categoryId))
        .returning()
      if (!updated)
        throw new ApiError(500, 'Erreur interne', 'Impossible de mettre à jour la catégorie.')
      return c.json(categorySchema.parse(updated))
    },
  )

  app.delete('/:categoryId', async (c) => {
    const competitionId = c.get('competition').id
    const categoryId = c.req.param('categoryId')

    const existing = await db.query.category.findFirst({
      where: and(
        eq(category.id, categoryId),
        eq(category.competitionId, competitionId),
        isNull(category.deletedAt),
      ),
    })
    if (!existing) throw new ApiError(404, 'Catégorie introuvable', "Cette catégorie n'existe pas.")

    const attachedCompetitor = await db.query.competitor.findFirst({
      where: and(eq(competitor.categoryId, categoryId), isNull(competitor.deletedAt)),
    })
    if (attachedCompetitor) {
      throw new ApiError(
        409,
        'Catégorie utilisée',
        'Des compétiteurs sont rattachés à cette catégorie — retirez-les ou changez leur catégorie avant de la supprimer.',
      )
    }

    await db.update(category).set({ deletedAt: new Date() }).where(eq(category.id, categoryId))
    return c.body(null, 204)
  })

  app.post(
    '/reorder',
    zValidator('json', reorderCategoriesInputSchema, (result, c) => {
      if (!result.success)
        return problem(c, 400, 'Requête invalide', result.error.issues[0]?.message)
    }),
    async (c) => {
      const competitionId = c.get('competition').id
      const { orderedIds } = c.req.valid('json')

      const existing = await db.query.category.findMany({
        where: and(eq(category.competitionId, competitionId), isNull(category.deletedAt)),
      })
      const existingIds = new Set(existing.map((row) => row.id))
      if (orderedIds.length !== existingIds.size || orderedIds.some((id) => !existingIds.has(id))) {
        throw new ApiError(
          400,
          'Réordonnancement invalide',
          'La liste doit contenir exactement toutes les catégories actives de la compétition.',
        )
      }

      await db.transaction(async (tx) => {
        for (const [index, id] of orderedIds.entries()) {
          await tx.update(category).set({ displayOrder: index }).where(eq(category.id, id))
        }
      })

      const rows = await db.query.category.findMany({
        where: and(eq(category.competitionId, competitionId), isNull(category.deletedAt)),
        orderBy: [asc(category.displayOrder)],
      })
      return c.json(rows.map((row) => categorySchema.parse(row)))
    },
  )

  return app
}
