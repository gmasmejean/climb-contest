import {
  ORGANIZATION_PHOTO_MAX_BYTES,
  reorderOrganizationPhotosInputSchema,
  updateOrganizationPhotoInputSchema,
} from '@climbcontest/contracts'
import type { Database } from '@climbcontest/db'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'

import type { AccessTokenSigner } from '../lib/jwt'
import {
  addOrganizationPhoto,
  deleteOrganizationPhoto,
  listOrganizationPhotos,
  openOrganizationPhoto,
  organizationPhotoHeaders,
  reorderOrganizationPhotos,
  restoreOrganizationPhoto,
  setOrganizationPhotoAltText,
  toOrganizationPhoto,
  type OrganizationPhotoServiceDeps,
} from '../lib/organization-photos'
import type { StorageAdapter } from '../lib/storage'
import { requireOrganizer, requireOwner } from '../middleware/auth'
import { ApiError, problem } from '../middleware/problem'

export interface OrganizationPhotoRouteDeps {
  db: Database
  accessTokenSigner: AccessTokenSigner
  storage: StorageAdapter
  now?: (() => Date) | undefined
}

/**
 * Photos de la fiche de l'organisation (ROADMAP.md Lot 27, DECISIONS.md
 * ADR-090), montées sous `/organization/photos`. Lecture pour tout membre ;
 * ajout, texte alternatif, ordre, suppression et « Annuler » pour les owners.
 * `POST /` reçoit le JPEG brut en une requête, comme la photo de voie.
 */
export function createOrganizationPhotoRoutes(deps: OrganizationPhotoRouteDeps): Hono {
  const app = new Hono()
  const { db, accessTokenSigner } = deps
  const service: OrganizationPhotoServiceDeps = {
    db,
    storage: deps.storage,
    now: deps.now ?? (() => new Date()),
  }

  app.use('*', requireOrganizer(accessTokenSigner))

  app.get('/', async (c) => {
    const photos = await listOrganizationPhotos(db, c.get('organizer').organizationId)
    return c.json(photos.map(toOrganizationPhoto))
  })

  app.post(
    '/',
    requireOwner(db),
    bodyLimit({
      maxSize: ORGANIZATION_PHOTO_MAX_BYTES,
      onError: (c) =>
        problem(
          c,
          413,
          'Photo trop volumineuse',
          'Cette photo dépasse 8 Mo. Réduisez sa taille ou choisissez-en une autre.',
        ),
    }),
    async (c) => {
      const organizer = c.get('organizer')
      const photo = await addOrganizationPhoto(service, {
        organizationId: organizer.organizationId,
        userId: organizer.sub,
        body: new Uint8Array(await c.req.arrayBuffer()),
      })
      return c.json(photo, 201)
    },
  )

  app.put(
    '/order',
    requireOwner(db),
    zValidator('json', reorderOrganizationPhotosInputSchema, (result, c) => {
      if (!result.success) return problem(c, 400, 'Ordre invalide', result.error.issues[0]?.message)
    }),
    async (c) => {
      const photos = await reorderOrganizationPhotos(service, {
        organizationId: c.get('organizer').organizationId,
        photoIds: c.req.valid('json').photoIds,
      })
      return c.json(photos)
    },
  )

  app.get('/:photoId', async (c) => {
    const opened = await openOrganizationPhoto(service, {
      organizationId: c.get('organizer').organizationId,
      photoId: c.req.param('photoId'),
    })
    if (!opened) throw new ApiError(404, 'Photo introuvable', 'Cette photo n’existe pas.')
    return new Response(opened.stream, {
      status: 200,
      headers: organizationPhotoHeaders(opened, 'members'),
    })
  })

  app.patch(
    '/:photoId',
    requireOwner(db),
    zValidator('json', updateOrganizationPhotoInputSchema, (result, c) => {
      if (!result.success) {
        return problem(c, 400, 'Description invalide', result.error.issues[0]?.message)
      }
    }),
    async (c) => {
      const photo = await setOrganizationPhotoAltText(service, {
        organizationId: c.get('organizer').organizationId,
        photoId: c.req.param('photoId'),
        altText: c.req.valid('json').altText,
      })
      return c.json(photo)
    },
  )

  app.delete('/:photoId', requireOwner(db), async (c) => {
    await deleteOrganizationPhoto(service, {
      organizationId: c.get('organizer').organizationId,
      photoId: c.req.param('photoId'),
    })
    return c.body(null, 204)
  })

  app.post('/:photoId/restore', requireOwner(db), async (c) => {
    const photo = await restoreOrganizationPhoto(service, {
      organizationId: c.get('organizer').organizationId,
      photoId: c.req.param('photoId'),
    })
    return c.json(photo)
  })

  return app
}
