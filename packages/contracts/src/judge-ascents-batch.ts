import { z } from 'zod'

import { ascentShapeFields } from './ascent'
import { ascentSchema } from './entities'

/**
 * `POST /judge/ascents/batch` (Lot 6, SPEC.md § 6.3/§ 7). Contrairement à
 * `correctLastAscentInputSchema` (Lot 5, `.../ascents/last/correct`), une
 * correction en lot porte un `supersedesId` EXPLICITE plutôt que de laisser
 * le serveur résoudre « la dernière saisie active du juge » — décision
 * documentée en DECISIONS.md ADR-032 : un lot mélange créations/corrections
 * sur plusieurs compétiteurs dans un ordre d'arrivée réseau qui ne reflète
 * pas l'ordre chronologique de saisie, et peut être rejoué après un échec
 * partiel. Le client sait déjà, au moment de la saisie, quel `ascent.id`
 * précis il corrige.
 */
const batchCreateItemSchema = z.object({
  kind: z.literal('create'),
  id: z.uuid(), // uuid v7 généré côté client, SPEC.md § 5
  roundId: z.uuid(),
  routeId: z.uuid(),
  competitorId: z.uuid(),
  recordedAt: z.iso.datetime(),
  deviceId: z.string().trim().min(1).max(200),
  ...ascentShapeFields,
})

const batchCorrectItemSchema = z.object({
  kind: z.literal('correct'),
  id: z.uuid(), // nouvel ascent.id (successeur)
  supersedesId: z.uuid(), // ascent.id ciblé — explicite, contrairement au Lot 5
  ...ascentShapeFields,
})

export const judgeAscentBatchItemInputSchema = z
  .discriminatedUnion('kind', [batchCreateItemSchema, batchCorrectItemSchema])
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
export type JudgeAscentBatchItemInput = z.infer<typeof judgeAscentBatchItemInputSchema>

export const judgeAscentsBatchInputSchema = z.object({
  items: z.array(judgeAscentBatchItemInputSchema).min(1).max(50),
})
export type JudgeAscentsBatchInput = z.infer<typeof judgeAscentsBatchInputSchema>

/**
 * Réponse par élément (jamais un tout-ou-rien de lot, SPEC.md § 6.3) :
 * `accepted`/`duplicate` = durablement en base (cas de test #21) ;
 * `conflict` = les deux valeurs conservées, `conflict_group` commun (cas de
 * test #22) ; `rejected` = motif métier, jamais réessayé automatiquement,
 * jamais abandonné silencieusement côté client.
 */
export const judgeAscentBatchResultSchema = z.discriminatedUnion('status', [
  z.object({ id: z.uuid(), status: z.literal('accepted'), ascent: ascentSchema }),
  z.object({ id: z.uuid(), status: z.literal('duplicate'), ascent: ascentSchema }),
  z.object({
    id: z.uuid(),
    status: z.literal('conflict'),
    conflictGroup: z.uuid(),
    existing: ascentSchema,
    incoming: ascentSchema,
  }),
  z.object({ id: z.uuid(), status: z.literal('rejected'), reason: z.string() }),
])
export type JudgeAscentBatchResult = z.infer<typeof judgeAscentBatchResultSchema>

export const judgeAscentsBatchResponseSchema = z.object({
  results: z.array(judgeAscentBatchResultSchema),
})
export type JudgeAscentsBatchResponse = z.infer<typeof judgeAscentsBatchResponseSchema>
