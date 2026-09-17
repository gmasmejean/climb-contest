import {
  createJudgeInputSchema,
  judgeSummarySchema,
  type JudgeCreated,
  type JudgePinRegenerated,
} from '@climbcontest/contracts'
import {
  hashPassword,
  hashToken,
  judge,
  judgeRoute,
  randomPin,
  randomToken,
  route,
  type Database,
} from '@climbcontest/db'
import { zValidator } from '@hono/zod-validator'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { Hono } from 'hono'

import type { Env } from '../env'
import type { AccessTokenSigner } from '../lib/jwt'
import { requireOrganizer } from '../middleware/auth'
import { requireCompetitionAccess } from '../middleware/competition-access'
import { ApiError, problem } from '../middleware/problem'

export interface JudgeRouteDeps {
  db: Database
  accessTokenSigner: AccessTokenSigner
  env: Env
}

async function routeIdsByJudge(db: Database, judgeIds: string[]): Promise<Map<string, string[]>> {
  if (judgeIds.length === 0) return new Map()
  const links = await db.query.judgeRoute.findMany({
    where: inArray(judgeRoute.judgeId, judgeIds),
  })
  const map = new Map<string, string[]>()
  for (const link of links) {
    const list = map.get(link.judgeId) ?? []
    list.push(link.routeId)
    map.set(link.judgeId, list)
  }
  return map
}

function toSummary(row: typeof judge.$inferSelect) {
  return judgeSummarySchema.parse({ ...row, hasPin: row.pinHash !== null })
}

export function createJudgeRoutes(deps: JudgeRouteDeps): Hono {
  const app = new Hono()
  const { db, accessTokenSigner, env } = deps

  app.use('*', requireOrganizer(accessTokenSigner), requireCompetitionAccess(db))

  app.get('/', async (c) => {
    const competitionId = c.get('competition').id
    const rows = await db.query.judge.findMany({
      where: and(eq(judge.competitionId, competitionId), isNull(judge.deletedAt)),
    })
    const routeIds = await routeIdsByJudge(
      db,
      rows.map((row) => row.id),
    )
    return c.json(rows.map((row) => ({ ...toSummary(row), routeIds: routeIds.get(row.id) ?? [] })))
  })

  app.post(
    '/',
    zValidator('json', createJudgeInputSchema, (result, c) => {
      if (!result.success) return problem(c, 400, 'Juge invalide', result.error.issues[0]?.message)
    }),
    async (c) => {
      const currentCompetition = c.get('competition')
      const input = c.req.valid('json')

      const ownRoutes = await db.query.route.findMany({
        where: and(
          inArray(route.id, input.routeIds),
          eq(route.competitionId, currentCompetition.id),
          isNull(route.deletedAt),
        ),
      })
      if (ownRoutes.length !== new Set(input.routeIds).size) {
        throw new ApiError(
          400,
          'Voie invalide',
          "Une des voies assignées n'appartient pas à cette compétition.",
        )
      }

      const accessToken = randomToken(32)
      // Le PIN suit le réglage de la compétition AU MOMENT de la création —
      // changer le réglage ensuite n'affecte jamais ce juge (DECISIONS.md
      // ADR-026).
      const pin = currentCompetition.judgePinRequired ? randomPin() : null

      const created = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(judge)
          .values({
            competitionId: currentCompetition.id,
            displayName: input.displayName,
            accessTokenHash: hashToken(accessToken),
            accessTokenPrefix: accessToken.slice(0, 8),
            pinHash: pin ? await hashPassword(pin) : null,
          })
          .returning()
        if (!row) throw new ApiError(500, 'Erreur interne', 'Impossible de créer le juge.')
        await tx
          .insert(judgeRoute)
          .values(input.routeIds.map((routeId) => ({ judgeId: row.id, routeId })))
        return row
      })

      const response: JudgeCreated = {
        id: created.id,
        displayName: created.displayName,
        accessToken,
        accessUrl: `${env.PUBLIC_APP_URL}/j/${accessToken}`,
        ...(pin ? { pin } : {}),
      }
      return c.json(response, 201)
    },
  )

  app.post('/:jid/revoke', async (c) => {
    const currentCompetition = c.get('competition')
    const jid = c.req.param('jid')

    const existing = await db.query.judge.findFirst({
      where: and(
        eq(judge.id, jid),
        eq(judge.competitionId, currentCompetition.id),
        isNull(judge.deletedAt),
      ),
    })
    if (!existing) throw new ApiError(404, 'Juge introuvable', "Ce juge n'existe pas.")

    const [updated] = await db
      .update(judge)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(eq(judge.id, jid))
      .returning()
    if (!updated) throw new ApiError(500, 'Erreur interne', 'Impossible de révoquer le juge.')

    const routeIds = await routeIdsByJudge(db, [jid])
    return c.json({ ...toSummary(updated), routeIds: routeIds.get(jid) ?? [] })
  })

  app.post('/:jid/regenerate-pin', async (c) => {
    const currentCompetition = c.get('competition')
    const jid = c.req.param('jid')

    const existing = await db.query.judge.findFirst({
      where: and(
        eq(judge.id, jid),
        eq(judge.competitionId, currentCompetition.id),
        isNull(judge.deletedAt),
      ),
    })
    if (!existing) throw new ApiError(404, 'Juge introuvable', "Ce juge n'existe pas.")
    if (!existing.pinHash) {
      throw new ApiError(
        409,
        'Pas de PIN pour ce juge',
        "Ce juge a été créé sans PIN — il utilise l'accès par lien seul. Révoquez-le et recréez-le pour lui attribuer un PIN.",
      )
    }

    const pin = randomPin()
    await db
      .update(judge)
      .set({
        pinHash: await hashPassword(pin),
        pinAttempts: 0,
        lockedUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(judge.id, jid))

    const response: JudgePinRegenerated = { id: jid, pin }
    return c.json(response)
  })

  return app
}
