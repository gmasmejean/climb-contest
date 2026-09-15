/**
 * Runner de migrations "down" — voir ADR-018 (DECISIONS.md).
 * Usage : `tsx src/migrate-down.ts [nombre-de-crans=1]`
 */
import pg from 'pg'

import { requireDatabaseUrl, revertLastMigrations } from './migrate-shared'

async function main(): Promise<void> {
  const steps = Number(process.argv[2] ?? '1')
  if (!Number.isInteger(steps) || steps < 1) {
    throw new Error('Le nombre de crans à annuler doit être un entier positif.')
  }

  const client = new pg.Client({ connectionString: requireDatabaseUrl() })
  await client.connect()
  try {
    const reverted = await revertLastMigrations(client, steps)
    if (reverted.length === 0) {
      console.log('Aucune migration à annuler.')
    } else {
      console.log(`${reverted.length} migration(s) annulée(s) : ${reverted.join(', ')}`)
    }
  } finally {
    await client.end()
  }
}

await main()
