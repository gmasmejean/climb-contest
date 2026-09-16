import { z } from 'zod'

export const categorySexSchema = z.enum(['M', 'F', 'X'])

export const createCategoryInputSchema = z.object({
  label: z.string().trim().min(1).max(120),
  sex: categorySexSchema,
  birthYearMin: z.number().int().min(1900).max(2200).nullable().optional(),
  birthYearMax: z.number().int().min(1900).max(2200).nullable().optional(),
})
export type CreateCategoryInput = z.infer<typeof createCategoryInputSchema>

export const updateCategoryInputSchema = createCategoryInputSchema.partial()
export type UpdateCategoryInput = z.infer<typeof updateCategoryInputSchema>

export const reorderCategoriesInputSchema = z.object({
  orderedIds: z.array(z.uuid()).min(1),
})
export type ReorderCategoriesInput = z.infer<typeof reorderCategoriesInputSchema>
