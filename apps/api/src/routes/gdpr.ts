import {
  purgePersonalDataInputSchema,
  purgePersonalDataResultSchema,
} from '@climbcontest/contracts'
import type { Database } from '@climbcontest/db'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'

import { buildGdprExport, purgePersonalData } from '../lib/gdpr'
import type { AccessTokenSigner } from '../lib/jwt'
import { slugify } from '../lib/slug'
import type { StorageAdapter } from '../lib/storage'
import { requireOrganizer, requireOwner } from '../middleware/auth'
import { requireCompetitionAccess } from '../middleware/competition-access'
import { ApiError, problem } from '../middleware/problem'

export interface GdprRouteDeps {
  db: Database
  accessTokenSigner: AccessTokenSigner
  storage?: StorageAdapter | undefined
  now?: (() => Date) | undefined
}

/**
 * Export et purge des données personnelles d'une compétition (ROADMAP.md
 * Lot 9, DECISIONS.md ADR-051) — réservés au PROPRIÉTAIRE de l'organisation : ce sont
 * des actions sur des données de mineurs, dont la dernière est irréversible.
 */
export function createGdprRoutes(deps: GdprRouteDeps): Hono {
  const app = new Hono()
  const { db, accessTokenSigner } = deps
  const now = deps.now ?? (() => new Date())

  app.use('*', requireOrganizer(accessTokenSigner), requireCompetitionAccess(db))

  app.get('/gdpr-export', requireOwner(db), async (c) => {
    const competition = c.get('competition')
    const data = await buildGdprExport(db, competition, now())
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="donnees-personnelles-${slugify(competition.name)}.json"`,
      },
    })
  })

  app.delete(
    '/personal-data',
    requireOwner(db),
    zValidator('json', purgePersonalDataInputSchema, (result, c) => {
      if (!result.success)
        return problem(c, 400, 'Requête invalide', result.error.issues[0]?.message)
    }),
    async (c) => {
      const competition = c.get('competition')
      // Action irréversible : retaper le nom EXACT, comme on retape le nom d'un
      // dépôt avant de le supprimer. Pas de normalisation — aucune tolérance.
      if (c.req.valid('json').confirmName !== competition.name) {
        throw new ApiError(
          400,
          'Confirmation incorrecte',
          `Pour confirmer, retapez exactement le nom de la compétition : « ${competition.name} ». Rien n’a été supprimé.`,
        )
      }
      const result = await purgePersonalData({ db, storage: deps.storage, now }, competition)
      return c.json(purgePersonalDataResultSchema.parse(result))
    },
  )

  return app
}
