import { competitionSchema } from '@climbcontest/contracts'
import { competition, type Database } from '@climbcontest/db'
import { and, desc, eq, isNotNull } from 'drizzle-orm'
import { Hono } from 'hono'

import {
  permanentlyDeleteCompetition,
  restoreCompetition,
  trashCompetition,
} from '../lib/competition-trash'
import type { AccessTokenSigner } from '../lib/jwt'
import type { StorageAdapter } from '../lib/storage'
import { requireOrganizer } from '../middleware/auth'
import { requireCompetitionAccess } from '../middleware/competition-access'

export interface CompetitionTrashRouteDeps {
  db: Database
  accessTokenSigner: AccessTokenSigner
  storage?: StorageAdapter | undefined
  now?: (() => Date) | undefined
}

/**
 * Corbeille des compétitions (Lot 11, ADR-063). Ouverte à TOUT organisateur de
 * l'organisation — contrairement à la purge RGPD, réservée au propriétaire (ADR-051), qui
 * reste inchangée.
 *
 * À monter AVANT `createCompetitionRoutes` : `GET /trash` doit être vu avant
 * `GET /:id`, qui prendrait « trash » pour un identifiant.
 */
export function createCompetitionTrashRoutes(deps: CompetitionTrashRouteDeps): Hono {
  const app = new Hono()
  const { db, accessTokenSigner } = deps
  const now = deps.now ?? (() => new Date())

  app.use('*', requireOrganizer(accessTokenSigner))

  app.get('/trash', async (c) => {
    const organizer = c.get('organizer')
    const rows = await db.query.competition.findMany({
      where: and(
        eq(competition.organizationId, organizer.organizationId),
        isNotNull(competition.deletedAt),
      ),
      orderBy: [desc(competition.deletedAt)],
    })
    return c.json(rows.map((row) => competitionSchema.parse(row)))
  })

  app.delete('/:id', requireCompetitionAccess(db), async (c) => {
    const trashed = await trashCompetition(db, c.get('competition'), c.get('organizer').sub, now())
    return c.json(competitionSchema.parse(trashed))
  })

  app.post('/:id/restore', requireCompetitionAccess(db, { scope: 'any' }), async (c) => {
    const restored = await restoreCompetition(
      db,
      c.get('competition'),
      c.get('organizer').sub,
      now(),
    )
    return c.json(competitionSchema.parse(restored))
  })

  app.delete('/:id/permanent', requireCompetitionAccess(db, { scope: 'any' }), async (c) => {
    await permanentlyDeleteCompetition(
      { db, storage: deps.storage, now },
      c.get('competition'),
      c.get('organizer').sub,
    )
    return c.body(null, 204)
  })

  return app
}
