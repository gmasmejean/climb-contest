import { z } from 'zod'

export const roundTypeSchema = z.enum(['qualification', 'semifinal', 'final'])
export const roundStyleSchema = z.enum(['flash', 'onsight'])
export const roundStatusSchema = z.enum(['draft', 'open', 'closed', 'published'])

export const createRoundInputSchema = z.object({
  type: roundTypeSchema,
  style: roundStyleSchema,
  qualifyingCount: z.number().int().positive().nullable().optional(),
})
export type CreateRoundInput = z.infer<typeof createRoundInputSchema>

/**
 * `status` reste accepté par le PATCH générique existant plutôt que par une
 * nouvelle route dédiée : le vrai tableau de bord d'ouverture/clôture des
 * tours (garde-fous de transition, alertes, publication des résultats) est
 * le Lot 8 — voir DECISIONS.md ADR-030. Ce champ ne fait que débloquer la
 * colonne déjà modélisée depuis le Lot 1 (`round_status_check`), sans
 * construire ce lot en avance.
 */
export const updateRoundInputSchema = createRoundInputSchema.partial().extend({
  status: roundStatusSchema.optional(),
})
export type UpdateRoundInput = z.infer<typeof updateRoundInputSchema>

export const reorderRoundsInputSchema = z.object({
  orderedIds: z.array(z.uuid()).min(1),
})
export type ReorderRoundsInput = z.infer<typeof reorderRoundsInputSchema>

export const setRoundRoutesInputSchema = z.object({
  assignments: z.array(
    z.object({
      routeId: z.uuid(),
      categoryId: z.uuid(),
    }),
  ),
})
export type SetRoundRoutesInput = z.infer<typeof setRoundRoutesInputSchema>
