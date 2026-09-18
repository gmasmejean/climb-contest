import { ascentSchema, resolveConflictInputSchema } from '@climbcontest/contracts'
import { competitor, type Database } from '@climbcontest/db'
import { zValidator } from '@hono/zod-validator'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { uuidv7 } from 'uuidv7'

import { resolveConflictByChoosing, supersedeToNewAscent } from '../lib/ascent-correction'
import { findConflictGroupRows, listUnresolvedConflicts } from '../lib/conflicts'
import type { AccessTokenSigner } from '../lib/jwt'
import { requireOrganizer } from '../middleware/auth'
import { requireCompetitionAccess } from '../middleware/competition-access'
import { ApiError, problem } from '../middleware/problem'

export interface ConflictsRouteDeps {
  db: Database
  accessTokenSigner: AccessTokenSigner
}

/**
 * Lot 8 (SPEC.md § 6.3, § 7) — lister et trancher les conflits de saisie.
 * Un juge ne peut plus corriger une ligne en conflit (`judge-ascents.ts`,
 * ADR-033 : « seul l'organisateur peut le corriger ») ; cette route est ce
 * « seul l'organisateur peut ».
 */
export function createConflictsRoutes(deps: ConflictsRouteDeps): Hono {
  const app = new Hono()
  const { db, accessTokenSigner } = deps

  app.use('*', requireOrganizer(accessTokenSigner), requireCompetitionAccess(db))

  app.get('/conflicts', async (c) => {
    const competitionId = c.get('competition').id
    const conflicts = await listUnresolvedConflicts(db, competitionId)
    return c.json(conflicts)
  })

  app.post(
    '/conflicts/:conflictGroupId/resolve',
    zValidator('json', resolveConflictInputSchema, (result, c) => {
      if (!result.success)
        return problem(c, 400, 'Requête invalide', result.error.issues[0]?.message)
    }),
    async (c) => {
      const organizer = c.get('organizer')
      const competitionId = c.get('competition').id
      const conflictGroupId = c.req.param('conflictGroupId')
      const input = c.req.valid('json')

      const groupRows = await findConflictGroupRows(db, competitionId, conflictGroupId)
      if (groupRows.length === 0) {
        throw new ApiError(404, 'Conflit introuvable', "Ce conflit n'existe pas ou est déjà résolu.")
      }

      const competitorRow = await db.query.competitor.findFirst({
        where: eq(competitor.id, groupRows[0]!.competitorId),
      })
      if (!competitorRow) {
        throw new ApiError(404, 'Compétiteur introuvable', "Ce compétiteur n'existe pas.")
      }

      const actor = { kind: 'organizer' as const, userId: organizer.sub }
      const reason = input.reason ?? null

      if (input.resolution === 'choose') {
        const winner = groupRows.find((row) => row.id === input.ascentId)
        if (!winner) {
          throw new ApiError(
            400,
            'Valeur invalide',
            "Cette saisie ne fait pas partie de ce conflit.",
          )
        }
        const losers = groupRows.filter((row) => row.id !== winner.id)
        const result = await resolveConflictByChoosing(db, {
          winner,
          losers,
          actor,
          categoryId: competitorRow.categoryId,
          reason,
        })
        return c.json(ascentSchema.parse(result))
      }

      const result = await supersedeToNewAscent(db, {
        sources: groupRows,
        newId: uuidv7(),
        content: {
          holdNumber: input.holdNumber,
          modifier: input.modifier,
          isTop: input.isTop,
          status: input.status,
          climbTimeMs: input.climbTimeMs,
        },
        actor,
        categoryId: competitorRow.categoryId,
        eventType: 'conflict_resolved',
        reason,
      })
      return c.json(ascentSchema.parse(result))
    },
  )

  return app
}
