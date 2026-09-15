import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

import * as schema from './schema'

export type Database = ReturnType<typeof drizzle<typeof schema>>

export interface DatabaseHandle {
  db: Database
  pool: Pool
  close: () => Promise<void>
}

export function createDatabase(databaseUrl: string): DatabaseHandle {
  const pool = new Pool({ connectionString: databaseUrl })
  const db = drizzle(pool, { schema })
  return {
    db,
    pool,
    close: () => pool.end(),
  }
}
