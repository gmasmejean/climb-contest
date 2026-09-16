import { z } from 'zod'

export const createRouteInputSchema = z.object({
  number: z.number().int().positive(),
  name: z.string().trim().max(120).nullable().optional(),
  holdCount: z.number().int().positive(),
  sector: z.string().trim().max(120).nullable().optional(),
  color: z.string().trim().max(50).nullable().optional(),
  videoUrl: z.url().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  categoryIds: z.array(z.uuid()).default([]),
})
export type CreateRouteInput = z.infer<typeof createRouteInputSchema>

/**
 * `holdCount` reste dans le schéma de saisie mais son édition est bloquée
 * côté API dès qu'un passage existe sur la voie (ADR-004) — pas un souci de
 * validation de forme, donc pas modélisé ici.
 */
export const updateRouteInputSchema = createRouteInputSchema.partial()
export type UpdateRouteInput = z.infer<typeof updateRouteInputSchema>

export const reorderRoutesInputSchema = z.object({
  orderedIds: z.array(z.uuid()).min(1),
})
export type ReorderRoutesInput = z.infer<typeof reorderRoutesInputSchema>
