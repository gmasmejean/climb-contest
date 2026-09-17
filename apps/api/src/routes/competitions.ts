import {
  changeStatusInputSchema,
  competitionSchema,
  createCompetitionInputSchema,
  updateCompetitionInputSchema,
} from '@climbcontest/contracts'
import { competition, judge, randomToken, round, type Database } from '@climbcontest/db'
import { getScoringEngine } from '@climbcontest/scoring'
import { zValidator } from '@hono/zod-validator'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { Hono } from 'hono'

import type { AccessTokenSigner } from '../lib/jwt'
import { computeReadiness } from '../lib/readiness'
import { requireCompetitionAccess } from '../middleware/competition-access'
import { requireOrganizer } from '../middleware/auth'
import { ApiError, problem } from '../middleware/problem'

export interface CompetitionRouteDeps {
  db: Database
  accessTokenSigner: AccessTokenSigner
}

/**
 * Longueur du `public_slug` (SPEC.md §6.4 : 22 caractères base62, non
 * devinable). `randomToken` a une telle entropie qu'une collision est
 * négligeable — pas de boucle de nouvelle tentative comme pour le slug
 * (lisible par un humain, donc bien plus collision-prone) du club dans
 * `routes/auth.ts`.
 */
const PUBLIC_SLUG_LENGTH = 22

/**
 * Le moteur `ffme-difficulty-2026` (Lot 2) exige `routesCounted` dans sa
 * config quel que soit le format de compétition (ADR-021 : sa signature ne
 * connaît pas le format). En mode phases, ce nombre n'a aucun sens
 * métier — le formulaire de création ne le demande pas — donc on fournit
 * une valeur neutre par défaut plutôt que d'imposer ce champ à
 * l'organisateur. Voir DECISIONS.md.
 */
const PHASES_DEFAULT_SCORING_CONFIG = { routesCounted: 1 }

export function createCompetitionRoutes(deps: CompetitionRouteDeps): Hono {
  const app = new Hono()
  const { db, accessTokenSigner } = deps

  app.use('*', requireOrganizer(accessTokenSigner))

  app.get('/', async (c) => {
    const organizer = c.get('organizer')
    const rows = await db.query.competition.findMany({
      where: and(eq(competition.clubId, organizer.clubId), isNull(competition.deletedAt)),
      orderBy: [desc(competition.startsOn)],
    })
    return c.json(rows.map((row) => competitionSchema.parse(row)))
  })

  app.post(
    '/',
    zValidator('json', createCompetitionInputSchema, (result, c) => {
      if (!result.success) {
        return problem(c, 400, 'Compétition invalide', result.error.issues[0]?.message)
      }
    }),
    async (c) => {
      const organizer = c.get('organizer')
      const input = c.req.valid('json')

      let engine
      try {
        engine = getScoringEngine(input.scoringEngineId)
      } catch {
        throw new ApiError(
          400,
          'Moteur de cotation inconnu',
          `« ${input.scoringEngineId} » n'est pas un moteur de cotation reconnu.`,
        )
      }

      const rawConfig =
        input.scoringConfig ??
        (input.format === 'phases' ? PHASES_DEFAULT_SCORING_CONFIG : undefined)
      let scoringConfig: unknown
      try {
        scoringConfig = engine.configSchema.parse(rawConfig)
      } catch (error) {
        throw new ApiError(
          400,
          'Configuration de cotation invalide',
          error instanceof Error ? error.message : undefined,
        )
      }

      const created = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(competition)
          .values({
            clubId: organizer.clubId,
            name: input.name,
            venue: input.venue,
            startsOn: input.startsOn,
            endsOn: input.endsOn,
            format: input.format,
            scoringEngineId: input.scoringEngineId,
            scoringConfig,
            publicSlug: randomToken(PUBLIC_SLUG_LENGTH),
            createdBy: organizer.sub,
          })
          .returning()
        if (!row) {
          throw new ApiError(500, 'Erreur interne', 'Impossible de créer la compétition.')
        }

        if (input.format === 'contest') {
          // Round implicite (DECISIONS.md) : invisible pour l'organisateur,
          // synchronisé avec route_category par lib/contest-round.ts.
          await tx.insert(round).values({
            competitionId: row.id,
            type: 'qualification',
            style: 'onsight',
            displayOrder: 0,
          })
        }

        return row
      })

      return c.json(competitionSchema.parse(created), 201)
    },
  )

  app.get('/:id', requireCompetitionAccess(db), (c) => {
    return c.json(competitionSchema.parse(c.get('competition')))
  })

  app.patch(
    '/:id',
    requireCompetitionAccess(db),
    zValidator('json', updateCompetitionInputSchema, (result, c) => {
      if (!result.success)
        return problem(c, 400, 'Requête invalide', result.error.issues[0]?.message)
    }),
    async (c) => {
      const current = c.get('competition')
      const input = c.req.valid('json')

      const nextStartsOn = input.startsOn ?? current.startsOn
      const nextEndsOn = input.endsOn ?? current.endsOn
      if (nextEndsOn < nextStartsOn) {
        throw new ApiError(
          400,
          'Compétition invalide',
          'La date de fin doit être postérieure ou égale à la date de début.',
        )
      }

      const updated = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(competition)
          .set({ ...input, updatedAt: new Date() })
          .where(eq(competition.id, current.id))
          .returning()
        if (!row) {
          throw new ApiError(500, 'Erreur interne', 'Impossible de mettre à jour la compétition.')
        }
        // Désactiver la conservation en clair efface rétroactivement ce qui
        // est déjà stocké — sinon le réglage ne protégerait rien pour les
        // juges déjà créés (DECISIONS.md ADR-027). L'activer, à l'inverse,
        // ne s'applique qu'aux actions futures : on ne peut pas retrouver un
        // clair jamais stocké.
        if (input.judgeCredentialsStored === false) {
          await tx
            .update(judge)
            .set({ accessTokenPlain: null, pinPlain: null })
            .where(eq(judge.competitionId, current.id))
        }
        return row
      })
      return c.json(competitionSchema.parse(updated))
    },
  )

  app.post(
    '/:id/status',
    requireCompetitionAccess(db),
    zValidator('json', changeStatusInputSchema, (result, c) => {
      if (!result.success)
        return problem(c, 400, 'Requête invalide', result.error.issues[0]?.message)
    }),
    async (c) => {
      const current = c.get('competition')
      const { status } = c.req.valid('json')
      const [updated] = await db
        .update(competition)
        .set({ status, updatedAt: new Date() })
        .where(eq(competition.id, current.id))
        .returning()
      if (!updated)
        throw new ApiError(500, 'Erreur interne', 'Impossible de mettre à jour le statut.')
      return c.json(competitionSchema.parse(updated))
    },
  )

  app.get('/:id/readiness', requireCompetitionAccess(db), async (c) => {
    const current = c.get('competition')
    const readiness = await computeReadiness(db, current.id, current.format)
    return c.json(readiness)
  })

  return app
}
