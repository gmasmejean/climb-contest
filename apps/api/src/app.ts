import type { Database } from '@climbcontest/db'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger as loggerMiddleware } from 'hono/logger'

import type { Env } from './env'
import type { AccessTokenSigner, JudgeTokenSigner } from './lib/jwt'
import type { Logger } from './lib/logger'
import type { Mailer } from './lib/mailer'
import { createPublicRankingCache, type PublicRankingCache } from './lib/public-cache'
import { createNoopRealtimeBridge, type RealtimeBridge } from './lib/realtime-bridge'
import { errorHandler } from './middleware/problem'
import { createAuthRoutes } from './routes/auth'
import { createCategoryRoutes } from './routes/categories'
import { createCompetitionRoutes } from './routes/competitions'
import { createCompetitorRoutes } from './routes/competitors'
import { createConflictsRoutes } from './routes/conflicts'
import { createDashboardRoutes } from './routes/dashboard'
import { createHealthRoute } from './routes/health'
import { createJudgeAscentRoutes } from './routes/judge-ascents'
import { createJudgeAuthRoutes } from './routes/judge-auth'
import { createJudgeRoutes } from './routes/judges'
import { createOrganizerAscentRoutes } from './routes/organizer-ascents'
import { createPublicRoutes } from './routes/public'
import { createQrCodesRoutes } from './routes/qrcodes'
import { createRoundRoutes } from './routes/rounds'
import { createRoundStatusRoutes } from './routes/round-status'
import { createRouteRoutes } from './routes/routes'

export interface AppDeps {
  env: Env
  db: Database
  mailer: Mailer
  logger: Logger
  accessTokenSigner: AccessTokenSigner
  judgeTokenSigner: JudgeTokenSigner
  /** Seam de test (ADR-007) — jamais fourni en production. */
  now?: () => Date
  /**
   * Lot 7 : facultatifs, avec un défaut inoffensif (cache mémoire tout
   * neuf, pont temps réel qui ne se connecte jamais à Postgres) — toutes
   * les suites de test déjà existantes qui construisent `createApp({...})`
   * sans s'intéresser au Lot 7 continuent de fonctionner à l'identique.
   * `index.ts` (production) et les tests dédiés au Lot 7 injectent un vrai
   * `createRealtimeBridge`.
   */
  publicRankingCache?: PublicRankingCache
  realtimeBridge?: RealtimeBridge
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono()
  const publicRankingCache = deps.publicRankingCache ?? createPublicRankingCache()
  const realtimeBridge = deps.realtimeBridge ?? createNoopRealtimeBridge()
  // Invalidation de cache pilotée par le côté LISTEN, pas par les routes
  // d'écriture elles-mêmes (ADR-014) : reste correct si l'API tourne un
  // jour en plusieurs workers, et évite à chaque route d'écriture de
  // connaître le cache. `route_updated`/`round_status_changed` n'ont pas
  // besoin d'entrée ici : un changement pertinent pour le classement est
  // toujours accompagné d'un `ranking_updated` explicite par le site
  // d'écriture (voir routes/rounds.ts, routes/routes.ts).
  realtimeBridge.subscribeAll((event) => {
    if (event.type === 'ranking_updated') {
      publicRankingCache.invalidateCategory(event.competitionId, event.categoryId)
    }
  })

  app.use(
    '*',
    cors({
      origin: deps.env.CORS_ORIGIN,
      credentials: true,
    }),
  )
  if (deps.env.NODE_ENV !== 'test') {
    app.use(
      '*',
      loggerMiddleware((message) => deps.logger.info(message)),
    )
  }
  app.onError(errorHandler)

  app.route('/health', createHealthRoute(deps.db))
  app.route(
    '/api/v1/auth',
    createAuthRoutes({
      db: deps.db,
      mailer: deps.mailer,
      env: deps.env,
      accessTokenSigner: deps.accessTokenSigner,
    }),
  )

  const scopedDeps = { db: deps.db, accessTokenSigner: deps.accessTokenSigner }
  app.route('/api/v1/competitions', createCompetitionRoutes(scopedDeps))
  app.route('/api/v1/competitions/:id/categories', createCategoryRoutes(scopedDeps))
  app.route('/api/v1/competitions/:id/competitors', createCompetitorRoutes(scopedDeps))
  app.route('/api/v1/competitions/:id/routes', createRouteRoutes(scopedDeps))
  app.route('/api/v1/competitions/:id/rounds', createRoundRoutes(scopedDeps))
  app.route(
    '/api/v1/competitions/:id/judges',
    createJudgeRoutes({ ...scopedDeps, env: deps.env, mailer: deps.mailer }),
  )
  app.route('/api/v1/competitions/:id', createQrCodesRoutes({ ...scopedDeps, env: deps.env }))
  app.route('/api/v1/competitions/:id', createRoundStatusRoutes(scopedDeps))
  app.route('/api/v1/competitions/:id', createConflictsRoutes(scopedDeps))
  app.route('/api/v1/competitions/:id', createDashboardRoutes({ ...scopedDeps, now: deps.now }))
  app.route('/api/v1/competitions/:id/ascents', createOrganizerAscentRoutes(scopedDeps))
  app.route(
    '/api/v1/judge',
    createJudgeAuthRoutes({ db: deps.db, judgeTokenSigner: deps.judgeTokenSigner }),
  )
  app.route(
    '/api/v1/judge',
    createJudgeAscentRoutes({
      db: deps.db,
      judgeTokenSigner: deps.judgeTokenSigner,
      now: deps.now,
    }),
  )
  app.route(
    '/api/v1/public',
    createPublicRoutes({ db: deps.db, cache: publicRankingCache, bridge: realtimeBridge }),
  )

  return app
}
