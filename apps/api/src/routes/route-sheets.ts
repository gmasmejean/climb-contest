import { asc, and, eq, isNotNull, isNull } from 'drizzle-orm'
import { route, type Database } from '@climbcontest/db'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'

import { categoryLabelsByRoute } from '../lib/ascent-progress'
import type { AccessTokenSigner } from '../lib/jwt'
import { openRoutePhoto, readStoredHolds } from '../lib/route-photo'
import { generateRouteSheets, type RouteSheetInput } from '../lib/route-sheets-pdf'
import type { StorageAdapter } from '../lib/storage'
import { requireOrganizer } from '../middleware/auth'
import { requireCompetitionAccess } from '../middleware/competition-access'
import { ApiError, problem } from '../middleware/problem'

export interface RouteSheetsRouteDeps {
  db: Database
  accessTokenSigner: AccessTokenSigner
  storage: StorageAdapter
}

const routeSheetsQuerySchema = z.object({ routeId: z.uuid().optional() })

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/**
 * `GET /competitions/:id/route-sheets.pdf` : les fiches « voie » à imprimer
 * (ADR-066). Sans `routeId`, une page par voie qui a une photo ; avec, la
 * fiche de cette seule voie.
 */
export function createRouteSheetsRoutes(deps: RouteSheetsRouteDeps): Hono {
  const app = new Hono()
  const { db, accessTokenSigner, storage } = deps

  app.use('*', requireOrganizer(accessTokenSigner), requireCompetitionAccess(db))

  app.get(
    '/route-sheets.pdf',
    zValidator('query', routeSheetsQuerySchema, (result, c) => {
      if (!result.success)
        return problem(c, 400, 'Requête invalide', result.error.issues[0]?.message)
    }),
    async (c) => {
      const currentCompetition = c.get('competition')
      const { routeId } = c.req.valid('query')

      const rows = await db.query.route.findMany({
        where: and(
          eq(route.competitionId, currentCompetition.id),
          isNull(route.deletedAt),
          isNotNull(route.photoAssetId),
          ...(routeId ? [eq(route.id, routeId)] : []),
        ),
        orderBy: [asc(route.number)],
      })
      if (rows.length === 0) {
        throw new ApiError(
          409,
          'Aucune photo de voie',
          routeId
            ? "Cette voie n'a pas de photo : téléversez-la d'abord."
            : 'Aucune voie de cette compétition n’a de photo : téléversez-en au moins une.',
        )
      }

      const categories = await categoryLabelsByRoute(
        db,
        rows.map((row) => row.id),
      )
      const sheets: RouteSheetInput[] = []
      for (const row of rows) {
        const opened = await openRoutePhoto(
          { db, storage },
          { competitionId: currentCompetition.id, routeId: row.id },
        )
        if (!opened) {
          throw new ApiError(
            409,
            'Photo introuvable',
            `Le fichier de la photo de la voie ${row.number} est introuvable : renvoyez-la puis recommencez.`,
          )
        }
        sheets.push({
          number: row.number,
          name: row.name,
          sector: row.sector,
          color: row.color,
          holdCount: row.holdCount,
          categoryLabels: (categories.get(row.id) ?? []).map((cat) => cat.label),
          photoJpeg: await readAll(opened.stream),
          holds: readStoredHolds(row),
        })
      }

      const pdfBytes = await generateRouteSheets({
        competitionName: currentCompetition.name,
        sheets,
      })
      c.header('Content-Type', 'application/pdf')
      c.header(
        'Content-Disposition',
        `attachment; filename="fiches-voies-${currentCompetition.publicSlug}.pdf"`,
      )
      return c.body(new Uint8Array(pdfBytes))
    },
  )

  return app
}
