import {
  ascentSchema,
  correctLastAscentInputSchema,
  createAscentInputSchema,
  judgeRouteDetailSchema,
  judgeRoutesResponseSchema,
  type JudgeRouteDetail,
  type JudgeRoutesResponse,
} from '@climbcontest/contracts'
import {
  ascent,
  ascentEvent,
  category,
  competition,
  competitor,
  judgeRoute,
  round,
  roundRoute,
  route,
  routeCategory,
  type Database,
} from '@climbcontest/db'
import { zValidator } from '@hono/zod-validator'
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'
import { Hono } from 'hono'

import type { JudgeTokenSigner } from '../lib/jwt'
import { isUniqueViolation } from '../lib/pg-errors'
import { assertJudgeAssignedToRoute, resolveOpenRoundForRoute } from '../lib/judge-authorization'
import { requireJudge } from '../middleware/judge-auth'
import { ApiError, problem } from '../middleware/problem'
import { authRateLimiter } from '../middleware/rate-limit'

export interface JudgeAscentRouteDeps {
  db: Database
  judgeTokenSigner: JudgeTokenSigner
  /** Seam de test — ADR-007, jamais autre chose que `() => new Date()` en production. */
  now?: (() => Date) | undefined
}

/** ADR-007 : fenêtre de correction du juge — 5 minutes après la saisie initiale. */
const CORRECTION_WINDOW_MS = 5 * 60 * 1000

const EXPECTED_COMPETITOR_STATUSES = ['registered', 'present'] as const

type CompetitorRow = typeof competitor.$inferSelect
type AscentRow = typeof ascent.$inferSelect

async function categoryLabelsByRoute(
  db: Database,
  routeIds: string[],
): Promise<Map<string, { id: string; label: string }[]>> {
  if (routeIds.length === 0) return new Map()
  const links = await db
    .select({ routeId: routeCategory.routeId, id: category.id, label: category.label })
    .from(routeCategory)
    .innerJoin(category, eq(category.id, routeCategory.categoryId))
    .where(inArray(routeCategory.routeId, routeIds))
  const map = new Map<string, { id: string; label: string }[]>()
  for (const link of links) {
    const list = map.get(link.routeId) ?? []
    list.push({ id: link.id, label: link.label })
    map.set(link.routeId, list)
  }
  return map
}

async function expectedCompetitors(
  db: Database,
  competitionId: string,
  categoryIds: string[],
): Promise<CompetitorRow[]> {
  if (categoryIds.length === 0) return []
  return db.query.competitor.findMany({
    where: and(
      eq(competitor.competitionId, competitionId),
      inArray(competitor.categoryId, categoryIds),
      inArray(competitor.status, [...EXPECTED_COMPETITOR_STATUSES]),
      isNull(competitor.deletedAt),
    ),
  })
}

async function activeAscentsFor(
  db: Database,
  roundId: string,
  routeId: string,
  competitorIds: string[],
): Promise<Map<string, AscentRow>> {
  if (competitorIds.length === 0) return new Map()
  const rows = await db.query.ascent.findMany({
    where: and(
      eq(ascent.roundId, roundId),
      eq(ascent.routeId, routeId),
      inArray(ascent.competitorId, competitorIds),
      isNull(ascent.supersededBy),
      isNull(ascent.conflictGroup),
    ),
  })
  return new Map(rows.map((row) => [row.competitorId, row]))
}

/**
 * La dernière saisie active du juge, tous compétiteurs et voies confondus —
 * ADR-007 : la fenêtre de correction porte sur « la saisie suivante,
 * n'importe quel compétiteur », donc un scope global au juge, pas à une voie.
 */
async function lastActiveAscentForJudge(db: Database, judgeId: string): Promise<AscentRow | null> {
  const rows = await db.query.ascent.findMany({
    where: and(eq(ascent.recordedByJudgeId, judgeId), isNull(ascent.supersededBy)),
    orderBy: [desc(ascent.recordedAt), desc(ascent.createdAt)],
    limit: 1,
  })
  return rows[0] ?? null
}

