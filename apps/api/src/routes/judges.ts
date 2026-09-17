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
import { judgeAccessEmail } from '../lib/email-templates'
import type { AccessTokenSigner } from '../lib/jwt'
import type { Mailer } from '../lib/mailer'
import { requireOrganizer } from '../middleware/auth'
import { requireCompetitionAccess } from '../middleware/competition-access'
import { ApiError, problem } from '../middleware/problem'

export interface JudgeRouteDeps {
  db: Database
  accessTokenSigner: AccessTokenSigner
  env: Env
  mailer: Mailer
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

/**
 * `accessUrl`/`pin` ne sont présents que si `competition.judgeCredentialsStored`
 * était actif au moment de l'action qui les a produits (création, ou
 * régénération pour `pin`) — DECISIONS.md ADR-027. Jamais les hachés, jamais
 * `accessTokenPlain` brut (reconstruit en URL complète ici).
 */
function toDetail(row: typeof judge.$inferSelect, env: Env) {
  const summary = judgeSummarySchema.parse({ ...row, hasPin: row.pinHash !== null })
  return {
    ...summary,
    accessUrl: row.accessTokenPlain ? `${env.PUBLIC_APP_URL}/j/${row.accessTokenPlain}` : undefined,
    pin: row.pinPlain ?? undefined,
  }
}

export function createJudgeRoutes(deps: JudgeRouteDeps): Hono {
  const app = new Hono()
  const { db, accessTokenSigner, env, mailer } = deps

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
    return c.json(
      rows.map((row) => ({ ...toDetail(row, env), routeIds: routeIds.get(row.id) ?? [] })),
    )
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
      // ADR-026). Même logique pour la conservation en clair (ADR-027).
      const pin = currentCompetition.judgePinRequired ? randomPin() : null
      const storeCredentials = currentCompetition.judgeCredentialsStored
      const accessUrl = `${env.PUBLIC_APP_URL}/j/${accessToken}`

      const created = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(judge)
          .values({
            competitionId: currentCompetition.id,
            displayName: input.displayName,
            accessTokenHash: hashToken(accessToken),
            accessTokenPrefix: accessToken.slice(0, 8),
            accessTokenPlain: storeCredentials ? accessToken : null,
            pinHash: pin ? await hashPassword(pin) : null,
            pinPlain: storeCredentials ? pin : null,
          })
          .returning()
        if (!row) throw new ApiError(500, 'Erreur interne', 'Impossible de créer le juge.')
        await tx
          .insert(judgeRoute)
          .values(input.routeIds.map((routeId) => ({ judgeId: row.id, routeId })))
        return row
      })

      // Envoi de l'e-mail : au mieux, jamais bloquant — l'organisateur garde
      // l'accès affiché à l'écran même si la remise échoue (SMTP indisponible,
      // adresse invalide côté serveur de destination, etc.).
      let emailSent: boolean | undefined
      if (input.email) {
        try {
          const { subject, html } = judgeAccessEmail(
            input.displayName,
            currentCompetition.name,
            accessUrl,
          )
          await mailer.send(input.email, subject, html)
          emailSent = true
        } catch {
          emailSent = false
        }
      }

      const response: JudgeCreated = {
        id: created.id,
        displayName: created.displayName,
        accessToken,
        accessUrl,
        ...(pin ? { pin } : {}),
        ...(emailSent !== undefined ? { emailSent } : {}),
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
      // Un accès révoqué ne sert plus à rien — on n'a aucune raison de
      // garder le clair en base au-delà (même logique que la désactivation
      // du réglage de la compétition, ADR-027).
      .set({
        revokedAt: new Date(),
        accessTokenPlain: null,
        pinPlain: null,
        updatedAt: new Date(),
      })
      .where(eq(judge.id, jid))
      .returning()
    if (!updated) throw new ApiError(500, 'Erreur interne', 'Impossible de révoquer le juge.')

    const routeIds = await routeIdsByJudge(db, [jid])
    return c.json({ ...toDetail(updated, env), routeIds: routeIds.get(jid) ?? [] })
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
    // Contrairement au choix fait à la création (fixé pour la vie du juge),
    // la régénération suit le réglage ACTUEL de la compétition — une action
    // ponctuelle, pas une propriété du juge (DECISIONS.md ADR-027).
    const pinPlain = currentCompetition.judgeCredentialsStored ? pin : null
    await db
      .update(judge)
      .set({
        pinHash: await hashPassword(pin),
        pinPlain,
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
