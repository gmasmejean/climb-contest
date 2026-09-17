import {
  judgeAuthInputSchema,
  type JudgeAccessInfo,
  type JudgeMe,
  type JudgeSession,
} from '@climbcontest/contracts'
import {
  competition,
  hashToken,
  judge,
  judgeRoute,
  route,
  verifyPassword,
  type Database,
} from '@climbcontest/db'
import { zValidator } from '@hono/zod-validator'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { Hono } from 'hono'

import type { JudgeTokenSigner } from '../lib/jwt'
import { requireJudge } from '../middleware/judge-auth'
import { ApiError, problem } from '../middleware/problem'
import { authRateLimiter } from '../middleware/rate-limit'

export interface JudgeAuthRouteDeps {
  db: Database
  judgeTokenSigner: JudgeTokenSigner
}

const PIN_MAX_ATTEMPTS = 5
const PIN_LOCKOUT_MS = 15 * 60 * 1000
const JUDGE_SESSION_GRACE_MS = 12 * 60 * 60 * 1000

const INVALID_LINK = () =>
  new ApiError(404, 'Lien invalide', "Ce lien n'est plus valide — contactez l'organisateur.")

async function findJudgeByToken(db: Database, token: string) {
  const prefix = token.slice(0, 8)
  const candidates = await db.query.judge.findMany({
    where: and(eq(judge.accessTokenPrefix, prefix), isNull(judge.deletedAt)),
  })
  const tokenHash = hashToken(token)
  return candidates.find((row) => row.accessTokenHash === tokenHash) ?? null
}

async function assignedRoutesForJudge(db: Database, judgeId: string) {
  return db
    .select({ id: route.id, number: route.number, name: route.name, holdCount: route.holdCount })
    .from(judgeRoute)
    .innerJoin(route, eq(judgeRoute.routeId, route.id))
    .where(and(eq(judgeRoute.judgeId, judgeId), isNull(route.deletedAt)))
    .orderBy(asc(route.number))
}

function remainingLockMinutes(lockedUntil: Date): number {
  return Math.max(1, Math.ceil((lockedUntil.getTime() - Date.now()) / 60_000))
}

export function createJudgeAuthRoutes(deps: JudgeAuthRouteDeps): Hono {
  const app = new Hono()
  const { db, judgeTokenSigner } = deps

  // Par IP, en plus du verrou par juge en base (SPEC.md § 6.4) — évite
  // qu'une même IP énumère beaucoup de jetons différents rapidement.
  const judgeRateLimiter = authRateLimiter(30, 15 * 60 * 1000)

  app.get('/access/:token', judgeRateLimiter, async (c) => {
    const token = c.req.param('token')
    const found = await findJudgeByToken(db, token)
    if (!found || found.revokedAt) throw INVALID_LINK()

    const response: JudgeAccessInfo = {
      displayName: found.displayName,
      pinRequired: found.pinHash !== null,
    }
    return c.json(response)
  })

  app.post(
    '/auth',
    judgeRateLimiter,
    zValidator('json', judgeAuthInputSchema, (result, c) => {
      if (!result.success)
        return problem(c, 400, 'Requête invalide', result.error.issues[0]?.message)
    }),
    async (c) => {
      const { token, pin } = c.req.valid('json')
      const found = await findJudgeByToken(db, token)
      if (!found || found.revokedAt) throw INVALID_LINK()

      if (found.pinHash) {
        if (!pin) {
          throw new ApiError(400, 'Code requis', 'Ce juge nécessite un code à 6 chiffres.')
        }
        if (found.lockedUntil && found.lockedUntil.getTime() > Date.now()) {
          throw new ApiError(
            423,
            'Trop de tentatives',
            `Trop de tentatives — réessayez dans ${remainingLockMinutes(found.lockedUntil)} minute(s).`,
          )
        }
        const validPin = await verifyPassword(found.pinHash, pin)
        if (!validPin) {
          const attempts = found.pinAttempts + 1
          const locked = attempts >= PIN_MAX_ATTEMPTS
          await db
            .update(judge)
            .set({
              pinAttempts: locked ? 0 : attempts,
              lockedUntil: locked ? new Date(Date.now() + PIN_LOCKOUT_MS) : null,
            })
            .where(eq(judge.id, found.id))
          if (locked) {
            throw new ApiError(
              423,
              'Trop de tentatives',
              'Trop de tentatives — réessayez dans 15 minutes.',
            )
          }
          throw new ApiError(
            401,
            'Code incorrect',
            `Code incorrect — ${PIN_MAX_ATTEMPTS - attempts} tentative(s) restante(s).`,
          )
        }
      }

      const currentCompetition = await db.query.competition.findFirst({
        where: eq(competition.id, found.competitionId),
      })
      if (!currentCompetition) throw INVALID_LINK()

      await db
        .update(judge)
        .set({ pinAttempts: 0, lockedUntil: null, lastSeenAt: new Date() })
        .where(eq(judge.id, found.id))

      const endOfCompetitionDay = new Date(`${currentCompetition.endsOn}T23:59:59.999`)
      const expiresAt = new Date(endOfCompetitionDay.getTime() + JUDGE_SESSION_GRACE_MS)
      const jwt = await judgeTokenSigner.sign(
        { sub: found.id, competitionId: found.competitionId },
        expiresAt,
      )
      const routes = await assignedRoutesForJudge(db, found.id)

      const response: JudgeSession = {
        token: jwt,
        judge: { id: found.id, displayName: found.displayName, routes },
      }
      return c.json(response)
    },
  )

  app.get('/me', requireJudge(judgeTokenSigner, db), async (c) => {
    const currentJudge = c.get('judge')
    const routes = await assignedRoutesForJudge(db, currentJudge.id)
    const response: JudgeMe = {
      id: currentJudge.id,
      displayName: currentJudge.displayName,
      routes,
    }
    return c.json(response)
  })

  return app
}
