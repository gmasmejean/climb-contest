import type { PublicStreamEvent } from '@climbcontest/contracts'
import type { Database } from '@climbcontest/db'
import { sql } from 'drizzle-orm'

import { PUBLIC_EVENTS_CHANNEL } from './realtime-bridge'

/**
 * Accepte aussi bien `Database` qu'un `tx` de `db.transaction(async (tx) =>
 * …)`, comme `lib/contest-round.ts` — voir ce fichier pour la justification
 * du `Pick`.
 */
type Executor = Pick<Database, 'execute'>

/**
 * `pg_notify` à l'intérieur de la MÊME transaction que l'écriture qui
 * déclenche l'événement (toujours appelé avec `tx`, jamais `db`, dans les
 * routes qui écrivent) : Postgres ne délivre un `NOTIFY` émis en transaction
 * qu'au `COMMIT` — jamais si la transaction est annulée. C'est cette
 * garantie, pas du code applicatif, qui empêche un `NOTIFY` fantôme pour une
 * écriture qui a échoué (voir `lib/realtime-bridge.test.ts`).
 */
export async function notifyPublic(db: Executor, event: PublicStreamEvent): Promise<void> {
  await db.execute(sql`select pg_notify(${PUBLIC_EVENTS_CHANNEL}, ${JSON.stringify(event)})`)
}
