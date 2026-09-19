import { z } from 'zod'

/** Lot 9 — `GET .../exports/results.{csv,pdf}` : une catégorie, ou toutes si omise. */
export const resultsExportQuerySchema = z.object({ category: z.uuid().optional() })
export type ResultsExportQuery = z.infer<typeof resultsExportQuerySchema>
