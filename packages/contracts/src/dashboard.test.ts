import { describe, expect, it } from 'vitest'

import { activityLogEntrySchema, dashboardAlertSchema, dashboardResponseSchema } from './dashboard'

describe('dashboardAlertSchema', () => {
  it('valide une alerte de voie muette', () => {
    const result = dashboardAlertSchema.safeParse({
      type: 'route_stalled',
      routeId: '0189dcd5-5311-7d40-8db0-9496a2eef37b',
      routeNumber: 3,
      roundId: '0189dcd5-5311-7d40-8db0-9496a2eef37c',
      minutesSinceLastAscent: 18,
    })
    expect(result.success).toBe(true)
  })

  it('refuse un type d’alerte inconnu', () => {
    const result = dashboardAlertSchema.safeParse({ type: 'unknown' })
    expect(result.success).toBe(false)
  })
})

describe('dashboardResponseSchema', () => {
  it('valide une réponse sans alerte', () => {
    const result = dashboardResponseSchema.safeParse({
      computedAt: new Date().toISOString(),
      categories: [],
      competitorsPending: [],
      judges: [],
      alerts: [],
    })
    expect(result.success).toBe(true)
  })
})

describe('activityLogEntrySchema', () => {
  it('valide une entrée de correction de passage', () => {
    const result = activityLogEntrySchema.safeParse({
      id: '0189dcd5-5311-7d40-8db0-9496a2eef37b',
      type: 'ascent_corrected',
      actorType: 'organizer',
      actorId: '0189dcd5-5311-7d40-8db0-9496a2eef37c',
      actorLabel: 'Camille (organisatrice)',
      payload: { previous: { holdNumber: 20 }, next: { holdNumber: 22 } },
      reason: 'Erreur de lecture du plan de voie.',
      createdAt: new Date().toISOString(),
    })
    expect(result.success).toBe(true)
  })
})
