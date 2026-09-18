import {
  publicCategoryQuerySchema,
  publicCompetitionMetaSchema,
  publicRankingResponseSchema,
  publicRouteSchema,
} from '@climbcontest/contracts'
import { category, round, route, routeCategory, type Database } from '@climbcontest/db'
import { zValidator } from '@hono/zod-validator'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'

import type { PublicRankingCache } from '../lib/public-cache'
import { resolvePublicCompetitionBySlug } from '../lib/public-access'
import { assembleCategoryRanking } from '../lib/public-ranking'
import type { RealtimeBridge } from '../lib/realtime-bridge'
import { ApiError, problem } from '../middleware/problem'
import { authRateLimiter } from '../middleware/rate-limit'

export interface PublicRouteDeps {
  db: Database
  cache: PublicRankingCache
  bridge: RealtimeBridge
}

const HEARTBEAT_MS = 25_000

async function assertCategoryBelongsToCompetition(
  db: Database,
  competitionId: string,
  categoryId: string,
): Promise<void> {
  const row = await db.query.category.findFirst({
    where: and(eq(category.id, categoryId), eq(category.competitionId, competitionId), isNull(category.deletedAt)),
  })
  if (!row) {
    throw new ApiError(404, 'Catégorie introuvable', "Cette catégorie n'existe pas.")
  }
}

/** Résout tant que le signal n'est pas déjà annulé (déconnexion du spectateur), sans attendre le délai complet dans ce cas. */
function sleepOrAbort(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export function createPublicRoutes(deps: PublicRouteDeps): Hono {
  const app = new Hono()
  const { db, cache, bridge } = deps

  // Généreux et distinct de `authRateLimiter` utilisé pour l'auth
  // organisateur/juge (SPEC.md §6.4 : limitation de débit sur toutes les
  // routes non authentifiées) — un gymnase de club partage souvent une
  // seule IP publique (NAT wifi) pour ses 300 spectateurs.
  const publicReadRateLimiter = authRateLimiter(600, 60 * 1000)
  const publicStreamRateLimiter = authRateLimiter(300, 60 * 1000)

  app.get('/:slug', publicReadRateLimiter, async (c) => {
    const currentCompetition = await resolvePublicCompetitionBySlug(db, c.req.param('slug'))

    const categories = await db
      .select({ id: category.id, label: category.label, displayOrder: category.displayOrder })
      .from(category)
      .where(and(eq(category.competitionId, currentCompetition.id), isNull(category.deletedAt)))
      .orderBy(asc(category.displayOrder))

    // Vide en contest : le round implicite n'est jamais exposé (ADR-023).
    const rounds =
      currentCompetition.format === 'phases'
        ? await db
            .select({
              id: round.id,
              type: round.type,
              displayOrder: round.displayOrder,
              status: round.status,
            })
            .from(round)
            .where(and(eq(round.competitionId, currentCompetition.id), isNull(round.deletedAt)))
            .orderBy(asc(round.displayOrder))
        : []

    return c.json(
      publicCompetitionMetaSchema.parse({
        competition: {
          id: currentCompetition.id,
          slug: currentCompetition.publicSlug,
          name: currentCompetition.name,
          venue: currentCompetition.venue,
          startsOn: currentCompetition.startsOn,
          endsOn: currentCompetition.endsOn,
          format: currentCompetition.format,
          status: currentCompetition.status,
        },
        categories,
        rounds,
      }),
    )
  })

  app.get(
    '/:slug/rankings',
    publicReadRateLimiter,
    zValidator('query', publicCategoryQuerySchema, (result, c) => {
      if (!result.success)
        return problem(c, 400, 'Requête invalide', result.error.issues[0]?.message)
    }),
    async (c) => {
      const currentCompetition = await resolvePublicCompetitionBySlug(db, c.req.param('slug'))
      const { category: categoryId } = c.req.valid('query')
      await assertCategoryBelongsToCompetition(db, currentCompetition.id, categoryId)

      const cached = cache.get(currentCompetition.id, categoryId)
      if (cached) return c.json(cached)

      const response = publicRankingResponseSchema.parse(
        await assembleCategoryRanking(db, currentCompetition, categoryId),
      )
      cache.set(currentCompetition.id, categoryId, response)
      return c.json(response)
    },
  )

  app.get(
    '/:slug/routes',
    publicReadRateLimiter,
    zValidator('query', publicCategoryQuerySchema, (result, c) => {
      if (!result.success)
        return problem(c, 400, 'Requête invalide', result.error.issues[0]?.message)
    }),
    async (c) => {
      const currentCompetition = await resolvePublicCompetitionBySlug(db, c.req.param('slug'))
      const { category: categoryId } = c.req.valid('query')
      await assertCategoryBelongsToCompetition(db, currentCompetition.id, categoryId)

      const rows = await db
        .select({
          id: route.id,
          number: route.number,
          name: route.name,
          holdCount: route.holdCount,
          sector: route.sector,
          color: route.color,
          videoUrl: route.videoUrl,
        })
        .from(route)
        .innerJoin(routeCategory, eq(routeCategory.routeId, route.id))
        .where(
          and(
            eq(route.competitionId, currentCompetition.id),
            eq(routeCategory.categoryId, categoryId),
            isNull(route.deletedAt),
          ),
        )
        .orderBy(asc(route.number))

      return c.json(rows.map((row) => publicRouteSchema.parse(row)))
    },
  )

  app.get('/:slug/stream', publicStreamRateLimiter, async (c) => {
    const currentCompetition = await resolvePublicCompetitionBySlug(db, c.req.param('slug'))

    return streamSSE(c, async (stream) => {
      const unsubscribe = bridge.subscribe(currentCompetition.id, (event) => {
        void stream.writeSSE({ event: event.type, data: JSON.stringify(event) })
      })
      try {
        while (!c.req.raw.signal.aborted) {
          await sleepOrAbort(HEARTBEAT_MS, c.req.raw.signal)
          if (c.req.raw.signal.aborted) break
          // Un commentaire périodique garde la connexion vivante à travers
          // les proxys/reverse-proxys qui ferment les connexions idle
          // (Caddy y compris) — pas un événement métier.
          await stream.writeSSE({ event: 'ping', data: '{}' })
        }
      } finally {
        unsubscribe()
      }
    })
  })

  return app
}
