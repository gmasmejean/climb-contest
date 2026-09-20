import {
  ascentSchema,
  correctLastAscentInputSchema,
  createAscentInputSchema,
  judgeAscentsBatchInputSchema,
  judgeAscentsBatchResponseSchema,
  judgeBootstrapResponseSchema,
  judgeRouteDetailSchema,
  judgeRoutesResponseSchema,
  type JudgeAscentBatchItemInput,
  type JudgeAscentBatchResult,
  type JudgeBootstrapResponse,
  type JudgeRouteDetail,
  type JudgeRoutesResponse,
} from '@climbcontest/contracts'
import {
  ascent,
  ascentEvent,
  category,
  competition,
  competitor,
  judge,
  judgeRoute,
  roundRoute,
  route,
  type Database,
} from '@climbcontest/db'
import { zValidator } from '@hono/zod-validator'
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'
import { Hono } from 'hono'

import { createAscentOrConflict, type AscentWriteResult } from '../lib/ascent-write'
import {
  activeAscentsFor,
  categoryLabelsByRoute,
  expectedCompetitors,
} from '../lib/ascent-progress'
import { supersedeToNewAscent } from '../lib/ascent-correction'
import type { JudgeTokenSigner } from '../lib/jwt'
import { assertJudgeAssignedToRoute, resolveOpenRoundForRoute } from '../lib/judge-authorization'
import { notifyPublic } from '../lib/notify-public'
import { isUniqueViolation } from '../lib/pg-errors'
import { requireJudge } from '../middleware/judge-auth'
import { findRoundOpenForCategory } from '../lib/round-category'
import { assertCompetitorQualifiedForRound } from '../lib/round-qualifiers'
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

type AscentRow = typeof ascent.$inferSelect
type JudgeRow = typeof judge.$inferSelect
type CompetitionRow = typeof competition.$inferSelect
type RouteRow = typeof route.$inferSelect

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

/**
 * Le détail d'une voie pour le juge (compétiteurs concernés, passage actif de
 * chacun) — extrait pour être réutilisé par `GET /routes/:routeId` (Lot 5) et
 * `GET /bootstrap` (Lot 6, SPEC.md § 6.3), qui boucle sur toutes les voies
 * assignées au lieu d'une seule.
 */
async function buildRouteDetail(
  db: Database,
  currentJudge: JudgeRow,
  routeRow: RouteRow,
  currentCompetition: CompetitionRow,
): Promise<JudgeRouteDetail> {
  const openRound = await resolveOpenRoundForRoute(db, currentJudge.competitionId, routeRow.id)
  const routeCategories = (await categoryLabelsByRoute(db, [routeRow.id])).get(routeRow.id) ?? []
  const routeSummary = {
    id: routeRow.id,
    number: routeRow.number,
    name: routeRow.name,
    holdCount: routeRow.holdCount,
    categories: routeCategories,
  }
  if (!openRound) {
    return judgeRouteDetailSchema.parse({
      route: routeSummary,
      round: null,
      timingEnabled: currentCompetition.timingEnabled,
      competitors: [],
    })
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
    openRound.roundId,
  )
  const ascentsByCompetitor = await activeAscentsFor(
    db,
    openRound.roundId,
    routeRow.id,
    competitors.map((comp) => comp.id),
  )

  return judgeRouteDetailSchema.parse({
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
  })
}

function toBatchResult(id: string, result: AscentWriteResult): JudgeAscentBatchResult {
  if (result.status === 'conflict') {
    return {
      id,
      status: 'conflict',
      conflictGroup: result.conflictGroup,
      existing: ascentSchema.parse(result.existing),
      incoming: ascentSchema.parse(result.incoming),
    }
  }
  return { id, status: result.status, ascent: ascentSchema.parse(result.ascent) }
}

interface CorrectContentShape {
  holdNumber: number | null
  modifier: 'none' | 'plus'
  isTop: boolean
  status: 'valid' | 'dns' | 'dnf'
  climbTimeMs?: number | null | undefined
}

function matchesCorrectContent(row: AscentRow, item: CorrectContentShape): boolean {
  return (
    row.holdNumber === item.holdNumber &&
    row.modifier === item.modifier &&
    row.isTop === item.isTop &&
    row.status === item.status &&
    row.climbTimeMs === (item.climbTimeMs ?? null)
  )
}

