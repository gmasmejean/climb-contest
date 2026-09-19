import { createDatabase } from '@climbcontest/db'
import { serve } from '@hono/node-server'

import { createApp } from './app'
import { loadEnv } from './env'
import { createAccessTokenSigner, createJudgeTokenSigner } from './lib/jwt'
import { createLogger } from './lib/logger'
import { SmtpMailer } from './lib/mailer'
import { createPublicRankingCache } from './lib/public-cache'
import { createRealtimeBridge } from './lib/realtime-bridge'
import { createStorageAdapter, loadStorageConfig } from './lib/storage'
import { cleanupExpiredUploads } from './lib/video/upload'

const env = loadEnv()
const logger = createLogger(env)
const { db, close } = createDatabase(env.DATABASE_URL)
const mailer = new SmtpMailer(env)
const accessTokenSigner = createAccessTokenSigner(env.JWT_ACCESS_SECRET)
const judgeTokenSigner = createJudgeTokenSigner(env.JWT_JUDGE_SECRET)
const publicRankingCache = createPublicRankingCache()
const realtimeBridge = createRealtimeBridge(env.DATABASE_URL, { logger })
// Lot 9 (ADR-058) : stockage des vidéos téléversées. Échoue au démarrage sur
// une configuration invalide ou sur `STORAGE_DRIVER=s3` (non livré).
const storageConfig = loadStorageConfig()
const storage = createStorageAdapter(storageConfig)

const app = createApp({
  env,
  db,
  mailer,
  logger,
  accessTokenSigner,
  judgeTokenSigner,
  publicRankingCache,
  realtimeBridge,
  storage,
  videoMaxBytes: storageConfig.VIDEO_MAX_BYTES,
})

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info(`API démarrée sur http://localhost:${info.port}`)
})

// Purge des envois de vidéo abandonnés : au démarrage, puis toutes les heures.
const videoService = {
  db,
  storage,
  maxBytes: storageConfig.VIDEO_MAX_BYTES,
  now: () => new Date(),
}
async function purgeAbandonedUploads(): Promise<void> {
  try {
    const purged = await cleanupExpiredUploads(videoService)
    if (purged > 0) logger.info(`${purged} envoi(s) de vidéo abandonné(s) purgé(s)`)
  } catch (error) {
    logger.error({ error: String(error) }, 'Purge des envois de vidéo abandonnés impossible')
  }
}
void purgeAbandonedUploads()
// `unref` : ce minuteur ne doit jamais empêcher le processus de s'arrêter.
const purgeTimer = setInterval(() => void purgeAbandonedUploads(), 60 * 60 * 1000)
purgeTimer.unref()

async function shutdown(): Promise<void> {
  logger.info('Arrêt en cours…')
  clearInterval(purgeTimer)
  server.close()
  await realtimeBridge.close()
  await close()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