export function createJudgeAscentRoutes(deps: JudgeAscentRouteDeps): Hono {
  const app = new Hono()
  const { db, judgeTokenSigner } = deps
  const now = deps.now ?? (() => new Date())

  app.use('*', requireJudge(judgeTokenSigner, db))

  app.get('/routes', async (c) => {
    const currentJudge = c.get('judge')

    const assignedRoutes = await db
      .select({ id: route.id, number: route.number, name: route.name, holdCount: route.holdCount })
      .from(judgeRoute)
      .innerJoin(route, eq(judgeRoute.routeId, route.id))
      .where(and(eq(judgeRoute.judgeId, currentJudge.id), isNull(route.deletedAt)))
      .orderBy(asc(route.number))

    const categoriesByRoute = await categoryLabelsByRoute(
      db,
      assignedRoutes.map((r) => r.id),
    )

    const response: JudgeRoutesResponse = []
    for (const r of assignedRoutes) {
      const openRound = await resolveOpenRoundForRoute(db, currentJudge.competitionId, r.id)
      let progress: { done: number; expected: number } | null = null
      if (openRound) {
        const expected = await expectedCompetitors(
          db,
          currentJudge.competitionId,
          openRound.categoryIds,
        )
        const active = await activeAscentsFor(
          db,
          openRound.roundId,
          r.id,
          expected.map((e) => e.id),
        )
        progress = { done: active.size, expected: expected.length }
      }
      response.push({
        id: r.id,
        number: r.number,
        name: r.name,
        holdCount: r.holdCount,
        categories: categoriesByRoute.get(r.id) ?? [],
        progress,
      })
    }

    return c.json(judgeRoutesResponseSchema.parse(response))
  })

  app.get('/routes/:routeId', async (c) => {
    const currentJudge = c.get('judge')
    const routeId = c.req.param('routeId')
    const routeRow = await assertJudgeAssignedToRoute(db, currentJudge, routeId)

    const currentCompetition = await db.query.competition.findFirst({
      where: eq(competition.id, currentJudge.competitionId),
    })
    if (!currentCompetition) {
      throw new ApiError(404, 'Compétition introuvable', "Cette compétition n'existe plus.")
    }

    const openRound = await resolveOpenRoundForRoute(db, currentJudge.competitionId, routeId)
    const routeSummary = {
      id: routeRow.id,
      number: routeRow.number,
      name: routeRow.name,
      holdCount: routeRow.holdCount,
    }
    if (!openRound) {
      const response: JudgeRouteDetail = {
        route: routeSummary,
        round: null,
        timingEnabled: currentCompetition.timingEnabled,
        competitors: [],
      }
      return c.json(judgeRouteDetailSchema.parse(response))
    }

    const categoryLabels = new Map(
      (
        await db.query.category.findMany({
          where: inArray(category.id, openRound.categoryIds),
        })
      ).map((cat) => [cat.id, cat.label]),
    )
    const competitors = await expectedCompetitors(
      db,
      currentJudge.competitionId,
      openRound.categoryIds,
    )
    const ascentsByCompetitor = await activeAscentsFor(
      db,
      openRound.roundId,
      routeId,
      competitors.map((comp) => comp.id),
    )

    const rawResponse = {
      route: routeSummary,
      round: { id: openRound.roundId, type: openRound.roundType },
      timingEnabled: currentCompetition.timingEnabled,
      competitors: competitors.map((comp) => {
        const existing = ascentsByCompetitor.get(comp.id)
        return {
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
        }
      }),
    }
    return c.json(judgeRouteDetailSchema.parse(rawResponse))
  })

  app.get('/ascents/last', async (c) => {
    const currentJudge = c.get('judge')
    const last = await lastActiveAscentForJudge(db, currentJudge.id)
    if (!last) return c.json(null)

    const correctableUntil = new Date(last.recordedAt.getTime() + CORRECTION_WINDOW_MS)
    if (now().getTime() >= correctableUntil.getTime()) return c.json(null)

    return c.json({
      ascent: ascentSchema.parse(last),
      correctableUntil: correctableUntil.toISOString(),
    })
  })

  const ascentWriteRateLimiter = authRateLimiter(120, 60 * 1000)

  app.post(
    '/ascents',
    ascentWriteRateLimiter,
    zValidator('json', createAscentInputSchema, (result, c) => {
      if (!result.success)
        return problem(c, 400, 'Passage invalide', result.error.issues[0]?.message)
    }),
    async (c) => {
      const currentJudge = c.get('judge')
      const input = c.req.valid('json')

      const routeRow = await assertJudgeAssignedToRoute(db, currentJudge, input.routeId)

      if (input.status === 'valid' && !input.isTop) {
        if (input.holdNumber === null || input.holdNumber > routeRow.holdCount) {
          throw new ApiError(
            400,
            'Prise invalide',
            `Le numéro de prise doit être compris entre 1 et ${routeRow.holdCount}.`,
          )
        }
      }

      const existing = await db.query.ascent.findFirst({ where: eq(ascent.id, input.id) })
      if (existing) {
        // Un rejeu sûr (retry après coupure, décision confirmée pour ce
        // lot) doit porter EXACTEMENT le même contenu, pas seulement le même
        // triplet (tour, voie, compétiteur) — sinon une saisie corrigée par
        // erreur sous le même id serait acceptée silencieusement au lieu
        // d'être signalée.
        const matches =
          existing.roundId === input.roundId &&
          existing.routeId === input.routeId &&
          existing.competitorId === input.competitorId &&
          existing.holdNumber === input.holdNumber &&
          existing.modifier === input.modifier &&
          existing.isTop === input.isTop &&
          existing.status === input.status &&
          existing.climbTimeMs === (input.climbTimeMs ?? null)
        if (!matches) {
          throw new ApiError(
            409,
            'Identifiant déjà utilisé',
            'Cet identifiant de passage est déjà utilisé pour un autre passage.',
          )
        }
        return c.json(ascentSchema.parse(existing), 200)
      }

      const competitorRow = await db.query.competitor.findFirst({
        where: and(
          eq(competitor.id, input.competitorId),
          eq(competitor.competitionId, currentJudge.competitionId),
          isNull(competitor.deletedAt),
        ),
      })
      if (!competitorRow) {
        throw new ApiError(404, 'Compétiteur introuvable', "Ce compétiteur n'existe pas.")
      }

      const liveTriple = await db.query.roundRoute.findFirst({
        where: and(
          eq(roundRoute.roundId, input.roundId),
          eq(roundRoute.routeId, input.routeId),
          eq(roundRoute.categoryId, competitorRow.categoryId),
        ),
      })
      const openRoundRow = liveTriple
        ? await db.query.round.findFirst({
            where: and(
              eq(round.id, input.roundId),
              eq(round.competitionId, currentJudge.competitionId),
              eq(round.status, 'open'),
              isNull(round.deletedAt),
            ),
          })
        : null
      if (!liveTriple || !openRoundRow) {
        throw new ApiError(404, 'Tour introuvable', "Ce tour n'est pas ouvert pour cette voie.")
      }

      try {
        const created = await db.transaction(async (tx) => {
          const [row] = await tx
            .insert(ascent)
            .values({
              id: input.id,
              competitionId: currentJudge.competitionId,
              roundId: input.roundId,
              routeId: input.routeId,
              competitorId: input.competitorId,
              holdNumber: input.holdNumber,
              holdCount: routeRow.holdCount,
              modifier: input.modifier,
              isTop: input.isTop,
              status: input.status,
              climbTimeMs: input.climbTimeMs ?? null,
              recordedByJudgeId: currentJudge.id,
              recordedByUserId: null,
              recordedAt: new Date(input.recordedAt),
              deviceId: input.deviceId,
            })
            .returning()
          if (!row)
            throw new ApiError(500, 'Erreur interne', 'Impossible d’enregistrer le passage.')

          await tx.insert(ascentEvent).values({
            ascentId: row.id,
            eventType: 'created',
            actorType: 'judge',
            actorId: currentJudge.id,
            payload: {
              holdNumber: row.holdNumber,
              modifier: row.modifier,
              isTop: row.isTop,
              status: row.status,
              climbTimeMs: row.climbTimeMs,
            },
          })

          return row
        })
        return c.json(ascentSchema.parse(created), 201)
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ApiError(
            409,
            'Passage déjà enregistré',
            'Ce compétiteur a déjà un passage enregistré sur cette voie pour ce tour — utilisez la correction.',
          )
        }
        throw error
      }
    },
  )

  app.post(
    '/ascents/last/correct',
    ascentWriteRateLimiter,
    zValidator('json', correctLastAscentInputSchema, (result, c) => {
      if (!result.success)
        return problem(c, 400, 'Correction invalide', result.error.issues[0]?.message)
    }),
    async (c) => {
      const currentJudge = c.get('judge')
      const input = c.req.valid('json')

      const last = await lastActiveAscentForJudge(db, currentJudge.id)
      if (!last) {
        throw new ApiError(404, 'Aucune saisie à corriger', "Vous n'avez encore rien saisi.")
      }

      const deadline = last.recordedAt.getTime() + CORRECTION_WINDOW_MS
      if (now().getTime() >= deadline) {
        throw new ApiError(
          409,
          'Trop tard pour corriger',
          'Trop tard pour corriger — contactez l’organisateur.',
        )
      }

      if (input.status === 'valid' && !input.isTop) {
        if (input.holdNumber === null || input.holdNumber > last.holdCount) {
          throw new ApiError(
            400,
            'Prise invalide',
            `Le numéro de prise doit être compris entre 1 et ${last.holdCount}.`,
          )
        }
      }

      const created = await db.transaction(async (tx) => {
        // Ordre obligatoire : l'ancienne ligne doit sortir de l'index unique
        // actif (ADR-002 : `WHERE superseded_by IS NULL …`, jamais
        // différable — c'est un index partiel, pas une contrainte) AVANT que
        // la nouvelle n'y entre. Ça ne marche que parce que la contrainte de
        // clé étrangère `ascent_superseded_by_ascent_id_fk` a été rendue
        // `DEFERRABLE INITIALLY DEFERRED` (migration
        // `0004_ascent_superseded_by_deferrable`) : sans ça, cet `UPDATE`
        // échouerait immédiatement en référençant `input.id`, qui n'existe
        // pas encore. Elle n'est vérifiée qu'au COMMIT, une fois l'`INSERT`
        // ci-dessous passé.
        await tx
          .update(ascent)
          .set({ supersededBy: input.id, updatedAt: new Date() })
          .where(eq(ascent.id, last.id))

        const [row] = await tx
          .insert(ascent)
          .values({
            id: input.id,
            competitionId: last.competitionId,
            roundId: last.roundId,
            routeId: last.routeId,
            competitorId: last.competitorId,
            holdNumber: input.holdNumber,
            holdCount: last.holdCount,
            modifier: input.modifier,
            isTop: input.isTop,
            status: input.status,
            climbTimeMs: input.climbTimeMs ?? null,
            recordedByJudgeId: currentJudge.id,
            recordedByUserId: null,
            // Une correction rectifie une saisie déjà survenue : l'heure de
            // l'événement ne change pas, seule sa valeur est rectifiée.
            recordedAt: last.recordedAt,
            deviceId: last.deviceId,
          })
          .returning()
        if (!row)
          throw new ApiError(500, 'Erreur interne', 'Impossible d’enregistrer la correction.')

        await tx.insert(ascentEvent).values([
          {
            ascentId: last.id,
            eventType: 'corrected',
            actorType: 'judge',
            actorId: currentJudge.id,
            payload: {
              correctedInto: row.id,
              previous: {
                holdNumber: last.holdNumber,
                modifier: last.modifier,
                isTop: last.isTop,
                status: last.status,
                climbTimeMs: last.climbTimeMs,
              },
              next: {
                holdNumber: row.holdNumber,
                modifier: row.modifier,
                isTop: row.isTop,
                status: row.status,
                climbTimeMs: row.climbTimeMs,
              },
            },
          },
          {
            ascentId: row.id,
            eventType: 'created',
            actorType: 'judge',
            actorId: currentJudge.id,
            payload: {
              correctedFrom: last.id,
              holdNumber: row.holdNumber,
              modifier: row.modifier,
              isTop: row.isTop,
              status: row.status,
              climbTimeMs: row.climbTimeMs,
            },
          },
        ])

        return row
      })

      return c.json(ascentSchema.parse(created), 201)
    },
  )

  return app
}
