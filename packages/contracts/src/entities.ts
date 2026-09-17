/**
 * Schémas Zod des entités, dérivés des tables Drizzle (`@climbcontest/db`) —
 * aucun champ recopié à la main. Voir ROADMAP.md Lot 1, point 4.
 *
 * Import délibérément profond vers `schema` (définitions de tables, pures)
 * plutôt que le barrel `@climbcontest/db` : celui-ci réexporte aussi
 * `client`/`crypto`/`migrate-shared`, qui tirent `pg`, `argon2` et des
 * modules Node — inutiles ici, et qui alourdissaient chaque bundle web
 * ne consommant qu'un simple schéma Zod (~560 Ko pour l'écran
 * d'inscription avant ce correctif).
 */
import {
  ascent,
  ascentEvent,
  category,
  club,
  competition,
  competitor,
  judge,
  judgeRoute,
  round,
  roundRoute,
  route,
  routeCategory,
  session,
  user,
} from '@climbcontest/db/src/schema'
import { createSelectSchema } from 'drizzle-zod'
import { z } from 'zod'

export const clubSchema = createSelectSchema(club)

/**
 * Les colonnes à choix fermé sont des `text` + `CHECK` SQL en base
 * (ADR-018 : pas d'ENUM Postgres natif), donc invisibles pour l'inférence
 * automatique de `drizzle-zod` — chacune est affinée explicitement ici vers
 * l'union littérale réelle plutôt que le `string` généré par défaut
 * (CLAUDE.md : « si le typage résiste, corrige le modèle »).
 */
export const competitionSchema = createSelectSchema(competition, {
  format: z.enum(['contest', 'phases']),
  status: z.enum(['draft', 'open', 'running', 'closed', 'archived']),
})
export type Competition = z.infer<typeof competitionSchema>
export const categorySchema = createSelectSchema(category, {
  sex: z.enum(['M', 'F', 'X']),
})
export type Category = z.infer<typeof categorySchema>
export const competitorSchema = createSelectSchema(competitor, {
  status: z.enum(['registered', 'present', 'withdrawn', 'disqualified']),
})
export type Competitor = z.infer<typeof competitorSchema>
export const routeSchema = createSelectSchema(route)
export type Route = z.infer<typeof routeSchema>
export const routeCategorySchema = createSelectSchema(routeCategory)
export const roundSchema = createSelectSchema(round, {
  type: z.enum(['qualification', 'semifinal', 'final']),
  style: z.enum(['flash', 'onsight']),
  status: z.enum(['draft', 'open', 'closed', 'published']),
})
export type Round = z.infer<typeof roundSchema>
export const roundRouteSchema = createSelectSchema(roundRoute)
export const judgeSchema = createSelectSchema(judge)
export const judgeRouteSchema = createSelectSchema(judgeRoute)

/**
 * Vue organisateur exposable au client : jamais `accessTokenHash` ni
 * `pinHash` (Lot 4). `hasPin` remplace la présence/absence de `pinHash` par
 * un booléen explicite, sans jamais exposer le hash lui-même.
 */
export const judgeSummarySchema = createSelectSchema(judge)
  .omit({ accessTokenHash: true, pinHash: true })
  .extend({ hasPin: z.boolean() })
export type JudgeSummary = z.infer<typeof judgeSummarySchema>
export const ascentSchema = createSelectSchema(ascent)
export const ascentEventSchema = createSelectSchema(ascentEvent)
export const sessionSchema = createSelectSchema(session)

/**
 * Vue organisateur exposable au client : jamais le hash de mot de passe ni
 * les jetons en attente (ADR-017).
 */
export const organizerSchema = createSelectSchema(user).omit({
  passwordHash: true,
  pendingTokenHash: true,
  pendingTokenPurpose: true,
  pendingTokenExpiresAt: true,
})
export type Organizer = z.infer<typeof organizerSchema>
