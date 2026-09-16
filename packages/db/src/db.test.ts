import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { sql } from 'drizzle-orm'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createDatabase, type DatabaseHandle } from './client'
import { applyPendingMigrations, revertLastMigrations } from './migrate-shared'
import { ascent, category, club, competition, competitor, round, route, user } from './schema'

let container: StartedPostgreSqlContainer
let handle: DatabaseHandle

async function withRawClient<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: container.getConnectionUri() })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16.15-alpine').start()
  await withRawClient((client) => applyPendingMigrations(client))
  handle = createDatabase(container.getConnectionUri())
}, 180_000)

afterAll(async () => {
  await handle.close()
  await container.stop()
})

async function insertClubAndUser() {
  const [demoClub] = await handle.db
    .insert(club)
    .values({ name: 'Club Test', slug: `club-test-${crypto.randomUUID()}` })
    .returning()
  if (!demoClub) throw new Error('club insert failed')
  const [demoUser] = await handle.db
    .insert(user)
    .values({
      clubId: demoClub.id,
      email: `${crypto.randomUUID()}@test.local`,
      displayName: 'Test',
      role: 'owner',
    })
    .returning()
  if (!demoUser) throw new Error('user insert failed')
  return { demoClub, demoUser }
}

describe('migrations', () => {
  it('créent toutes les tables du schéma', async () => {
    const result = await handle.db.execute(
      sql`select table_name from information_schema.tables where table_schema = 'public' and table_name != '_migrations_applied'`,
    )
    const tableNames = result.rows.map((row) => (row as { table_name: string }).table_name)
    expect(tableNames.sort()).toEqual(
      [
        'ascent',
        'ascent_event',
        'asset',
        'category',
        'club',
        'competition',
        'competitor',
        'judge',
        'judge_route',
        'round',
        'round_route',
        'route',
        'route_category',
        'session',
        'user',
      ].sort(),
    )
  })

  it('sont réversibles (down puis up ne changent rien au jeu de tables)', async () => {
    await withRawClient(async (client) => {
      // steps volontairement plus grand que le nombre de migrations
      // appliquées : revertLastMigrations s'arrête dès qu'il n'y en a plus
      // (LIMIT), donc ce test reste correct sans être mis à jour à chaque
      // nouvelle migration ajoutée.
      const reverted = await revertLastMigrations(client, 50)
      expect(reverted.length).toBeGreaterThan(0)

      const afterDown = await client.query(
        "select table_name from information_schema.tables where table_schema = 'public' and table_name != '_migrations_applied'",
      )
      expect(afterDown.rows).toHaveLength(0)

      const applied = await applyPendingMigrations(client)
      expect(applied.length).toBeGreaterThan(0)

      const afterUp = await client.query(
        "select table_name from information_schema.tables where table_schema = 'public' and table_name != '_migrations_applied'",
      )
      expect(afterUp.rows.length).toBe(15)
    })
  })
})

// Doit tourner avant les tests suivants : ils insèrent des compétiteurs avec
// `bib = null`, ce que le `down` de cette migration (SET NOT NULL) refuserait.
describe('migration 0001_competitor_bib_nullable (ADR-022)', () => {
  it('est réversible : le down réapplique NOT NULL, le up la retire', async () => {
    await withRawClient(async (client) => {
      const columnNullable = async () => {
        const result = await client.query<{ is_nullable: string }>(
          "select is_nullable from information_schema.columns where table_name = 'competitor' and column_name = 'bib'",
        )
        return result.rows[0]?.is_nullable === 'YES'
      }

      expect(await columnNullable()).toBe(true)

      const reverted = await revertLastMigrations(client, 1)
      expect(reverted).toEqual(['0001_competitor_bib_nullable.sql'])
      expect(await columnNullable()).toBe(false)

      const applied = await applyPendingMigrations(client)
      expect(applied).toEqual(['0001_competitor_bib_nullable.sql'])
      expect(await columnNullable()).toBe(true)
    })
  })
})

