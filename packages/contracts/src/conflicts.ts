import { z } from 'zod'

import { ascentSchema } from './entities'

/**
 * Un groupe de conflit (Lot 8, SPEC.md § 6.3) : deux (ou plus, en théorie)
 * `ascent` actifs pour le même (tour, voie, compétiteur), jamais résolus
 * silencieusement. `judgeDisplayName`/`deviceId` accompagnent chaque valeur
 * pour l'écran de résolution (« les deux valeurs côte à côte, avec le juge,
 * l'appareil et l'heure de chacune », ROADMAP.md Lot 8).
 */
export const conflictAscentSchema = z.object({
  ascent: ascentSchema,
  judgeDisplayName: z.string().nullable(),
})
export type ConflictAscent = z.infer<typeof conflictAscentSchema>

/**
 * `'conflict'` : au moins deux valeurs contradictoires, à départager.
 * `'revoked_access'` (Lot 21, ADR-078) : une SEULE valeur, reçue d'un accès
 * révoqué et mise en quarantaine — à accepter, refuser ou ressaisir. Dérivé du
 * nombre de lignes du groupe, jamais stocké.
 */
export const conflictKindSchema = z.enum(['conflict', 'revoked_access'])
export type ConflictKind = z.infer<typeof conflictKindSchema>

export const conflictSummarySchema = z.object({
  conflictGroup: z.uuid(),
  kind: conflictKindSchema,
  competitionId: z.uuid(),
  roundId: z.uuid(),
  routeId: z.uuid(),
  competitorId: z.uuid(),
  ascents: z.array(conflictAscentSchema).min(1),
})
export type ConflictSummary = z.infer<typeof conflictSummarySchema>

const organizerAscentShapeFields = {
  holdNumber: z.number().int().min(1).nullable(),
  modifier: z.enum(['none', 'plus']),
  isTop: z.boolean(),
  status: z.enum(['valid', 'dns', 'dnf', 'dsq']),
  climbTimeMs: z.number().int().nonnegative().nullable().optional(),
}

/**
 * `'choose'` : l'organisateur retient une des valeurs déjà saisies —
 * motif facultatif, le choix est sa propre justification. `'new_value'` :
 * aucune des deux n'était correcte, l'organisateur saisit une troisième
 * valeur — motif obligatoire, comme toute correction organisateur.
 * `'reject'` : réservé à une saisie en quarantaine, voir ci-dessous.
 */
export const resolveConflictInputSchema = z.discriminatedUnion('resolution', [
  z.object({
    resolution: z.literal('choose'),
    ascentId: z.uuid(),
    reason: z.string().trim().max(500).nullable().optional(),
  }),
  // ADR-078 : refuser une saisie en quarantaine (groupe à une seule ligne).
  // Motif obligatoire : c'est une saisie de juge qu'on écarte.
  z.object({
    resolution: z.literal('reject'),
    reason: z.string().trim().min(1).max(500),
  }),
  z
    .object({
      resolution: z.literal('new_value'),
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
    }),
])
export type ResolveConflictInput = z.infer<typeof resolveConflictInputSchema>
