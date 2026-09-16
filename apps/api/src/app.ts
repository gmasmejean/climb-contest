import type { Database } from '@climbcontest/db'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger as loggerMiddleware } from 'hono/logger'

import type { Env } from './env'
import type { AccessTokenSigner } from './lib/jwt'
import type { Logger } from './lib/logger'
import type { Mailer } from './lib/mailer'
import { errorHandler } from './middleware/problem'
import { createAuthRoutes } from './routes/auth'
import { createCategoryRoutes } from './routes/categories'
import { createCompetitionRoutes } from './routes/competitions'
import { createCompetitorRoutes } from './routes/competitors'
import { createHealthRoute } from './routes/health'
import { createRoundRoutes } from './routes/rounds'
import { createRouteRoutes } from './routes/routes'

export interface AppDeps {
  env: Env
  db: Database
  mailer: Mailer
  logger: Logger
  accessTokenSigner: AccessTokenSigner
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono()

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

  return app
}
