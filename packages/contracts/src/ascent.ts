import { z } from 'zod'

import { ascentSchema } from './entities'

/**
 * Champs communs à la création et à la correction d'un passage — reflètent
 * le CHECK `ascent_status_shape_check` (packages/db/src/schema.ts). DSQ est
 * une valeur de colonne valide, mais n'est jamais proposée au juge (Lot 5,
 * voir DECISIONS.md) — seul l'organisateur (Lot 8) pourra l'écrire.
 */
const ascentShapeFields = {
  holdNumber: z.number().int().min(1).nullable(),
  modifier: z.enum(['none', 'plus']),
  isTop: z.boolean(),
  status: z.enum(['valid', 'dns', 'dnf']),
  climbTimeMs: z.number().int().nonnegative().nullable().optional(),
}

export const createAscentInputSchema = z
  .object({
    id: z.uuid(), // uuid v7 généré côté client, SPEC.md § 5
    roundId: z.uuid(),
    routeId: z.uuid(),
    competitorId: z.uuid(),
    recordedAt: z.iso.datetime(),
    deviceId: z.string().trim().min(1).max(200),
    ...ascentShapeFields,
  })
  .refine((v) => (v.status !== 'valid' ? v.holdNumber === null && !v.isTop : true), {
    message: 'DNS/DNF ne peuvent pas porter de numéro de prise.',
    path: ['holdNumber'],
  })
  .refine((v) => (v.status === 'valid' && v.isTop ? v.holdNumber === null : true), {
    message: 'Un TOP ne porte pas de numéro de prise.',
    path: ['holdNumber'],
  })
  .refine((v) => (v.status === 'valid' && !v.isTop ? v.holdNumber !== null : true), {
    message: 'Un passage valide sans TOP doit indiquer une prise.',
    path: ['holdNumber'],
  })
export type CreateAscentInput = z.infer<typeof createAscentInputSchema>

/**
 * Pas de `reason` (contrairement à la correction organisateur, Lot 8) — la
 * correction du juge reste légère (ADR-007). Pas de
 * `roundId`/`routeId`/`competitorId` : une correction rectifie les valeurs
 * d'un passage réel, elle ne le réaffecte jamais à un autre compétiteur ou
 * une autre voie. La cible (« la dernière saisie active du juge ») est
 * résolue côté serveur, jamais passée par le client.
 */
export const correctLastAscentInputSchema = z
  .object({
    id: z.uuid(), // nouvel id généré côté client pour la ligne corrigée
    ...ascentShapeFields,
  })
  .refine((v) => (v.status !== 'valid' ? v.holdNumber === null && !v.isTop : true), {
    message: 'DNS/DNF ne peuvent pas porter de numéro de prise.',
    path: ['holdNumber'],
  })
  .refine((v) => (v.status === 'valid' && v.isTop ? v.holdNumber === null : true), {
    message: 'Un TOP ne porte pas de numéro de prise.',
    path: ['holdNumber'],
  })
  .refine((v) => (v.status === 'valid' && !v.isTop ? v.holdNumber !== null : true), {
    message: 'Un passage valide sans TOP doit indiquer une prise.',
    path: ['holdNumber'],
  })
export type CorrectLastAscentInput = z.infer<typeof correctLastAscentInputSchema>

const judgeRouteCategorySchema = z.object({
  id: z.uuid(),
  label: z.string(),
})

export const judgeRouteSummarySchema = z.object({
  id: z.uuid(),
  number: z.number(),
  name: z.string().nullable(),
  holdCount: z.number(),
  categories: z.array(judgeRouteCategorySchema),
  progress: z.object({ done: z.number(), expected: z.number() }).nullable(),
})
export const judgeRoutesResponseSchema = z.array(judgeRouteSummarySchema)
export type JudgeRouteSummary = z.infer<typeof judgeRouteSummarySchema>
export type JudgeRoutesResponse = z.infer<typeof judgeRoutesResponseSchema>

const judgeRouteCompetitorAscentSchema = z.object({
  id: z.uuid(),
  holdNumber: z.number().nullable(),
  modifier: z.enum(['none', 'plus']),
  isTop: z.boolean(),
  status: z.enum(['valid', 'dns', 'dnf', 'dsq']),
  climbTimeMs: z.number().nullable(),
  recordedAt: z.iso.datetime(),
})

export const judgeRouteCompetitorSchema = z.object({
  id: z.uuid(),
  bib: z.number().nullable(),
  firstName: z.string(),
  lastName: z.string(),
  categoryLabel: z.string(),
  ascent: judgeRouteCompetitorAscentSchema.nullable(),
})

export const judgeRouteDetailSchema = z.object({
  route: z.object({
    id: z.uuid(),
    number: z.number(),
    name: z.string().nullable(),
    holdCount: z.number(),
  }),
  round: z
    .object({ id: z.uuid(), type: z.enum(['qualification', 'semifinal', 'final']) })
    .nullable(),
  timingEnabled: z.boolean(),
  competitors: z.array(judgeRouteCompetitorSchema),
})
export type JudgeRouteDetail = z.infer<typeof judgeRouteDetailSchema>

/** `GET /judge/ascents/last` — support de la fenêtre de correction (ADR-007). */
export const judgeLastAscentSchema = z
  .object({
    ascent: ascentSchema,
    correctableUntil: z.iso.datetime(), // recordedAt + 5 min
  })
  .nullable()
export type JudgeLastAscent = z.infer<typeof judgeLastAscentSchema>
