import {
  createVideoUploadInputSchema,
  videoAssetSchema,
  videoUploadSchema,
} from '@climbcontest/contracts'
import type { Database } from '@climbcontest/db'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'

import type { AccessTokenSigner } from '../lib/jwt'
import type { StorageAdapter } from '../lib/storage'
import {
  abortUpload,
  completeUpload,
  createUpload,
  deleteRouteVideo,
  getUpload,
  receiveChunk,
  UploadOffsetMismatchError,
  type VideoServiceDeps,
} from '../lib/video/upload'
import { requireOrganizer } from '../middleware/auth'
import { requireCompetitionAccess } from '../middleware/competition-access'
import { problem } from '../middleware/problem'

/** Marge au-dessus de `VIDEO_CHUNK_SIZE` (8 Mio) : un morceau ne dépasse jamais 16 Mio. */
const MAX_CHUNK_BYTES = 16 * 1024 * 1024

export interface RouteVideoRouteDeps {
  db: Database
  accessTokenSigner: AccessTokenSigner
  storage: StorageAdapter
  maxBytes: number
  now?: (() => Date) | undefined
}

/**
 * Téléversement d'une vidéo de voie, reprenable (ROADMAP.md Lot 9, point 3,
 * DECISIONS.md ADR-052/ADR-058) : `POST /uploads` ouvre une session,
 * `PATCH /uploads/:uid` envoie un morceau à l'octet `Upload-Offset`,
 * `GET /uploads/:uid` dit où reprendre après une coupure, `POST .../complete`
 * vérifie le contenu réel et publie la vidéo.
 */
export function createRouteVideoRoutes(deps: RouteVideoRouteDeps): Hono {
  const app = new Hono()
  const { db, accessTokenSigner } = deps
  const service: VideoServiceDeps = {
    db,
    storage: deps.storage,
    maxBytes: deps.maxBytes,
    now: deps.now ?? (() => new Date()),
  }

  app.use('*', requireOrganizer(accessTokenSigner), requireCompetitionAccess(db))

  const scope = (c: {
    get: (key: 'competition') => { id: string }
    req: { param: (name: string) => string }
  }) => ({
    competitionId: c.get('competition').id,
    routeId: c.req.param('rid'),
  })

  app.post(
    '/uploads',
    zValidator('json', createVideoUploadInputSchema, (result, c) => {
      if (!result.success)
        return problem(c, 400, 'Requête invalide', result.error.issues[0]?.message)
    }),
    async (c) => {
      const { sizeBytes, mimeType } = c.req.valid('json')
      const upload = await createUpload(service, {
        ...scope(c),
        userId: c.get('organizer').sub,
        sizeBytes,
        mimeType,
      })
      return c.json(videoUploadSchema.parse(upload), 201)
    },
  )

  app.get('/uploads/:uid', async (c) => {
    const upload = await getUpload(
      service,
      scope(c).competitionId,
      scope(c).routeId,
      c.req.param('uid'),
    )
    // Même information dans l'en-tête, comme le protocole tus : un client
    // minimal n'a pas besoin de lire le corps pour reprendre.
    c.header('Upload-Offset', String(upload.receivedBytes))
    return c.json(videoUploadSchema.parse(upload))
  })

  app.patch(
    '/uploads/:uid',
    bodyLimit({
      maxSize: MAX_CHUNK_BYTES,
      onError: (c) => problem(c, 413, 'Morceau trop gros', 'Envoyez des morceaux de 8 Mo au plus.'),
    }),
    async (c) => {
      const rawOffset = c.req.header('Upload-Offset')
      if (!rawOffset || !/^\d+$/.test(rawOffset)) {
        return problem(
          c,
          400,
          'Décalage manquant',
          'L’en-tête Upload-Offset doit indiquer l’octet où reprendre.',
        )
      }
      const body = new Uint8Array(await c.req.arrayBuffer())
      try {
        const upload = await receiveChunk(service, {
          ...scope(c),
          uploadId: c.req.param('uid'),
          offset: Number(rawOffset),
          body,
        })
        c.header('Upload-Offset', String(upload.receivedBytes))
        return c.json(videoUploadSchema.parse(upload))
      } catch (error) {
        if (error instanceof UploadOffsetMismatchError) {
          // 409 + l'offset attendu, en membre d'extension RFC 9457 ET en
          // en-tête : le client se recale et reprend, sans rien perdre.
          c.header('Upload-Offset', String(error.expectedOffset))
          c.status(409)
          return c.json({
            type: 'about:blank',
            title: 'Reprise à un autre octet',
            status: 409,
            detail: `Le serveur a reçu ${error.expectedOffset} octets : reprenez l’envoi à cet octet.`,
            instance: c.req.path,
            expectedOffset: error.expectedOffset,
          })
        }
        throw error
      }
    },
  )

  app.post('/uploads/:uid/complete', async (c) => {
    const asset = await completeUpload(service, {
      ...scope(c),
      uploadId: c.req.param('uid'),
      userId: c.get('organizer').sub,
    })
    return c.json(videoAssetSchema.parse(asset), 201)
  })

  app.delete('/uploads/:uid', async (c) => {
    await abortUpload(service, { ...scope(c), uploadId: c.req.param('uid') })
    return c.body(null, 204)
  })

  // Retire la vidéo téléversée de la voie (le lien externe n'est pas rétabli).
  app.delete('/', async (c) => {
    await deleteRouteVideo(service, scope(c))
    return c.body(null, 204)
  })

  return app
}
