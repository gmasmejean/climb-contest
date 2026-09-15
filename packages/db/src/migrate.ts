/**
 * Runner de migrations "up" — voir ADR-018 (DECISIONS.md) : drizzle-kit ne
 * génère pas de migration "down", ce runner maison applique les fichiers
 * `drizzle/*.sql` (hors `*.down.sql`) dans l'ordre, une fois chacun, suivis
 * dans la table `_migrations_applied`.
 */
import pg from 'pg'

import { applyPendingMigrations, requireDatabaseUrl } from './migrate-shared'

async function main(): Promise<void> {
  const client = new pg.Client({ connectionString: requireDatabaseUrl() })
  await client.connect()
  try {
    const applied = await applyPendingMigrations(client)
    if (applied.length === 0) {
      console.log('Aucune migration en attente.')
    } else {
      console.log(`${applied.length} migration(s) appliquée(s) : ${applied.join(', ')}`)
    }
  } finally {
    await client.end()
  }
}

await main()
