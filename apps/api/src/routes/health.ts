import type { Database } from '@climbcontest/db'
import { sql } from 'drizzle-orm'
import { Hono } from 'hono'

export function createHealthRoute(db: Database): Hono {
  const app = new Hono()

  app.get('/', async (c) => {
    try {
      await db.execute(sql`select 1`)
      return c.json({ status: 'ok', database: 'up' })
    } catch {
      return c.json({ status: 'degraded', database: 'down' }, 503)
    }
  })

  return app
}
