import type { Database } from '@climbcontest/db'
import { Hono, type MiddlewareHandler } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { cors } from 'hono/cors'
import { logger as loggerMiddleware } from 'hono/logger'
import { secureHeaders } from 'hono/secure-headers'

import type { Env } from './env'
import type { AccessTokenSigner, JudgeTokenSigner } from './lib/jwt'
import type { Logger } from './lib/logger'
import type { Mailer } from './lib/mailer'
import { createPublicRankingCache, type PublicRankingCache } from './lib/public-cache'
import { createNoopRealtimeBridge, type RealtimeBridge } from './lib/realtime-bridge'
import type { StorageAdapter } from './lib/storage'
import { errorHandler, problem } from './middleware/problem'
import { createAuthRoutes } from './routes/auth'
import { createCategoryRoutes } from './routes/categories'
import { createCompetitionImportRoutes } from './routes/competition-import'
import { createCompetitionTrashRoutes } from './routes/competition-trash'
import { createCompetitionRoutes } from './routes/competitions'
import { createCompetitorRoutes } from './routes/competitors'
import { createConflictsRoutes } from './routes/conflicts'
import { createDashboardRoutes } from './routes/dashboard'
import { createExportRoutes } from './routes/exports'
import { createGdprRoutes } from './routes/gdpr'
import { createHealthRoute } from './routes/health'
import { createJudgeAscentRoutes } from './routes/judge-ascents'
import { createJudgeAuthRoutes } from './routes/judge-auth'
import { createJudgeRoutes } from './routes/judges'
import { createOrganizerAscentRoutes } from './routes/organizer-ascents'
import { createPublicRoutes } from './routes/public'
import { createQrCodesRoutes } from './routes/qrcodes'
import { createRoundRoutes } from './routes/rounds'
import { createRoundStatusRoutes } from './routes/round-status'
import { createRouteVideoRoutes } from './routes/route-video'
import { createRouteRoutes } from './routes/routes'

const MIB = 1024 * 1024

/**
 * Deux routes gèrent leur PROPRE limite, avec un message adapté : l'import de
 * sauvegarde (25 Mio) et les morceaux de vidéo (16 Mio). La limite globale ne
 * s'y applique pas.
 */
function hasOwnBodyLimit(method: string, path: string): boolean {
  if (method === 'POST' && path === '/api/v1/competitions/import') return true
  return method === 'PATCH' && /\/routes\/[^/]+\/video\/uploads\/[^/]+$/.test(path)
}

/**
 * Taille maximale d'un corps de requête partout ailleurs (revue de sécurité,
 * Lot 9). Sans limite globale, n'importe qui pouvait envoyer un JSON de
 * plusieurs centaines de Mio à une route NON authentifiée (`/auth/login`) et
 * saturer la mémoire. 1 Mio suffit à tout ce qui est du JSON ordinaire (l'import
 * CSV des compétiteurs inclus).
 */
const defaultBodyLimit = bodyLimit({
  maxSize: MIB,
  onError: (c) =>
    problem(
      c,
      413,
      'Corps de requête trop volumineux',
      'Cette requête est plus grosse que ce que le serveur accepte.',
    ),
})

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
  /**
   * Lot 9 (ADR-058) : stockage des vidéos. Absent → les routes de téléversement
   * ne sont pas montées (la suite de tests existante n'en a pas besoin) ;
   * `index.ts` le fournit toujours.
   */
  storage?: StorageAdapter
  videoMaxBytes?: number
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
  // En-têtes de sécurité sur TOUTE réponse : pas de « sniffing » de type MIME,
  // pas de cadrage par un autre site, pas de fuite de l'URL en `Referer`.
  app.use('*', secureHeaders())
  const limitBodySize: MiddlewareHandler = (c, next) =>
    hasOwnBodyLimit(c.req.method, c.req.path) ? next() : defaultBodyLimit(c, next)
  app.use('/api/*', limitBodySize)
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
  app.route(
    '/api/v1/competitions/import',
    createCompetitionImportRoutes({ ...scopedDeps, now: deps.now }),
  )
  // Avant `createCompetitionRoutes` : `GET /trash` ne doit pas être pris pour `GET /:id`.
  app.route(
    '/api/v1/competitions',
    createCompetitionTrashRoutes({ ...scopedDeps, storage: deps.storage, now: deps.now }),
  )
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
    '/api/v1/competitions/:id',
    createGdprRoutes({ ...scopedDeps, storage: deps.storage, now: deps.now }),
  )
  if (deps.storage) {
    app.route(
      '/api/v1/competitions/:id/routes/:rid/video',
      createRouteVideoRoutes({
        ...scopedDeps,
        storage: deps.storage,
        maxBytes: deps.videoMaxBytes ?? 209_715_200,
        now: deps.now,
      }),
    )
  }
  app.route(
    '/api/v1/competitions/:id/exports',
    createExportRoutes({ ...scopedDeps, now: deps.now }),
  )
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
    createPublicRoutes({
      db: deps.db,
      cache: publicRankingCache,
      bridge: realtimeBridge,
      storage: deps.storage,
    }),
  )

  return app
}
