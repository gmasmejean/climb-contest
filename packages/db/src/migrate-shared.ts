import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type pg from 'pg'

export const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle')

export function requireDatabaseUrl(): string {
  const databaseUrl = process.env['DATABASE_URL']
  if (!databaseUrl) {
    throw new Error('DATABASE_URL manquante — voir .env.example.')
  }
  return databaseUrl
}

async function ensureMigrationsTable(client: pg.Client | pg.PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations_applied (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `)
}

function listUpMigrationFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith('.sql') && !file.endsWith('.down.sql'))
    .sort()
}

export async function applyPendingMigrations(
  client: pg.Client | pg.PoolClient,
  dir: string = migrationsDir,
): Promise<string[]> {
  await ensureMigrationsTable(client)
  const appliedResult = await client.query<{ name: string }>(
    'SELECT name FROM _migrations_applied',
  )
  const applied = new Set(appliedResult.rows.map((row) => row.name))
  const pending = listUpMigrationFiles(dir).filter((name) => !applied.has(name))

  for (const name of pending) {
    const sqlText = readFileSync(join(dir, name), 'utf8')
    await client.query('BEGIN')
    try {
      await client.query(sqlText)
      await client.query('INSERT INTO _migrations_applied (name) VALUES ($1)', [name])
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    }
  }
  return pending
}

export async function revertLastMigrations(
  client: pg.Client | pg.PoolClient,
  steps: number,
  dir: string = migrationsDir,
): Promise<string[]> {
  await ensureMigrationsTable(client)
  const { rows } = await client.query<{ name: string }>(
    'SELECT name FROM _migrations_applied ORDER BY applied_at DESC, name DESC LIMIT $1',
    [steps],
  )

  const reverted: string[] = []
  for (const { name } of rows) {
    const downName = name.replace(/\.sql$/, '.down.sql')
    const downPath = join(dir, downName)
    if (!existsSync(downPath)) {
      throw new Error(`Fichier down manquant pour ${name} (attendu : ${downName}).`)
    }
    const sqlText = readFileSync(downPath, 'utf8')
    await client.query('BEGIN')
    try {
      await client.query(sqlText)
      await client.query('DELETE FROM _migrations_applied WHERE name = $1', [name])
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    }
    reverted.push(name)
  }
  return reverted
}