/** Motif français lisible pour un item `rejected` — jamais un message technique brut. */
function rejectionReasonFor(error: unknown): string {
  if (error instanceof ApiError) return error.detail ?? error.title
  return 'Erreur inattendue lors du traitement de ce passage — contactez l’organisateur.'
}

type CreateBatchItem = Extract<JudgeAscentBatchItemInput, { kind: 'create' }>
type CorrectBatchItem = Extract<JudgeAscentBatchItemInput, { kind: 'correct' }>

/**
 * Traite un item `create` de `POST /ascents/batch` (Lot 6, SPEC.md § 6.3).
 * Chaque item est traité dans sa PROPRE transaction — jamais un tout-ou-rien
 * de lot. La détection de conflit et la retenue sur violation d'unicité
 * vivent dans `lib/ascent-write.ts` (Lot 8 : partagées avec la saisie de
 * secours organisateur).
 */
async function processCreateItem(
  db: Database,
  currentJudge: JudgeRow,
  item: CreateBatchItem,
): Promise<JudgeAscentBatchResult> {
  const routeRow = await assertJudgeAssignedToRoute(db, currentJudge, item.routeId)
  const result = await createAscentOrConflict(
    db,
    { kind: 'judge', judgeId: currentJudge.id },
    item,
    routeRow,
    currentJudge.competitionId,
  )
  return toBatchResult(item.id, result)
}

/**
 * Traite un item `correct` de `POST /ascents/batch`. Contrairement à
 * `POST /ascents/last/correct` (Lot 5), la cible est le `supersedesId`
 * EXPLICITE fourni par le client — jamais une résolution serveur de « la
 * dernière saisie active » (DECISIONS.md ADR-032). La règle des 5 minutes
 * (ADR-007) reste la seule revérifiée côté serveur en mode lot ; le second
 * volet (« ou jusqu'à la saisie suivante ») n'est plus vérifiable de façon
 * fiable ici (l'ordre réseau ne reflète pas l'ordre de saisie) et reste géré
 * côté client avant de proposer l'écran de correction au juge.
 */
async function processCorrectItem(
  db: Database,
  currentJudge: JudgeRow,
  item: CorrectBatchItem,
  now: () => Date,
): Promise<JudgeAscentBatchResult> {
  const existingSuccessor = await db.query.ascent.findFirst({ where: eq(ascent.id, item.id) })
  if (existingSuccessor) {
    if (matchesCorrectContent(existingSuccessor, item)) {
      return { id: item.id, status: 'duplicate', ascent: ascentSchema.parse(existingSuccessor) }
    }
    throw new ApiError(
      409,
      'Identifiant déjà utilisé',
      'Cet identifiant de passage est déjà utilisé pour un autre passage.',
    )
  }

  const target = await db.query.ascent.findFirst({
    where: and(
      eq(ascent.id, item.supersedesId),
      eq(ascent.competitionId, currentJudge.competitionId),
      isNull(ascent.supersededBy),
    ),
  })
  if (!target) {
    throw new ApiError(
      404,
      'Passage introuvable',
      "Le passage à corriger n'existe pas ou a déjà été corrigé.",
    )
  }
  if (target.recordedByJudgeId !== currentJudge.id) {
    throw new ApiError(
      403,
      'Correction refusée',
      'Vous ne pouvez corriger que vos propres saisies.',
    )
  }
  if (target.conflictGroup !== null) {
    throw new ApiError(
      409,
      'Correction refusée',
      'Ce passage est en conflit — seul l’organisateur peut le corriger.',
    )
  }

  const deadline = target.recordedAt.getTime() + CORRECTION_WINDOW_MS
  if (now().getTime() >= deadline) {
    throw new ApiError(
      409,
      'Trop tard pour corriger',
      'Trop tard pour corriger — contactez l’organisateur.',
    )
  }

  if (item.status === 'valid' && !item.isTop) {
    if (item.holdNumber === null || item.holdNumber > target.holdCount) {
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
    newId: item.id,
    content: {
      holdNumber: item.holdNumber,
      modifier: item.modifier,
      isTop: item.isTop,
      status: item.status,
      climbTimeMs: item.climbTimeMs,
    },
    actor: { kind: 'judge', judgeId: currentJudge.id },
    categoryId: targetCompetitor.categoryId,
    eventType: 'corrected',
    reason: null,
  })

  return { id: item.id, status: 'accepted', ascent: ascentSchema.parse(created) }
}

