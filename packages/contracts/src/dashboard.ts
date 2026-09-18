import { z } from 'zod'

import { roundStatusSchema } from './round'

/**
 * Lot 8 — tableau de bord jour J (ROADMAP.md). Rafraîchi par polling côté
 * client (TanStack Query `refetchInterval`), pas par SSE — voir DECISIONS.md.
 */
export const dashboardAlertSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('route_stalled'),
    routeId: z.uuid(),
    routeNumber: z.number(),
    roundId: z.uuid(),
    minutesSinceLastAscent: z.number().nullable(), // null = aucune saisie du tout
  }),
  z.object({
    type: z.literal('judge_silent'),
    judgeId: z.uuid(),
    judgeDisplayName: z.string(),
    minutesSinceLastSeen: z.number().nullable(), // null = jamais vu
  }),
  z.object({
    type: z.literal('unresolved_conflict'),
    conflictGroup: z.uuid(),
    routeId: z.uuid(),
    competitorId: z.uuid(),
  }),
  z.object({
    type: z.literal('competitor_no_ascent'),
    competitorId: z.uuid(),
    bib: z.number().nullable(),
    firstName: z.string(),
    lastName: z.string(),
    roundId: z.uuid(),
  }),
])
export type DashboardAlert = z.infer<typeof dashboardAlertSchema>

export const dashboardRouteProgressSchema = z.object({
  routeId: z.uuid(),
  number: z.number(),
  name: z.string().nullable(),
  roundId: z.uuid().nullable(),
  roundStatus: roundStatusSchema.nullable(),
  done: z.number(),
  expected: z.number(),
  lastAscentAt: z.iso.datetime().nullable(),
})

export const dashboardCategoryProgressSchema = z.object({
  categoryId: z.uuid(),
  label: z.string(),
  routes: z.array(dashboardRouteProgressSchema),
})

export const dashboardCompetitorPendingSchema = z.object({
  competitorId: z.uuid(),
  bib: z.number().nullable(),
  firstName: z.string(),
  lastName: z.string(),
  categoryLabel: z.string(),
  remainingRouteNumbers: z.array(z.number()),
})

export const dashboardJudgeStateSchema = z.object({
  judgeId: z.uuid(),
  displayName: z.string(),
  revokedAt: z.iso.datetime().nullable(),
  lastSeenAt: z.iso.datetime().nullable(),
  ascentCount: z.number(),
})

export const dashboardResponseSchema = z.object({
  computedAt: z.iso.datetime(),
  categories: z.array(dashboardCategoryProgressSchema),
  competitorsPending: z.array(dashboardCompetitorPendingSchema),
  judges: z.array(dashboardJudgeStateSchema),
  alerts: z.array(dashboardAlertSchema),
})
export type DashboardResponse = z.infer<typeof dashboardResponseSchema>

/**
 * Journal d'activité — fusion en mémoire de `activity_log` (tours,
 * compétiteurs) et `ascent_event` (passages, y compris les saisies juge
 * normales) — voir DECISIONS.md. `type` distingue les deux origines.
 */
export const activityLogEntrySchema = z.object({
  id: z.uuid(),
  type: z.enum([
    'round_status_changed',
    'competitor_status_changed',
    'ascent_created',
    'ascent_corrected',
    'ascent_voided',
    'conflict_resolved',
  ]),
  actorType: z.enum(['judge', 'organizer', 'system']),
  actorId: z.uuid().nullable(),
  actorLabel: z.string().nullable(), // nom du juge / de l'organisateur, résolu côté serveur
  payload: z.record(z.string(), z.unknown()),
  reason: z.string().nullable(),
  createdAt: z.iso.datetime(),
})
export type ActivityLogEntry = z.infer<typeof activityLogEntrySchema>

export const activityLogResponseSchema = z.object({
  entries: z.array(activityLogEntrySchema),
})
export type ActivityLogResponse = z.infer<typeof activityLogResponseSchema>

export const activityLogQuerySchema = z.object({
  type: activityLogEntrySchema.shape.type.optional(),
  actorType: z.enum(['judge', 'organizer', 'system']).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
})
export type ActivityLogQuery = z.infer<typeof activityLogQuerySchema>
