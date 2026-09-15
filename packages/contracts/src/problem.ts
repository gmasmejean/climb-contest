import { z } from 'zod'

/** RFC 9457 (`application/problem+json`) — voir ROADMAP.md Lot 1, point 5. */
export const problemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  instance: z.string().optional(),
})
export type ProblemDetails = z.infer<typeof problemDetailsSchema>