describe('contraintes et colonne calculée ascent', () => {
  async function setupAscentFixture() {
    const { demoClub, demoUser } = await insertClubAndUser()
    const [demoCompetition] = await handle.db
      .insert(competition)
      .values({
        clubId: demoClub.id,
        name: 'Comp',
        venue: 'Salle',
        startsOn: '2026-01-01',
        endsOn: '2026-01-01',
        format: 'contest',
        scoringEngineId: 'ffme-difficulty-2026',
        publicSlug: crypto.randomUUID(),
        createdBy: demoUser.id,
      })
      .returning()
    if (!demoCompetition) throw new Error('competition insert failed')
    const [demoCategory] = await handle.db
      .insert(category)
      .values({ competitionId: demoCompetition.id, label: 'U16 Homme', sex: 'M', displayOrder: 0 })
      .returning()
    if (!demoCategory) throw new Error('category insert failed')
    const [demoRound] = await handle.db
      .insert(round)
      .values({
        competitionId: demoCompetition.id,
        type: 'qualification',
        style: 'onsight',
        displayOrder: 0,
      })
      .returning()
    if (!demoRound) throw new Error('round insert failed')
    const [demoRoute] = await handle.db
      .insert(route)
      .values({ competitionId: demoCompetition.id, number: 1, holdCount: 40 })
      .returning()
    if (!demoRoute) throw new Error('route insert failed')
    const [demoCompetitor] = await handle.db
      .insert(competitor)
      .values({
        competitionId: demoCompetition.id,
        categoryId: demoCategory.id,
        bib: 1,
        firstName: 'A',
        lastName: 'B',
      })
      .returning()
    if (!demoCompetitor) throw new Error('competitor insert failed')

    return { demoUser, demoRound, demoRoute, demoCompetitor }
  }

  it('rejette un passage valide sans hauteur atteinte ni top', async () => {
    const { demoUser, demoRound, demoRoute, demoCompetitor } = await setupAscentFixture()

    await expect(
      handle.db.insert(ascent).values({
        id: crypto.randomUUID(),
        competitionId: demoRoute.competitionId,
        roundId: demoRound.id,
        routeId: demoRoute.id,
        competitorId: demoCompetitor.id,
        holdCount: demoRoute.holdCount,
        status: 'valid',
        isTop: false,
        recordedByUserId: demoUser.id,
        recordedAt: new Date(),
        deviceId: 'test',
      }),
    ).rejects.toThrow()
  })

  it('calcule score_value = hold_count + 1 pour un TOP', async () => {
    const { demoUser, demoRound, demoRoute, demoCompetitor } = await setupAscentFixture()

    const [inserted] = await handle.db
      .insert(ascent)
      .values({
        id: crypto.randomUUID(),
        competitionId: demoRoute.competitionId,
        roundId: demoRound.id,
        routeId: demoRoute.id,
        competitorId: demoCompetitor.id,
        holdCount: demoRoute.holdCount,
        status: 'valid',
        isTop: true,
        recordedByUserId: demoUser.id,
        recordedAt: new Date(),
        deviceId: 'test',
      })
      .returning()

    expect(inserted?.scoreValue).toBe(`${demoRoute.holdCount + 1}.0`)
  })

  it('calcule score_value = hold_number + 0.5 pour un modificateur +', async () => {
    const { demoUser, demoRound, demoRoute, demoCompetitor } = await setupAscentFixture()

    const [inserted] = await handle.db
      .insert(ascent)
      .values({
        id: crypto.randomUUID(),
        competitionId: demoRoute.competitionId,
        roundId: demoRound.id,
        routeId: demoRoute.id,
        competitorId: demoCompetitor.id,
        holdCount: demoRoute.holdCount,
        holdNumber: 25,
        modifier: 'plus',
        status: 'valid',
        isTop: false,
        recordedByUserId: demoUser.id,
        recordedAt: new Date(),
        deviceId: 'test',
      })
      .returning()

    expect(inserted?.scoreValue).toBe('25.5')
  })
})

describe('unicité compétiteur', () => {
  it('refuse deux compétiteurs avec le même dossard dans la même compétition', async () => {
    const { demoClub, demoUser } = await insertClubAndUser()
    const [demoCompetition] = await handle.db
      .insert(competition)
      .values({
        clubId: demoClub.id,
        name: 'Comp bib',
        venue: 'Salle',
        startsOn: '2026-01-01',
        endsOn: '2026-01-01',
        format: 'contest',
        scoringEngineId: 'ffme-difficulty-2026',
        publicSlug: crypto.randomUUID(),
        createdBy: demoUser.id,
      })
      .returning()
    if (!demoCompetition) throw new Error('competition insert failed')
    const [demoCategory] = await handle.db
      .insert(category)
      .values({ competitionId: demoCompetition.id, label: 'U16 Homme', sex: 'M', displayOrder: 0 })
      .returning()
    if (!demoCategory) throw new Error('category insert failed')

    await handle.db.insert(competitor).values({
      competitionId: demoCompetition.id,
      categoryId: demoCategory.id,
      bib: 1,
      firstName: 'A',
      lastName: 'B',
    })

    await expect(
      handle.db.insert(competitor).values({
        competitionId: demoCompetition.id,
        categoryId: demoCategory.id,
        bib: 1,
        firstName: 'C',
        lastName: 'D',
      }),
    ).rejects.toThrow()
  })

  it('autorise plusieurs compétiteurs sans dossard (bib null) dans la même compétition (ADR-022)', async () => {
    const { demoClub, demoUser } = await insertClubAndUser()
    const [demoCompetition] = await handle.db
      .insert(competition)
      .values({
        clubId: demoClub.id,
        name: 'Comp bib null',
        venue: 'Salle',
        startsOn: '2026-01-01',
        endsOn: '2026-01-01',
        format: 'contest',
        scoringEngineId: 'ffme-difficulty-2026',
        publicSlug: crypto.randomUUID(),
        createdBy: demoUser.id,
      })
      .returning()
    if (!demoCompetition) throw new Error('competition insert failed')
    const [demoCategory] = await handle.db
      .insert(category)
      .values({ competitionId: demoCompetition.id, label: 'U16 Homme', sex: 'M', displayOrder: 0 })
      .returning()
    if (!demoCategory) throw new Error('category insert failed')

    await handle.db.insert(competitor).values([
      { competitionId: demoCompetition.id, categoryId: demoCategory.id, firstName: 'A', lastName: 'B' },
      { competitionId: demoCompetition.id, categoryId: demoCategory.id, firstName: 'C', lastName: 'D' },
    ])

    const rows = await handle.db.query.competitor.findMany({
      where: (row, { eq }) => eq(row.competitionId, demoCompetition.id),
    })
    expect(rows).toHaveLength(2)
    expect(rows.every((row) => row.bib === null)).toBe(true)
  })
})