export function createJudgeAscentRoutes(deps: JudgeAscentRouteDeps): Hono {
  const app = new Hono()
  const { db, judgeTokenSigner } = deps
  const now = deps.now ?? (() => new Date())

  app.use('*', requireJudge(judgeTokenSigner, db, now))

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
          openRound.roundId,
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

    const detail = await buildRouteDetail(db, currentJudge, routeRow, currentCompetition)
    return c.json(judgeRouteDetailSchema.parse(detail))
  })

  app.get('/bootstrap', async (c) => {
    const currentJudge = c.get('judge')

    const currentCompetition = await db.query.competition.findFirst({
      where: eq(competition.id, currentJudge.competitionId),
    })
    if (!currentCompetition) {
      throw new ApiError(404, 'Compétition introuvable', "Cette compétition n'existe plus.")
    }

    const assignments = await db.query.judgeRoute.findMany({
      where: eq(judgeRoute.judgeId, currentJudge.id),
    })
    const assignedRouteIds = assignments.map((assignment) => assignment.routeId)
    const assignedRoutes =
      assignedRouteIds.length === 0
        ? []
        : await db.query.route.findMany({
            where: and(inArray(route.id, assignedRouteIds), isNull(route.deletedAt)),
            orderBy: [asc(route.number)],
          })

    const routes: JudgeRouteDetail[] = []
    for (const routeRow of assignedRoutes) {
      routes.push(await buildRouteDetail(db, currentJudge, routeRow, currentCompetition))
    }

    const response: JudgeBootstrapResponse = {
      fetchedAt: now().toISOString(),
      judge: { id: currentJudge.id, displayName: currentJudge.displayName },
      routes,
    }
    return c.json(judgeBootstrapResponseSchema.parse(response))
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
        ? await findRoundOpenForCategory(
            db,
            currentJudge.competitionId,
            input.roundId,
            competitorRow.categoryId,
          )
        : undefined
      if (!liveTriple || !openRoundRow) {
        throw new ApiError(404, 'Tour introuvable', "Ce tour n'est pas ouvert pour cette voie.")
      }
      await assertCompetitorQualifiedForRound(db, input.roundId, competitorRow)

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

          await notifyPublic(tx, {
            type: 'ranking_updated',
            competitionId: currentJudge.competitionId,
            categoryId: competitorRow.categoryId,
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

      const lastCompetitor = await db.query.competitor.findFirst({
        where: eq(competitor.id, last.competitorId),
      })
      if (!lastCompetitor) {
        throw new ApiError(404, 'Compétiteur introuvable', "Ce compétiteur n'existe pas.")
      }

      const created = await supersedeToNewAscent(db, {
        sources: [last],
        newId: input.id,
        content: {
          holdNumber: input.holdNumber,
          modifier: input.modifier,
          isTop: input.isTop,
          status: input.status,
          climbTimeMs: input.climbTimeMs,
        },
        actor: { kind: 'judge', judgeId: currentJudge.id },
        categoryId: lastCompetitor.categoryId,
        eventType: 'corrected',
        reason: null,
      })

      return c.json(ascentSchema.parse(created), 201)
    },
  )

  app.post(
    '/ascents/batch',
    ascentWriteRateLimiter,
    zValidator('json', judgeAscentsBatchInputSchema, (result, c) => {
      if (!result.success) return problem(c, 400, 'Lot invalide', result.error.issues[0]?.message)
    }),
    async (c) => {
      const currentJudge = c.get('judge')
      const { items } = c.req.valid('json')

      const results: JudgeAscentBatchResult[] = []
      for (const item of items) {
        try {
          const result =
            item.kind === 'create'
              ? await processCreateItem(db, currentJudge, item)
              : await processCorrectItem(db, currentJudge, item, now)
          results.push(result)
        } catch (error) {
          results.push({ id: item.id, status: 'rejected', reason: rejectionReasonFor(error) })
        }
      }

      return c.json(judgeAscentsBatchResponseSchema.parse({ results }), 200)
    },
  )

  return app
}
