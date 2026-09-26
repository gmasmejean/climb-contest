import { z } from 'zod'

import { ascentSchema } from './entities'
import { routePhotoSchema } from './route-photo'

/**
 * Champs communs à la création et à la correction d'un passage — reflètent
 * le CHECK `ascent_status_shape_check` (packages/db/src/schema.ts). DSQ est
 * une valeur de colonne valide, mais n'est jamais proposée au juge (Lot 5,
 * voir DECISIONS.md) — seul l'organisateur (Lot 8) pourra l'écrire.
 */
export const ascentShapeFields = {
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

/**
 * Champs de forme organisateur (Lot 8) : seule différence avec
 * `ascentShapeFields` — `status` accepte aussi `dsq`, que le juge ne voit
 * jamais (voir commentaire de `ascentShapeFields` ci-dessus).
 */
const organizerAscentShapeFields = {
  ...ascentShapeFields,
  status: z.enum(['valid', 'dns', 'dnf', 'dsq']),
}

/** Saisie de secours (Lot 8) : l'organisateur crée un passage à la place d'un juge. */
export const createAscentByOrganizerInputSchema = z
  .object({
    roundId: z.uuid(),
    routeId: z.uuid(),
    competitorId: z.uuid(),
    recordedAt: z.iso.datetime(),
    ...organizerAscentShapeFields,
  })
  .refine((v) => (v.status !== 'valid' ? v.holdNumber === null && !v.isTop : true), {
    message: 'DNS/DNF/DSQ ne peuvent pas porter de numéro de prise.',
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
export type CreateAscentByOrganizerInput = z.infer<typeof createAscentByOrganizerInputSchema>

/** Réponse de la saisie de secours — même forme que `judgeAscentBatchResultSchema`, sans `id` (un seul passage, pas de lot). */
export const organizerAscentWriteResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('accepted'), ascent: ascentSchema }),
  z.object({ status: z.literal('duplicate'), ascent: ascentSchema }),
  z.object({
    status: z.literal('conflict'),
    conflictGroup: z.uuid(),
    existing: ascentSchema,
    incoming: ascentSchema,
  }),
])
export type OrganizerAscentWriteResult = z.infer<typeof organizerAscentWriteResultSchema>

/**
 * Correction organisateur (Lot 8, SPEC.md § 3.1) : motif obligatoire,
 * contrairement à la correction juge (ADR-007). Contrairement à la saisie
 * de secours ci-dessus, ne porte pas roundId/routeId/competitorId — une
 * correction rectifie les valeurs d'un passage réel, jamais son
 * affectation.
 */
export const correctAscentByOrganizerInputSchema = z
  .object({
    reason: z.string().trim().min(1).max(500),
    ...organizerAscentShapeFields,
  })
  .refine((v) => (v.status !== 'valid' ? v.holdNumber === null && !v.isTop : true), {
    message: 'DNS/DNF/DSQ ne peuvent pas porter de numéro de prise.',
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
export type CorrectAscentByOrganizerInput = z.infer<typeof correctAscentByOrganizerInputSchema>

/**
 * `GET .../ascents?roundId=&routeId=` (Lot 8, onglet Pilotage « Voies ») —
 * même besoin que l'écran juge (qui compétiteur a déjà un passage sur cette
 * voie, dans ce tour) mais côté organisateur, pour choisir un compétiteur à
 * corriger ou à saisir en secours.
 */
export const organizerRouteAscentsQuerySchema = z.object({
  roundId: z.uuid(),
  routeId: z.uuid(),
})
export type OrganizerRouteAscentsQuery = z.infer<typeof organizerRouteAscentsQuerySchema>

/**
 * `GET .../ascents/matrix?roundId=&categoryId=` (Lot 20) — la grille
 * compétiteurs × voies du pilotage jour J.
 *
 * L'agrégat est borné au couple (tour, catégorie) : c'est l'unité du
 * classement, les voies y sont les mêmes pour tout le monde, et la réponse
 * reste de l'ordre de 30 × 4. Une matrice « toute la compétition » mêlerait
 * des voies qui ne concernent pas toutes les catégories.
 */
export const ascentMatrixQuerySchema = z.object({
  roundId: z.uuid(),
  categoryId: z.uuid(),
})
export type AscentMatrixQuery = z.infer<typeof ascentMatrixQuerySchema>

export const ascentMatrixRouteSchema = z.object({
  routeId: z.uuid(),
  number: z.number(),
  name: z.string().nullable(),
  holdCount: z.number(),
})

const ascentMatrixValueSchema = z.object({
  id: z.uuid(),
  holdNumber: z.number().nullable(),
  modifier: z.enum(['none', 'plus']),
  isTop: z.boolean(),
  status: z.enum(['valid', 'dns', 'dnf', 'dsq']),
  climbTimeMs: z.number().nullable(),
  recordedAt: z.iso.datetime(),
})

export const ascentMatrixCellSchema = z.object({
  routeId: z.uuid(),
  /** Le passage qui compte au classement, ou `null` s'il n'y en a pas. */
  ascent: ascentMatrixValueSchema.nullable(),
  /**
   * Une saisie existe mais reste à trancher dans l'onglet Conflits. Sans ce
   * drapeau la case serait vide, donc indiscernable d'un passage manquant —
   * or l'un veut dire « allez voir le juge » et l'autre « allez trancher ».
   */
  conflict: z.boolean(),
})

export const ascentMatrixCompetitorSchema = z.object({
  competitorId: z.uuid(),
  bib: z.number().nullable(),
  firstName: z.string(),
  lastName: z.string(),
  cells: z.array(ascentMatrixCellSchema),
})

export const ascentMatrixResponseSchema = z.object({
  roundId: z.uuid(),
  categoryId: z.uuid(),
  routes: z.array(ascentMatrixRouteSchema),
  competitors: z.array(ascentMatrixCompetitorSchema),
})
export type AscentMatrixResponse = z.infer<typeof ascentMatrixResponseSchema>
export type AscentMatrixCell = z.infer<typeof ascentMatrixCellSchema>
export type AscentMatrixCompetitor = z.infer<typeof ascentMatrixCompetitorSchema>
export type AscentMatrixRoute = z.infer<typeof ascentMatrixRouteSchema>

export const judgeRouteCategorySchema = z.object({
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
    // Lot 6 : nécessaire pour que `GET /judge/bootstrap` remplace aussi
    // `GET /routes` côté client (SPEC.md § 6.3 — plus aucune lecture réseau
    // après le bootstrap initial), qui exposait déjà cette information.
    categories: z.array(judgeRouteCategorySchema),
    // Lot 15 (ADR-066) : l'identifiant de la photo et ses prises, pas les octets
    // (le client les télécharge à part, une fois par identifiant). `default(null)` :
    // un détail mis en cache par la version précédente n'a pas ce champ.
    photo: routePhotoSchema.nullable().default(null),
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
