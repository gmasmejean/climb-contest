import type { Database } from '@climbcontest/db'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger as loggerMiddleware } from 'hono/logger'

import type { Env } from './env'
import type { AccessTokenSigner, JudgeTokenSigner } from './lib/jwt'
import type { Logger } from './lib/logger'
import type { Mailer } from './lib/mailer'
import { errorHandler } from './middleware/problem'
import { createAuthRoutes } from './routes/auth'
import { createCategoryRoutes } from './routes/categories'
import { createCompetitionRoutes } from './routes/competitions'
import { createCompetitorRoutes } from './routes/competitors'
import { createHealthRoute } from './routes/health'
import { createJudgeAuthRoutes } from './routes/judge-auth'
import { createJudgeRoutes } from './routes/judges'
import { createQrCodesRoutes } from './routes/qrcodes'
import { createRoundRoutes } from './routes/rounds'
import { createRouteRoutes } from './routes/routes'

export interface AppDeps {
  env: Env
  db: Database
  mailer: Mailer
  logger: Logger
  accessTokenSigner: AccessTokenSigner
  judgeTokenSigner: JudgeTokenSigner
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
  app.route(
    '/api/v1/competitions/:id/judges',
    createJudgeRoutes({ ...scopedDeps, env: deps.env, mailer: deps.mailer }),
  )
  app.route('/api/v1/competitions/:id', createQrCodesRoutes({ ...scopedDeps, env: deps.env }))
  app.route(
    '/api/v1/judge',
    createJudgeAuthRoutes({ db: deps.db, judgeTokenSigner: deps.judgeTokenSigner }),
  )

  return app
}
