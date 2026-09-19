import { resultsExportQuerySchema } from '@climbcontest/contracts'
import type { competition as competitionTable, Database } from '@climbcontest/db'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'

import { buildCompetitionBackup } from '../lib/exports/backup'
import { loadCompetitionResults } from '../lib/exports/results'
import { resultsToCsv } from '../lib/exports/results-csv'
import { resultsToPdf } from '../lib/exports/results-pdf'
import type { AccessTokenSigner } from '../lib/jwt'
import { slugify } from '../lib/slug'
import { requireOrganizer } from '../middleware/auth'
import { requireCompetitionAccess } from '../middleware/competition-access'
import { ApiError, problem } from '../middleware/problem'

type CompetitionRow = typeof competitionTable.$inferSelect

export interface ExportRouteDeps {
  db: Database
  accessTokenSigner: AccessTokenSigner
  now?: (() => Date) | undefined
}

/**
 * Exports de la compétition (ROADMAP.md Lot 9, point 2) : résultats en CSV et
 * en PDF, par catégorie ou pour toutes. Les résultats viennent tous de
 * `assembleCategoryRanking` — le même calcul que la page publique — et ne
 * portent que ce qu'elle montre (nom, prénom, club, dossard).
 */
export function createExportRoutes(deps: ExportRouteDeps): Hono {
  const app = new Hono()
  const { db, accessTokenSigner } = deps
  const now = deps.now ?? (() => new Date())

  app.use('*', requireOrganizer(accessTokenSigner), requireCompetitionAccess(db))

  async function loadResults(competition: CompetitionRow, categoryId: string | undefined) {
    const results = await loadCompetitionResults(db, competition, categoryId ? { categoryId } : {})
    if (!results) throw new ApiError(404, 'Catégorie introuvable', "Cette catégorie n'existe pas.")
    return results
  }

  app.get(
    '/results.csv',
    zValidator('query', resultsExportQuerySchema, (result, c) => {
      if (!result.success)
        return problem(c, 400, 'Requête invalide', result.error.issues[0]?.message)
    }),
    async (c) => {
      const competition = c.get('competition')
      const results = await loadResults(competition, c.req.valid('query').category)
      return new Response(resultsToCsv(results), {
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="resultats-${slugify(competition.name)}.csv"`,
        },
      })
    },
  )

  app.get(
    '/results.pdf',
    zValidator('query', resultsExportQuerySchema, (result, c) => {
      if (!result.success)
        return problem(c, 400, 'Requête invalide', result.error.issues[0]?.message)
    }),
    async (c) => {
      const competition = c.get('competition')
      const results = await loadResults(competition, c.req.valid('query').category)
      return new Response(await resultsToPdf(results, now()), {
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': `attachment; filename="resultats-${slugify(competition.name)}.pdf"`,
        },
      })
    },
  )

  // ADR-056 : sauvegarde complète, réimportable par `POST /competitions/import`.
  app.get('/competition.json', async (c) => {
    const competition = c.get('competition')
    const backup = await buildCompetitionBackup(db, competition, now())
    const day = backup.exportedAt.slice(0, 10)
    return new Response(JSON.stringify(backup), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="sauvegarde-${slugify(competition.name)}-${day}.json"`,
      },
    })
  })

  return app
}
