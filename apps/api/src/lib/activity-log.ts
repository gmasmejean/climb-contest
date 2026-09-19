import type { ActivityLogEntry, ActivityLogQuery } from '@climbcontest/contracts'
import { activityLog, ascent, ascentEvent, type Database } from '@climbcontest/db'
import { eq } from 'drizzle-orm'

import { neutralizeFormula } from './exports/csv'

/**
 * Journal d'activité de la compétition (ROADMAP.md Lot 8) : fusion en
 * mémoire de `activity_log` (tours, compétiteurs) et `ascent_event`
 * (passages — création, correction, résolution de conflit, y compris les
 * saisies juge normales, utiles pour retracer une réclamation). Pas de vraie
 * requête SQL `UNION` : les deux tables n'ont pas la même forme, et à
 * l'échelle d'une compétition de club, fusionner deux listes déjà petites en
 * mémoire est plus simple et tout aussi correct (voir DECISIONS.md).
 */
export async function fetchActivityLog(
  db: Database,
  competitionId: string,
  filters: ActivityLogQuery = {},
): Promise<ActivityLogEntry[]> {
  const activityRows = await db.query.activityLog.findMany({
    where: eq(activityLog.competitionId, competitionId),
  })

  const ascentEventRows = await db
    .select({
      id: ascentEvent.id,
      eventType: ascentEvent.eventType,
      actorType: ascentEvent.actorType,
      actorId: ascentEvent.actorId,
      payload: ascentEvent.payload,
      reason: ascentEvent.reason,
      createdAt: ascentEvent.createdAt,
    })
    .from(ascentEvent)
    .innerJoin(ascent, eq(ascent.id, ascentEvent.ascentId))
    .where(eq(ascent.competitionId, competitionId))

  const ascentEventTypeMap: Record<string, ActivityLogEntry['type']> = {
    created: 'ascent_created',
    corrected: 'ascent_corrected',
    voided: 'ascent_voided',
    conflict_resolved: 'conflict_resolved',
  }

  const judgeIds = [
    ...new Set(
      [...activityRows, ...ascentEventRows]
        .filter((row) => row.actorType === 'judge' && row.actorId)
        .map((row) => row.actorId as string),
    ),
  ]
  const organizerIds = [
    ...new Set(
      [...activityRows, ...ascentEventRows]
        .filter((row) => row.actorType === 'organizer' && row.actorId)
        .map((row) => row.actorId as string),
    ),
  ]
  const judgeNames = new Map(
    judgeIds.length === 0
      ? []
      : (
          await db.query.judge.findMany({ where: (j, { inArray }) => inArray(j.id, judgeIds) })
        ).map((j) => [j.id, j.displayName]),
  )
  const organizerNames = new Map(
    organizerIds.length === 0
      ? []
      : (
          await db.query.user.findMany({ where: (u, { inArray }) => inArray(u.id, organizerIds) })
        ).map((u) => [u.id, u.displayName]),
  )

  function actorLabelFor(actorType: string, actorId: string | null): string | null {
    if (!actorId) return null
    if (actorType === 'judge') return judgeNames.get(actorId) ?? null
    if (actorType === 'organizer') return organizerNames.get(actorId) ?? null
    return null
  }

  const entries: ActivityLogEntry[] = [
    ...activityRows.map((row) => ({
      id: row.id,
      type: row.eventType as ActivityLogEntry['type'],
      actorType: row.actorType as ActivityLogEntry['actorType'],
      actorId: row.actorId,
      actorLabel: actorLabelFor(row.actorType, row.actorId),
      payload: row.payload as Record<string, unknown>,
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
    })),
    ...ascentEventRows.map((row) => ({
      id: row.id,
      type: ascentEventTypeMap[row.eventType] ?? 'ascent_created',
      actorType: row.actorType as ActivityLogEntry['actorType'],
      actorId: row.actorId,
      actorLabel: actorLabelFor(row.actorType, row.actorId),
      payload: row.payload as Record<string, unknown>,
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
    })),
  ]

  const filtered = entries.filter((entry) => {
    if (filters.type && entry.type !== filters.type) return false
    if (filters.actorType && entry.actorType !== filters.actorType) return false
    if (filters.from && entry.createdAt < filters.from) return false
    if (filters.to && entry.createdAt > filters.to) return false
    return true
  })

  return filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

function csvEscape(value: string): string {
  // Le journal reprend des motifs et des noms saisis par des humains : une
  // formule dans l'un d'eux ne doit jamais s'exécuter dans le tableur de
  // l'organisateur (revue de sécurité, Lot 9).
  return `"${neutralizeFormula(value).replace(/"/g, '""')}"`
}

export function activityLogToCsv(entries: ActivityLogEntry[]): string {
  const header = ['date', 'type', 'acteur', 'nom', 'motif', 'détail']
  const lines = entries.map((entry) =>
    [
      entry.createdAt,
      entry.type,
      entry.actorType,
      entry.actorLabel ?? '',
      entry.reason ?? '',
      JSON.stringify(entry.payload),
    ]
      .map(csvEscape)
      .join(','),
  )
  return [header.map(csvEscape).join(','), ...lines].join('\n')
}
