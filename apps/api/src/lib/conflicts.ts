import type { ConflictSummary } from '@climbcontest/contracts'
import { ascentSchema } from '@climbcontest/contracts'
import { ascent, judge, type Database } from '@climbcontest/db'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'

type AscentRow = typeof ascent.$inferSelect

/**
 * Un groupe de conflit ne porte aucune FK (ADR-033) — on le retrouve en
 * regroupant les lignes actives par `conflict_group`, jamais par une table
 * dédiée.
 */
export async function listUnresolvedConflicts(
  db: Database,
  competitionId: string,
): Promise<ConflictSummary[]> {
  const rows = await db
    .select()
    .from(ascent)
    .where(and(eq(ascent.competitionId, competitionId), isNotNull(ascent.conflictGroup)))
    .orderBy(ascent.conflictGroup, ascent.recordedAt)

  const judgeIds = [...new Set(rows.map((row) => row.recordedByJudgeId).filter((id) => id !== null))]
  const judgeNames = new Map(
    judgeIds.length === 0
      ? []
      : (
          await db
            .select({ id: judge.id, displayName: judge.displayName })
            .from(judge)
            .where(inArray(judge.id, judgeIds))
        ).map((j) => [j.id, j.displayName]),
  )

  const groups = new Map<string, AscentRow[]>()
  for (const row of rows) {
    // `isNotNull` ci-dessus garantit que `conflictGroup` n'est jamais null ici.
    const groupId = row.conflictGroup as string
    const list = groups.get(groupId) ?? []
    list.push(row)
    groups.set(groupId, list)
  }

  return [...groups.entries()].map(([conflictGroup, groupRows]) => {
    const first = groupRows[0]
    if (!first) throw new Error('Groupe de conflit vide — ne devrait jamais arriver.')
    return {
      conflictGroup,
      competitionId,
      roundId: first.roundId,
      routeId: first.routeId,
      competitorId: first.competitorId,
      ascents: groupRows.map((row) => ({
        ascent: ascentSchema.parse(row),
        judgeDisplayName: row.recordedByJudgeId ? (judgeNames.get(row.recordedByJudgeId) ?? null) : null,
      })),
    }
  })
}

export async function findConflictGroupRows(
  db: Database,
  competitionId: string,
  conflictGroupId: string,
): Promise<AscentRow[]> {
  return db
    .select()
    .from(ascent)
    .where(and(eq(ascent.competitionId, competitionId), eq(ascent.conflictGroup, conflictGroupId)))
}
