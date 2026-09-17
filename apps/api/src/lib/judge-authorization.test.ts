import {
  applyPendingMigrations,
  club,
  competition,
  createDatabase,
  judge,
  judgeRoute,
  route,
  user,
  type DatabaseHandle,
} from '@climbcontest/db'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ApiError } from '../middleware/problem'
import { assertJudgeAssignedToRoute } from './judge-authorization'

let container: StartedPostgreSqlContainer
let handle: DatabaseHandle

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16.15-alpine').start()
  const client = new pg.Client({ connectionString: container.getConnectionUri() })
  await client.connect()
  await applyPendingMigrations(client)
  await client.end()
  handle = createDatabase(container.getConnectionUri())
}, 180_000)

afterAll(async () => {
  await handle.close()
  await container.stop()
})

async function setupTwoCompetitionsWithJudge() {
  const [demoClub] = await handle.db
    .insert(club)
    .values({ name: 'Club Test', slug: `club-${crypto.randomUUID()}` })
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

  const [competitionA] = await handle.db
    .insert(competition)
    .values({
      clubId: demoClub.id,
      name: 'Compétition A',
      venue: 'Salle',
      startsOn: '2026-01-01',
      endsOn: '2026-01-01',
      format: 'contest',
      scoringEngineId: 'ffme-difficulty-2026',
      publicSlug: crypto.randomUUID(),
      createdBy: demoUser.id,
    })
    .returning()
  const [competitionB] = await handle.db
    .insert(competition)
    .values({
      clubId: demoClub.id,
      name: 'Compétition B',
      venue: 'Salle',
      startsOn: '2026-01-01',
      endsOn: '2026-01-01',
      format: 'contest',
      scoringEngineId: 'ffme-difficulty-2026',
      publicSlug: crypto.randomUUID(),
      createdBy: demoUser.id,
    })
    .returning()
  if (!competitionA || !competitionB) throw new Error('competition insert failed')

  const [assignedRoute] = await handle.db
    .insert(route)
    .values({ competitionId: competitionA.id, number: 1, holdCount: 40 })
    .returning()
  const [unassignedRoute] = await handle.db
    .insert(route)
    .values({ competitionId: competitionA.id, number: 2, holdCount: 38 })
    .returning()
  const [otherCompetitionRoute] = await handle.db
    .insert(route)
    .values({ competitionId: competitionB.id, number: 1, holdCount: 40 })
    .returning()
  if (!assignedRoute || !unassignedRoute || !otherCompetitionRoute) {
    throw new Error('route insert failed')
  }

  const [demoJudge] = await handle.db
    .insert(judge)
    .values({
      competitionId: competitionA.id,
      displayName: 'Juge Test',
      accessTokenHash: 'hash',
      accessTokenPrefix: 'prefix',
    })
    .returning()
  if (!demoJudge) throw new Error('judge insert failed')
  await handle.db.insert(judgeRoute).values({ judgeId: demoJudge.id, routeId: assignedRoute.id })

  return { demoJudge, assignedRoute, unassignedRoute, otherCompetitionRoute }
}

describe('assertJudgeAssignedToRoute', () => {
  it('renvoie la voie quand elle est assignée au juge', async () => {
    const { demoJudge, assignedRoute } = await setupTwoCompetitionsWithJudge()
    const result = await assertJudgeAssignedToRoute(handle.db, demoJudge, assignedRoute.id)
    expect(result.id).toBe(assignedRoute.id)
  })

  it('refuse une voie de la même compétition mais non assignée à ce juge', async () => {
    const { demoJudge, unassignedRoute } = await setupTwoCompetitionsWithJudge()
    await expect(
      assertJudgeAssignedToRoute(handle.db, demoJudge, unassignedRoute.id),
    ).rejects.toThrow(ApiError)
  })

  it("refuse une voie d'une autre compétition, même si son id est valide", async () => {
    const { demoJudge, otherCompetitionRoute } = await setupTwoCompetitionsWithJudge()
    await expect(
      assertJudgeAssignedToRoute(handle.db, demoJudge, otherCompetitionRoute.id),
    ).rejects.toThrow(ApiError)
  })

  it('renvoie le même statut 404 générique dans les deux cas de refus (ne révèle rien)', async () => {
    const { demoJudge, unassignedRoute, otherCompetitionRoute } =
      await setupTwoCompetitionsWithJudge()

    const unassignedError = await assertJudgeAssignedToRoute(
      handle.db,
      demoJudge,
      unassignedRoute.id,
    ).catch((error: unknown) => error)
    const otherCompetitionError = await assertJudgeAssignedToRoute(
      handle.db,
      demoJudge,
      otherCompetitionRoute.id,
    ).catch((error: unknown) => error)

    expect(unassignedError).toBeInstanceOf(ApiError)
    expect(otherCompetitionError).toBeInstanceOf(ApiError)
    expect((unassignedError as ApiError).status).toBe(404)
    expect((otherCompetitionError as ApiError).status).toBe(404)
    expect((unassignedError as ApiError).title).toBe((otherCompetitionError as ApiError).title)
  })
})
