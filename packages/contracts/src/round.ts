import { z } from 'zod'

export const roundTypeSchema = z.enum(['qualification', 'semifinal', 'final'])
export const roundStyleSchema = z.enum(['flash', 'onsight'])

export const createRoundInputSchema = z.object({
  type: roundTypeSchema,
  style: roundStyleSchema,
  qualifyingCount: z.number().int().positive().nullable().optional(),
})
export type CreateRoundInput = z.infer<typeof createRoundInputSchema>

export const updateRoundInputSchema = createRoundInputSchema.partial()
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
