import { routePhotoHoldsInputSchema, ROUTE_PHOTO_MAX_BYTES } from '@climbcontest/contracts'
import type { Database } from '@climbcontest/db'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'

import type { AccessTokenSigner } from '../lib/jwt'
import {
  deleteRoutePhoto,
  openRoutePhoto,
  putRoutePhoto,
  routePhotoHeaders,
  setRoutePhotoHolds,
  type RoutePhotoServiceDeps,
} from '../lib/route-photo'
import type { StorageAdapter } from '../lib/storage'
import { requireOrganizer } from '../middleware/auth'
import { requireCompetitionAccess } from '../middleware/competition-access'
import { ApiError, problem } from '../middleware/problem'

export interface RoutePhotoRouteDeps {
  db: Database
  accessTokenSigner: AccessTokenSigner
  storage: StorageAdapter
  now?: (() => Date) | undefined
}

/**
 * Photo annotée d'une voie (ROADMAP.md Lot 15, DECISIONS.md ADR-066), montée
 * sous `/competitions/:id/routes/:rid/photo` : `PUT /` envoie le JPEG en une
 * seule requête (environ 300 Ko après ré-encodage côté client — le protocole
 * par morceaux des vidéos serait excessif), `PUT /holds` enregistre
 * l'annotation, `GET /` relit la photo, `DELETE /` la retire.
 */
export function createRoutePhotoRoutes(deps: RoutePhotoRouteDeps): Hono {
  const app = new Hono()
  const { db, accessTokenSigner } = deps
  const service: RoutePhotoServiceDeps = {
    db,
    storage: deps.storage,
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

  app.put(
    '/',
    bodyLimit({
      maxSize: ROUTE_PHOTO_MAX_BYTES,
      onError: (c) =>
        problem(
          c,
          413,
          'Photo trop volumineuse',
          'Cette photo dépasse 8 Mo. Réduisez sa taille ou choisissez-en une autre.',
        ),
    }),
    async (c) => {
      const body = new Uint8Array(await c.req.arrayBuffer())
      const photo = await putRoutePhoto(service, {
        ...scope(c),
        userId: c.get('organizer').sub,
        body,
      })
      return c.json(photo, 201)
    },
  )

  app.put(
    '/holds',
    zValidator('json', routePhotoHoldsInputSchema, (result, c) => {
      if (!result.success)
        return problem(c, 400, 'Prises invalides', result.error.issues[0]?.message)
    }),
    async (c) => {
      const photo = await setRoutePhotoHolds(service, {
        ...scope(c),
        holds: c.req.valid('json').holds,
      })
      return c.json(photo)
    },
  )

  app.get('/', async (c) => {
    const opened = await openRoutePhoto(service, scope(c))
    if (!opened) throw new ApiError(404, 'Photo introuvable', "Cette voie n'a pas de photo.")
    return new Response(opened.stream, { status: 200, headers: routePhotoHeaders(opened) })
  })

  app.delete('/', async (c) => {
    await deleteRoutePhoto(service, scope(c))
    return c.body(null, 204)
  })

  return app
}
