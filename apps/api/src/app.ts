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
import { createHealthRoute } from './routes/health'

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
    app.use('*', loggerMiddleware((message) => deps.logger.info(message)))
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

  return app
}
