import { z } from 'zod'

export const createCompetitorInputSchema = z.object({
  categoryId: z.uuid(),
  bib: z.number().int().positive().nullable().optional(),
  firstName: z.string().trim().min(1).max(120),
  lastName: z.string().trim().min(1).max(120),
  birthYear: z.number().int().min(1900).max(2200).nullable().optional(),
  clubName: z.string().trim().max(200).nullable().optional(),
  licenseNumber: z.string().trim().max(50).nullable().optional(),
})
export type CreateCompetitorInput = z.infer<typeof createCompetitorInputSchema>

/**
 * Le changement de catégorie est autorisé ici (contrôlé côté API par
 * ADR-005 : bloqué dès qu'un passage existe). Le statut du compétiteur
 * (présent/absent/abandon/disqualifié) n'est volontairement pas éditable —
 * c'est le pilotage jour J, Lot 8.
 */
export const updateCompetitorInputSchema = createCompetitorInputSchema.partial()
export type UpdateCompetitorInput = z.infer<typeof updateCompetitorInputSchema>

export const importCompetitorsInputSchema = z.object({
  csv: z.string().min(1),
  mode: z.enum(['preview', 'commit']),
})
export type ImportCompetitorsInput = z.infer<typeof importCompetitorsInputSchema>

export const importRowSchema = z.object({
  line: z.number().int().positive(),
  bib: z.number().int().positive().nullable(),
  firstName: z.string(),
  lastName: z.string(),
  categoryLabel: z.string(),
  birthYear: z.number().int().nullable(),
  clubName: z.string().nullable(),
  licenseNumber: z.string().nullable(),
  errors: z.array(z.string()),
})
export type ImportRow = z.infer<typeof importRowSchema>

export const importReportSchema = z.object({
  committed: z.boolean(),
  totalRows: z.number().int(),
  validRows: z.number().int(),
  rows: z.array(importRowSchema),
})
export type ImportReport = z.infer<typeof importReportSchema>
