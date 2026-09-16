import { z } from 'zod'

export const competitionFormatSchema = z.enum(['contest', 'phases'])
export const competitionStatusSchema = z.enum(['draft', 'open', 'running', 'closed', 'archived'])

export const createCompetitionInputSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    venue: z.string().trim().min(1).max(200),
    startsOn: z.iso.date(),
    endsOn: z.iso.date(),
    format: competitionFormatSchema,
    scoringEngineId: z.string().trim().min(1),
    // Validé finement côté API via `engine.configSchema.parse` — ce paquet
    // ne connaît pas la forme exacte par moteur (voir DECISIONS.md).
    scoringConfig: z.unknown().optional(),
  })
  .refine((input) => input.endsOn >= input.startsOn, {
    message: 'La date de fin doit être postérieure ou égale à la date de début.',
    path: ['endsOn'],
  })
export type CreateCompetitionInput = z.infer<typeof createCompetitionInputSchema>

/**
 * `format`, `scoringEngineId` et `scoringConfig` ne sont volontairement pas
 * éditables après création : en changer une fois des catégories/voies
 * saisies invaliderait le round implicite du format contest (voir
 * DECISIONS.md) et la configuration de cotation déjà utilisée.
 */
export const updateCompetitionInputSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    venue: z.string().trim().min(1).max(200),
    startsOn: z.iso.date(),
    endsOn: z.iso.date(),
  })
  .partial()
  .refine(
    (input) =>
      input.startsOn === undefined || input.endsOn === undefined || input.endsOn >= input.startsOn,
    {
      message: 'La date de fin doit être postérieure ou égale à la date de début.',
      path: ['endsOn'],
    },
  )
export type UpdateCompetitionInput = z.infer<typeof updateCompetitionInputSchema>

export const changeStatusInputSchema = z.object({ status: competitionStatusSchema })
export type ChangeStatusInput = z.infer<typeof changeStatusInputSchema>

export const readinessCheckIdSchema = z.enum([
  'category_without_route',
  'route_without_category',
  'competitor_without_bib',
  'round_without_route',
])

export const readinessCheckSchema = z.object({
  id: readinessCheckIdSchema,
  ok: z.boolean(),
  items: z.array(z.object({ id: z.string(), label: z.string() })),
})

export const readinessResponseSchema = z.object({
  ready: z.boolean(),
  checks: z.array(readinessCheckSchema),
})
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>
