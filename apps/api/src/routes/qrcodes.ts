import { qrSheetInputSchema } from '@climbcontest/contracts'
import { hashToken, judge, judgeRoute, route, type Database } from '@climbcontest/db'
import { zValidator } from '@hono/zod-validator'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { Hono } from 'hono'

import type { Env } from '../env'
import type { AccessTokenSigner } from '../lib/jwt'
import { generateQrSheet, type JudgeSheetEntry } from '../lib/qrcode-pdf'
import { requireOrganizer } from '../middleware/auth'
import { requireCompetitionAccess } from '../middleware/competition-access'
import { ApiError, problem } from '../middleware/problem'

export interface QrCodesRouteDeps {
  db: Database
  accessTokenSigner: AccessTokenSigner
  env: Env
}

/**
 * Un juge dont le jeton est stocké en clair (`judgeCredentialsStored` actif
 * à sa création, DECISIONS.md ADR-027) est inclus automatiquement. Pour les
 * autres, la planche ne peut inclure leur encart qu'à partir du jeton que le
 * client fournit lui-même, tout juste révélé (ADR-026). D'où un `POST`, pas
 * un `GET` : ce n'est jamais une ressource relisible à volonté depuis la
 * base pour CES juges-là.
 */
export function createQrCodesRoutes(deps: QrCodesRouteDeps): Hono {
  const app = new Hono()
  const { db, accessTokenSigner, env } = deps

  app.use('*', requireOrganizer(accessTokenSigner), requireCompetitionAccess(db))

  app.post(
    '/qrcodes.pdf',
    zValidator('json', qrSheetInputSchema, (result, c) => {
      if (!result.success)
        return problem(c, 400, 'Requête invalide', result.error.issues[0]?.message)
    }),
    async (c) => {
      const currentCompetition = c.get('competition')
      const input = c.req.valid('json')

      const activeJudges = await db.query.judge.findMany({
        where: and(
          eq(judge.competitionId, currentCompetition.id),
          isNull(judge.deletedAt),
          isNull(judge.revokedAt),
        ),
      })
      const activeById = new Map(activeJudges.map((row) => [row.id, row]))

      const links = activeJudges.length
        ? await db
            .select({ judgeId: judgeRoute.judgeId, number: route.number, name: route.name })
            .from(judgeRoute)
            .innerJoin(route, eq(judgeRoute.routeId, route.id))
            .where(
              and(
                inArray(
                  judgeRoute.judgeId,
                  activeJudges.map((row) => row.id),
                ),
                isNull(route.deletedAt),
              ),
            )
            .orderBy(asc(route.number))
        : []
      const routesByJudge = new Map<string, string[]>()
      for (const link of links) {
        const label = link.name ? `Voie ${link.number} (${link.name})` : `Voie ${link.number}`
        const list = routesByJudge.get(link.judgeId) ?? []
        list.push(label)
        routesByJudge.set(link.judgeId, list)
      }

      // Encart par juge : jeton stocké en clair en base en priorité, sinon
      // celui fourni par le client (validé contre le hash) pour les juges
      // qui n'en ont pas.
      const entries: JudgeSheetEntry[] = []
      const included = new Set<string>()

      for (const row of activeJudges) {
        if (!row.accessTokenPlain) continue
        included.add(row.id)
        entries.push({
          displayName: row.displayName,
          accessUrl: `${env.PUBLIC_APP_URL}/j/${row.accessTokenPlain}`,
          pinRequired: row.pinHash !== null,
          routeLabels: routesByJudge.get(row.id) ?? [],
        })
      }

      for (const { judgeId, accessToken } of input.judges) {
        if (included.has(judgeId)) continue
        const row = activeById.get(judgeId)
        if (!row) {
          throw new ApiError(
            404,
            'Juge introuvable',
            "Un des juges fournis n'existe plus dans cette compétition — rechargez la page.",
          )
        }
        if (hashToken(accessToken) !== row.accessTokenHash) {
          throw new ApiError(
            400,
            'Jeton invalide',
            'Un des jetons fournis ne correspond plus à ce juge — rechargez la page et réessayez.',
          )
        }
        included.add(judgeId)
        entries.push({
          displayName: row.displayName,
          accessUrl: `${env.PUBLIC_APP_URL}/j/${accessToken}`,
          pinRequired: row.pinHash !== null,
          routeLabels: routesByJudge.get(row.id) ?? [],
        })
      }

      const pdfBytes = await generateQrSheet({
        competitionName: currentCompetition.name,
        judges: entries,
        publicUrl: `${env.PUBLIC_APP_URL}/c/${currentCompetition.publicSlug}`,
      })

      c.header('Content-Type', 'application/pdf')
      c.header(
        'Content-Disposition',
        `attachment; filename="juges-${currentCompetition.publicSlug}.pdf"`,
      )
      return c.body(new Uint8Array(pdfBytes))
    },
  )

  return app
}
