import { createDatabase } from '@climbcontest/db'
import { serve } from '@hono/node-server'

import { createApp } from './app'
import { loadEnv } from './env'
import { createAccessTokenSigner } from './lib/jwt'
import { createLogger } from './lib/logger'
import { SmtpMailer } from './lib/mailer'

const env = loadEnv()
const logger = createLogger(env)
const { db, close } = createDatabase(env.DATABASE_URL)
const mailer = new SmtpMailer(env)
const accessTokenSigner = createAccessTokenSigner(env.JWT_ACCESS_SECRET)

const app = createApp({ env, db, mailer, logger, accessTokenSigner })

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info(`API démarrée sur http://localhost:${info.port}`)
})

async function shutdown(): Promise<void> {
  logger.info('Arrêt en cours…')
  server.close()
  await close()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
