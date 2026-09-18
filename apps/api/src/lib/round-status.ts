import { ROUND_STATUS_TRANSITIONS, type ChangeRoundStatusInput } from '@climbcontest/contracts'
import { ascent, type Database } from '@climbcontest/db'
import { and, eq, isNotNull } from 'drizzle-orm'

type RoundStatus = ChangeRoundStatusInput['status']

/** Lot 8 (DECISIONS.md) — graphe de transition partagé avec `packages/contracts`. */
export function isValidRoundTransition(from: RoundStatus, to: RoundStatus): boolean {
  return ROUND_STATUS_TRANSITIONS[from].includes(to)
}

/**
 * Publier un tour rend son classement définitif et visible du public — un
 * conflit de saisie non résolu sur une de ses voies ne doit jamais se
 * retrouver silencieusement absent (ou pire, arbitrairement retenu) du
 * classement publié. Un conflit est toujours interne à un même
 * (tour, voie, compétiteur) : chercher par `roundId` suffit, pas besoin de
 * remonter par `round_route`.
 */
export async function roundHasUnresolvedConflicts(
  db: Database,
  roundId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: ascent.id })
    .from(ascent)
    .where(and(eq(ascent.roundId, roundId), isNotNull(ascent.conflictGroup)))
    .limit(1)
  return row !== undefined
}
