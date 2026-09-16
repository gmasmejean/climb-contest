import { round, roundRoute, type Database } from '@climbcontest/db'
import { and, eq, isNull } from 'drizzle-orm'

/**
 * Le round implicite du format contest (voir DECISIONS.md) : un seul par
 * compétition, créé à sa création (routes/competitions.ts), jamais exposé
 * à l'organisateur. `route_category` reste la seule source de vérité
 * saisie par l'organisateur en mode contest — ces deux fonctions gardent
 * `round_route` synchronisé dessus, pour que le moteur de cotation (Lot 5+)
 * trouve toujours ses voies via le round comme en mode phases.
 */

/**
 * Accepte aussi bien `Database` qu'un `tx` de `db.transaction(async (tx) =>
 * …)` : les deux exposent `.query`/`.insert`/`.delete`, mais pas le même
 * type nominal exact (`tx` n'a pas `$client`) — on ne dépend que de la
 * forme réellement utilisée ici.
 */
type Tx = Pick<Database, 'query' | 'insert' | 'delete'>

async function getContestRound(db: Tx, competitionId: string) {
  const row = await db.query.round.findFirst({
    where: and(eq(round.competitionId, competitionId), isNull(round.deletedAt)),
  })
  if (!row) {
    throw new Error(`Round implicite manquant pour la compétition ${competitionId}.`)
  }
  return row
}

export async function addContestRoundRoute(
  db: Tx,
  competitionId: string,
  routeId: string,
  categoryId: string,
): Promise<void> {
  const implicitRound = await getContestRound(db, competitionId)
  await db
    .insert(roundRoute)
    .values({ roundId: implicitRound.id, routeId, categoryId })
    .onConflictDoNothing()
}

export async function removeContestRoundRoute(
  db: Tx,
  competitionId: string,
  routeId: string,
  categoryId: string,
): Promise<void> {
  const implicitRound = await getContestRound(db, competitionId)
  await db
    .delete(roundRoute)
    .where(
      and(
        eq(roundRoute.roundId, implicitRound.id),
        eq(roundRoute.routeId, routeId),
        eq(roundRoute.categoryId, categoryId),
      ),
    )
}
