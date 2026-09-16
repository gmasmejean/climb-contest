import {
  competitorSchema,
  createCompetitorInputSchema,
  importCompetitorsInputSchema,
  updateCompetitorInputSchema,
} from '@climbcontest/contracts'
import { ascent, category, competitor, type Database } from '@climbcontest/db'
import { zValidator } from '@hono/zod-validator'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { Hono } from 'hono'

import { buildImportReport } from '../lib/competitor-import'
import type { AccessTokenSigner } from '../lib/jwt'
import { isUniqueViolation } from '../lib/pg-errors'
import { requireOrganizer } from '../middleware/auth'
import { requireCompetitionAccess } from '../middleware/competition-access'
import { ApiError, problem } from '../middleware/problem'

export interface CompetitorRouteDeps {
  db: Database
  accessTokenSigner: AccessTokenSigner
}

async function hasAscent(db: Database, competitorId: string): Promise<boolean> {
  const row = await db.query.ascent.findFirst({ where: eq(ascent.competitorId, competitorId) })
  return row !== undefined
}

async function requireOwnCategory(db: Database, competitionId: string, categoryId: string) {
  const row = await db.query.category.findFirst({
    where: and(
      eq(category.id, categoryId),
      eq(category.competitionId, competitionId),
      isNull(category.deletedAt),
    ),
  })
  if (!row) {
    throw new ApiError(
      400,
      'Catégorie invalide',
      "Cette catégorie n'appartient pas à cette compétition.",
    )
  }
  return row
}

