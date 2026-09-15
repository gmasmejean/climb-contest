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
export const competitionSchema = createSelectSchema(competition)
export const categorySchema = createSelectSchema(category)
export const competitorSchema = createSelectSchema(competitor)
export const routeSchema = createSelectSchema(route)
export const routeCategorySchema = createSelectSchema(routeCategory)
export const roundSchema = createSelectSchema(round)
export const roundRouteSchema = createSelectSchema(roundRoute)
export const judgeSchema = createSelectSchema(judge)
export const judgeRouteSchema = createSelectSchema(judgeRoute)
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
