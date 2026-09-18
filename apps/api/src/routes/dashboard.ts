import { activityLogQuerySchema, dashboardResponseSchema } from '@climbcontest/contracts'
import type { Database } from '@climbcontest/db'
import { Hono } from 'hono'

import { activityLogToCsv, fetchActivityLog } from '../lib/activity-log'
import { computeDashboard } from '../lib/dashboard'
import type { AccessTokenSigner } from '../lib/jwt'
import { requireOrganizer } from '../middleware/auth'
import { requireCompetitionAccess } from '../middleware/competition-access'
import { problem } from '../middleware/problem'

export interface DashboardRouteDeps {
  db: Database
  accessTokenSigner: AccessTokenSigner
  /** Seam de test — jamais autre chose que `() => new Date()` en production. */
  now?: (() => Date) | undefined
}

export function createDashboardRoutes(deps: DashboardRouteDeps): Hono {
  const app = new Hono()
  const { db, accessTokenSigner } = deps
  const now = deps.now ?? (() => new Date())

  app.use('*', requireOrganizer(accessTokenSigner), requireCompetitionAccess(db))

  app.get('/dashboard', async (c) => {
    const competitionId = c.get('competition').id
    const dashboard = await computeDashboard(db, competitionId, now)
    return c.json(dashboardResponseSchema.parse(dashboard))
  })

  app.get('/activity-log', async (c) => {
    const competitionId = c.get('competition').id
    const query = activityLogQuerySchema.safeParse({
      type: c.req.query('type') || undefined,
      actorType: c.req.query('actorType') || undefined,
      from: c.req.query('from') || undefined,
      to: c.req.query('to') || undefined,
    })
    if (!query.success) {
      return problem(c, 400, 'Requête invalide', query.error.issues[0]?.message)
    }

    const entries = await fetchActivityLog(db, competitionId, query.data)

    if (c.req.query('format') === 'csv') {
      return new Response(activityLogToCsv(entries), {
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': 'attachment; filename="journal-activite.csv"',
        },
      })
    }

    return c.json({ entries })
  })

  return app
}
