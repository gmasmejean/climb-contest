import { createDatabase } from '@climbcontest/db'
import { serve } from '@hono/node-server'

import { createApp } from './app'
import { loadEnv } from './env'
import { createAccessTokenSigner, createJudgeTokenSigner } from './lib/jwt'
import { createLogger } from './lib/logger'
import { SmtpMailer } from './lib/mailer'
import { createPublicRankingCache } from './lib/public-cache'
import { createRealtimeBridge } from './lib/realtime-bridge'

const env = loadEnv()
const logger = createLogger(env)
const { db, close } = createDatabase(env.DATABASE_URL)
const mailer = new SmtpMailer(env)
const accessTokenSigner = createAccessTokenSigner(env.JWT_ACCESS_SECRET)
const judgeTokenSigner = createJudgeTokenSigner(env.JWT_JUDGE_SECRET)
const publicRankingCache = createPublicRankingCache()
const realtimeBridge = createRealtimeBridge(env.DATABASE_URL, { logger })

const app = createApp({
  env,
  db,
  mailer,
  logger,
  accessTokenSigner,
  judgeTokenSigner,
  publicRankingCache,
  realtimeBridge,
})

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info(`API démarrée sur http://localhost:${info.port}`)
})

async function shutdown(): Promise<void> {
  logger.info('Arrêt en cours…')
  server.close()
  await realtimeBridge.close()
  await close()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
