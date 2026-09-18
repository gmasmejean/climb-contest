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
  round,
  roundRoute,
  route,
  routeCategory,
  type Database,
} from '@climbcontest/db'
import { zValidator } from '@hono/zod-validator'
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { uuidv7 } from 'uuidv7'

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
type JudgeRow = typeof judge.$inferSelect
type CompetitionRow = typeof competition.$inferSelect
type RouteRow = typeof route.$inferSelect

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

interface CreateContentShape {
  roundId: string
  routeId: string
  competitorId: string
  holdNumber: number | null
  modifier: 'none' | 'plus'
  isTop: boolean
  status: 'valid' | 'dns' | 'dnf'
  climbTimeMs?: number | null | undefined
}

/** Un rejeu sûr (retry après coupure) doit porter EXACTEMENT le même contenu. */
function matchesCreateContent(row: AscentRow, item: CreateContentShape): boolean {
  return (
    row.roundId === item.roundId &&
    row.routeId === item.routeId &&
    row.competitorId === item.competitorId &&
    row.holdNumber === item.holdNumber &&
    row.modifier === item.modifier &&
    row.isTop === item.isTop &&
    row.status === item.status &&
    row.climbTimeMs === (item.climbTimeMs ?? null)
  )
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
 * de lot (§ « Traitement serveur » du plan de ce lot).
 */
async function processCreateItem(
  db: Database,
  currentJudge: JudgeRow,
  item: CreateBatchItem,
  retriesLeft = 1,
): Promise<JudgeAscentBatchResult> {
  const routeRow = await assertJudgeAssignedToRoute(db, currentJudge, item.routeId)

  if (item.status === 'valid' && !item.isTop) {
    if (item.holdNumber === null || item.holdNumber > routeRow.holdCount) {
      throw new ApiError(
        400,
        'Prise invalide',
        `Le numéro de prise doit être compris entre 1 et ${routeRow.holdCount}.`,
      )
    }
  }

  // Idempotence par id (cas SPEC.md #21) : un rejeu sûr du même item porte
  // exactement le même contenu.
  const existingById = await db.query.ascent.findFirst({ where: eq(ascent.id, item.id) })
  if (existingById) {
    if (matchesCreateContent(existingById, item)) {
      return { id: item.id, status: 'duplicate', ascent: ascentSchema.parse(existingById) }
    }
    throw new ApiError(
      409,
      'Identifiant déjà utilisé',
      'Cet identifiant de passage est déjà utilisé pour un autre passage.',
    )
  }

  const competitorRow = await db.query.competitor.findFirst({
    where: and(
      eq(competitor.id, item.competitorId),
      eq(competitor.competitionId, currentJudge.competitionId),
      isNull(competitor.deletedAt),
    ),
  })
  if (!competitorRow) {
    throw new ApiError(404, 'Compétiteur introuvable', "Ce compétiteur n'existe pas.")
  }

  const liveTriple = await db.query.roundRoute.findFirst({
    where: and(
      eq(roundRoute.roundId, item.roundId),
      eq(roundRoute.routeId, item.routeId),
      eq(roundRoute.categoryId, competitorRow.categoryId),
    ),
  })
  const openRoundRow = liveTriple
    ? await db.query.round.findFirst({
        where: and(
          eq(round.id, item.roundId),
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
    return await createOrConflict(db, currentJudge, item, routeRow)
  } catch (error) {
    // `SELECT ... FOR UPDATE` ne verrouille RIEN si aucune ligne n'existe
    // encore pour ce triplet — deux lots concurrents insérant chacun le
    // tout premier passage d'un compétiteur peuvent donc passer la
    // vérification en même temps et se disputer l'index partiel
    // `ascent_active_key` (ADR-002) à l'INSERT. Ce n'est pas une erreur :
    // c'est exactement le conflit (cas SPEC.md #22) qu'il faut détecter,
    // simplement révélé un instant plus tard qu'espéré — on rejoue une fois
    // pour laisser le `SELECT` retrouver la ligne désormais commitée par
    // l'autre transaction et suivre le chemin conflit normal.
    if (isUniqueViolation(error) && retriesLeft > 0) {
      return processCreateItem(db, currentJudge, item, retriesLeft - 1)
    }
    throw error
  }
}

async function createOrConflict(
  db: Database,
  currentJudge: JudgeRow,
  item: CreateBatchItem,
  routeRow: RouteRow,
): Promise<JudgeAscentBatchResult> {
  return db.transaction(async (tx) => {
    // Verrouille la ligne active du triplet, s'il y en a une, pour se
    // protéger d'une course entre deux lots concurrents (deux appareils qui
    // synchronisent au même instant).
    const [activeRow] = await tx
      .select()
      .from(ascent)
      .where(
        and(
          eq(ascent.roundId, item.roundId),
          eq(ascent.routeId, item.routeId),
          eq(ascent.competitorId, item.competitorId),
          isNull(ascent.supersededBy),
          isNull(ascent.conflictGroup),
        ),
      )
      .for('update')

    if (activeRow) {
      if (matchesCreateContent(activeRow, item)) {
        // Même résultat déjà enregistré sous un autre id (ex. deux juges
        // assignés à la même voie confirment indépendamment le même TOP) —
        // rien à ajouter, pas un conflit au sens de SPEC.md § 6.3.
        return { id: item.id, status: 'duplicate', ascent: ascentSchema.parse(activeRow) }
      }

      // Conflit réel (cas SPEC.md #22) : un autre appareil a déjà un passage
      // actif différent pour ce triplet. `conflict_group` ne porte aucune FK
      // (contrairement à `superseded_by`, ADR-031) — pas de contournement
      // `DEFERRABLE` nécessaire : l'UPDATE puis l'INSERT s'exécutent dans
      // l'ordre naturel (DECISIONS.md ADR-033).
      const conflictGroupId = uuidv7()
      await tx
        .update(ascent)
        .set({ conflictGroup: conflictGroupId, updatedAt: new Date() })
        .where(eq(ascent.id, activeRow.id))

      const [inserted] = await tx
        .insert(ascent)
        .values({
          id: item.id,
          competitionId: currentJudge.competitionId,
          roundId: item.roundId,
          routeId: item.routeId,
          competitorId: item.competitorId,
          holdNumber: item.holdNumber,
          holdCount: routeRow.holdCount,
          modifier: item.modifier,
          isTop: item.isTop,
          status: item.status,
          climbTimeMs: item.climbTimeMs ?? null,
          recordedByJudgeId: currentJudge.id,
          recordedByUserId: null,
          recordedAt: new Date(item.recordedAt),
          deviceId: item.deviceId,
          conflictGroup: conflictGroupId,
        })
        .returning()
      if (!inserted)
        throw new ApiError(500, 'Erreur interne', 'Impossible d’enregistrer le passage.')

      await tx.insert(ascentEvent).values({
        ascentId: inserted.id,
        eventType: 'created',
        actorType: 'judge',
        actorId: currentJudge.id,
        payload: {
          holdNumber: inserted.holdNumber,
          modifier: inserted.modifier,
          isTop: inserted.isTop,
          status: inserted.status,
          climbTimeMs: inserted.climbTimeMs,
          conflictGroup: conflictGroupId,
        },
      })

      const refreshedExisting = await tx.query.ascent.findFirst({
        where: eq(ascent.id, activeRow.id),
      })
      if (!refreshedExisting) {
        throw new ApiError(500, 'Erreur interne', 'Impossible de relire le passage en conflit.')
      }

      return {
        id: item.id,
        status: 'conflict',
        conflictGroup: conflictGroupId,
        existing: ascentSchema.parse(refreshedExisting),
        incoming: ascentSchema.parse(inserted),
      }
    }

    const [row] = await tx
      .insert(ascent)
      .values({
        id: item.id,
        competitionId: currentJudge.competitionId,
        roundId: item.roundId,
        routeId: item.routeId,
        competitorId: item.competitorId,
        holdNumber: item.holdNumber,
        holdCount: routeRow.holdCount,
        modifier: item.modifier,
        isTop: item.isTop,
        status: item.status,
        climbTimeMs: item.climbTimeMs ?? null,
        recordedByJudgeId: currentJudge.id,
        recordedByUserId: null,
        recordedAt: new Date(item.recordedAt),
        deviceId: item.deviceId,
      })
      .returning()
    if (!row) throw new ApiError(500, 'Erreur interne', 'Impossible d’enregistrer le passage.')

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

    return { id: item.id, status: 'accepted', ascent: ascentSchema.parse(row) }
  })
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

  const created = await db.transaction(async (tx) => {
    // Même mécanique que Lot 5 (ADR-031) : la FK sur `superseded_by` est
    // `DEFERRABLE INITIALLY DEFERRED`, donc l'UPDATE peut référencer l'id de
    // la nouvelle ligne avant qu'elle n'existe.
    await tx
      .update(ascent)
      .set({ supersededBy: item.id, updatedAt: new Date() })
      .where(eq(ascent.id, target.id))

    const [row] = await tx
      .insert(ascent)
      .values({
        id: item.id,
        competitionId: target.competitionId,
        roundId: target.roundId,
        routeId: target.routeId,
        competitorId: target.competitorId,
        holdNumber: item.holdNumber,
        holdCount: target.holdCount,
        modifier: item.modifier,
        isTop: item.isTop,
        status: item.status,
        climbTimeMs: item.climbTimeMs ?? null,
        recordedByJudgeId: currentJudge.id,
        recordedByUserId: null,
        recordedAt: target.recordedAt,
        deviceId: target.deviceId,
      })
      .returning()
    if (!row) throw new ApiError(500, 'Erreur interne', 'Impossible d’enregistrer la correction.')

    await tx.insert(ascentEvent).values([
      {
        ascentId: target.id,
        eventType: 'corrected',
        actorType: 'judge',
        actorId: currentJudge.id,
        payload: {
          correctedInto: row.id,
          previous: {
            holdNumber: target.holdNumber,
            modifier: target.modifier,
            isTop: target.isTop,
            status: target.status,
            climbTimeMs: target.climbTimeMs,
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
          correctedFrom: target.id,
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

  return { id: item.id, status: 'accepted', ascent: ascentSchema.parse(created) }
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