export function createCompetitorRoutes(deps: CompetitorRouteDeps): Hono {
  const app = new Hono()
  const { db, accessTokenSigner } = deps

  app.use('*', requireOrganizer(accessTokenSigner), requireCompetitionAccess(db))

  app.get('/', async (c) => {
    const competitionId = c.get('competition').id
    const rows = await db.query.competitor.findMany({
      where: and(eq(competitor.competitionId, competitionId), isNull(competitor.deletedAt)),
    })
    return c.json(rows.map((row) => competitorSchema.parse(row)))
  })

  app.post(
    '/',
    zValidator('json', createCompetitorInputSchema, (result, c) => {
      if (!result.success)
        return problem(c, 400, 'Compétiteur invalide', result.error.issues[0]?.message)
    }),
    async (c) => {
      const competitionId = c.get('competition').id
      const input = c.req.valid('json')
      await requireOwnCategory(db, competitionId, input.categoryId)

      try {
        const [created] = await db
          .insert(competitor)
          .values({
            competitionId,
            categoryId: input.categoryId,
            bib: input.bib ?? null,
            firstName: input.firstName,
            lastName: input.lastName,
            birthYear: input.birthYear ?? null,
            clubName: input.clubName ?? null,
            licenseNumber: input.licenseNumber ?? null,
          })
          .returning()
        if (!created)
          throw new ApiError(500, 'Erreur interne', 'Impossible de créer le compétiteur.')
        return c.json(competitorSchema.parse(created), 201)
      } catch (error) {
        if (error instanceof ApiError) throw error
        if (isUniqueViolation(error)) {
          throw new ApiError(
            409,
            'Dossard déjà attribué',
            `Le dossard ${input.bib} est déjà utilisé.`,
          )
        }
        throw error
      }
    },
  )

  app.patch(
    '/:competitorId',
    zValidator('json', updateCompetitorInputSchema, (result, c) => {
      if (!result.success)
        return problem(c, 400, 'Requête invalide', result.error.issues[0]?.message)
    }),
    async (c) => {
      const competitionId = c.get('competition').id
      const competitorId = c.req.param('competitorId')
      const input = c.req.valid('json')

      const existing = await db.query.competitor.findFirst({
        where: and(
          eq(competitor.id, competitorId),
          eq(competitor.competitionId, competitionId),
          isNull(competitor.deletedAt),
        ),
      })
      if (!existing)
        throw new ApiError(404, 'Compétiteur introuvable', "Ce compétiteur n'existe pas.")

      if (input.categoryId !== undefined && input.categoryId !== existing.categoryId) {
        if (await hasAscent(db, competitorId)) {
          throw new ApiError(
            409,
            'Changement de catégorie impossible',
            'Ce compétiteur a déjà un passage enregistré — sa catégorie ne peut plus changer (ADR-005).',
          )
        }
        await requireOwnCategory(db, competitionId, input.categoryId)
      }

      try {
        const [updated] = await db
          .update(competitor)
          .set({ ...input, updatedAt: new Date() })
          .where(eq(competitor.id, competitorId))
          .returning()
        if (!updated)
          throw new ApiError(500, 'Erreur interne', 'Impossible de mettre à jour le compétiteur.')
        return c.json(competitorSchema.parse(updated))
      } catch (error) {
        if (error instanceof ApiError) throw error
        if (isUniqueViolation(error)) {
          throw new ApiError(
            409,
            'Dossard déjà attribué',
            input.bib
              ? `Le dossard ${input.bib} est déjà utilisé.`
              : 'Ce dossard est déjà utilisé.',
          )
        }
        throw error
      }
    },
  )

  app.delete('/:competitorId', async (c) => {
    const competitionId = c.get('competition').id
    const competitorId = c.req.param('competitorId')

    const existing = await db.query.competitor.findFirst({
      where: and(
        eq(competitor.id, competitorId),
        eq(competitor.competitionId, competitionId),
        isNull(competitor.deletedAt),
      ),
    })
    if (!existing)
      throw new ApiError(404, 'Compétiteur introuvable', "Ce compétiteur n'existe pas.")

    if (await hasAscent(db, competitorId)) {
      throw new ApiError(
        409,
        'Retrait impossible',
        'Ce compétiteur a déjà un passage enregistré — utilisez les statuts du pilotage jour J (Lot 8) plutôt que de le retirer.',
      )
    }

    await db
      .update(competitor)
      .set({ deletedAt: new Date() })
      .where(eq(competitor.id, competitorId))
    return c.body(null, 204)
  })

  /**
   * Le corps de réponse est le rapport structuré (`ImportReport`), pas un
   * `problem+json`, même sur un 422 : la liste d'erreurs ligne par ligne
   * exigée par ROADMAP.md ne rentre pas dans le couple title/detail du
   * format RFC 9457 utilisé ailleurs dans l'API. Écart assumé et isolé à
   * cette seule route.
   */
  app.post(
    '/import',
    zValidator('json', importCompetitorsInputSchema, (result, c) => {
      if (!result.success)
        return problem(c, 400, 'Requête invalide', result.error.issues[0]?.message)
    }),
    async (c) => {
      const competitionId = c.get('competition').id
      const { csv, mode } = c.req.valid('json')

      const { report, insertable } = await buildImportReport(db, competitionId, csv)

      if (mode === 'preview') {
        return c.json(report)
      }

      const canCommit = report.totalRows > 0 && report.validRows === report.totalRows
      if (!canCommit) {
        return c.json(report, 422)
      }

      try {
        await db.transaction(async (tx) => {
          await tx.insert(competitor).values(
            insertable.map((row) => ({
              competitionId,
              categoryId: row.categoryId,
              bib: row.bib,
              firstName: row.firstName,
              lastName: row.lastName,
              birthYear: row.birthYear,
              clubName: row.clubName,
              licenseNumber: row.licenseNumber,
            })),
          )
        })
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ApiError(
            409,
            "Conflit d'import",
            'Une donnée a changé depuis l’aperçu (dossard pris entre-temps) — relancez l’aperçu.',
          )
        }
        throw error
      }

      return c.json({ ...report, committed: true }, 201)
    },
  )

  app.post('/assign-bibs', async (c) => {
    const competitionId = c.get('competition').id

    const [categories, competitors] = await Promise.all([
      db.query.category.findMany({
        where: and(eq(category.competitionId, competitionId), isNull(category.deletedAt)),
        orderBy: [asc(category.displayOrder)],
      }),
      db.query.competitor.findMany({
        where: and(eq(competitor.competitionId, competitionId), isNull(competitor.deletedAt)),
      }),
    ])

    const categoryOrder = new Map(categories.map((row, index) => [row.id, index]))
    const usedBibs = new Set(competitors.flatMap((row) => (row.bib === null ? [] : [row.bib])))

    const sorted = [...competitors].sort((a, b) => {
      const orderDiff =
        (categoryOrder.get(a.categoryId) ?? 0) - (categoryOrder.get(b.categoryId) ?? 0)
      if (orderDiff !== 0) return orderDiff
      const lastNameDiff = a.lastName.localeCompare(b.lastName, 'fr')
      if (lastNameDiff !== 0) return lastNameDiff
      return a.firstName.localeCompare(b.firstName, 'fr')
    })

    let nextCandidate = 1
    const assignments: { id: string; bib: number }[] = []
    for (const row of sorted) {
      if (row.bib !== null) continue
      while (usedBibs.has(nextCandidate)) nextCandidate += 1
      usedBibs.add(nextCandidate)
      assignments.push({ id: row.id, bib: nextCandidate })
    }

    if (assignments.length > 0) {
      await db.transaction(async (tx) => {
        for (const assignment of assignments) {
          await tx
            .update(competitor)
            .set({ bib: assignment.bib, updatedAt: new Date() })
            .where(eq(competitor.id, assignment.id))
        }
      })
    }

    const rows = await db.query.competitor.findMany({
      where: and(eq(competitor.competitionId, competitionId), isNull(competitor.deletedAt)),
    })
    return c.json(rows.map((row) => competitorSchema.parse(row)))
  })

  return app
}
