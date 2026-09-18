import {
  applyPendingMigrations,
  ascent,
  ascentEvent,
  createDatabase,
  type DatabaseHandle,
} from '@climbcontest/db'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { eq, sql } from 'drizzle-orm'
import pg from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createApp } from '../app'
import type { Env } from '../env'
import { createAccessTokenSigner, createJudgeTokenSigner } from '../lib/jwt'
import type { Logger } from '../lib/logger'
import { FakeMailer } from '../test-utils/fake-mailer'
import {
  authHeaders,
  authenticateJudge,
  createJudgeFixture,
  judgeAuthHeaders,
} from '../test-utils/fixtures'

let container: StartedPostgreSqlContainer
let handle: DatabaseHandle
let mailer: FakeMailer
let app: ReturnType<typeof createApp>
let fakeNow: Date

const env: Env = {
  NODE_ENV: 'test',
  PORT: 3000,
  DATABASE_URL: '',
  CORS_ORIGIN: 'http://localhost:5173',
  PUBLIC_APP_URL: 'http://localhost:5173',
  JWT_ACCESS_SECRET: 'test-secret-test-secret-test-secret-32',
  JWT_JUDGE_SECRET: 'test-judge-secret-test-judge-secret-32',
  SMTP_HOST: 'localhost',
  SMTP_PORT: 1025,
  SMTP_SECURE: false,
  MAIL_FROM: 'no-reply@climbcontest.test',
}

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

beforeEach(() => {
  mailer = new FakeMailer()
  fakeNow = new Date('2026-09-18T14:00:00.000Z')
  app = createApp({
    env,
    db: handle.db,
    mailer,
    logger: { info: () => {} } as unknown as Logger,
    accessTokenSigner: createAccessTokenSigner(env.JWT_ACCESS_SECRET),
    judgeTokenSigner: createJudgeTokenSigner(env.JWT_JUDGE_SECRET),
    now: () => fakeNow,
  })
})

afterEach(async () => {
  await handle.db.execute(
    sql`truncate table "user", "club", "session", "competition", "round", "category", "competitor", "route", "route_category", "round_route", "ascent", "ascent_event", "activity_log", "judge", "judge_route" cascade`,
  )
})

async function setUpConflict() {
  const fixture = await createJudgeFixture(app, mailer)
  const judgeJwt = await authenticateJudge(app, fixture.judge.accessToken, fixture.judge.pin)
  const routeDetail = (await (
    await app.request(`/api/v1/judge/routes/${fixture.route.id}`, {
      headers: judgeAuthHeaders(judgeJwt),
    })
  ).json()) as { round: { id: string } }
  const roundId = routeDetail.round.id

  const base = {
    kind: 'create' as const,
    roundId,
    routeId: fixture.route.id,
    competitorId: fixture.competitor.id,
    modifier: 'none' as const,
    isTop: false,
    status: 'valid' as const,
    climbTimeMs: null,
    recordedAt: fakeNow.toISOString(),
  }
  const batchResponse = await app.request('/api/v1/judge/ascents/batch', {
    method: 'POST',
    headers: judgeAuthHeaders(judgeJwt),
    body: JSON.stringify({
      items: [
        { ...base, id: crypto.randomUUID(), holdNumber: 20, deviceId: 'device-A' },
        { ...base, id: crypto.randomUUID(), holdNumber: 28, deviceId: 'device-B' },
      ],
    }),
  })
  const batchBody = (await batchResponse.json()) as {
    results: { id: string; status: string; conflictGroup?: string }[]
  }
  const conflictGroup = batchBody.results[1]?.conflictGroup
  if (!conflictGroup) throw new Error('Conflit non créé — fixture invalide.')
  return { fixture, roundId, conflictGroup, ascentIds: batchBody.results.map((r) => r.id) }
}

async function getConflicts(accessToken: string, competitionId: string) {
  const response = await app.request(`/api/v1/competitions/${competitionId}/conflicts`, {
    headers: authHeaders(accessToken),
  })
  return response
}

async function resolveConflict(
  accessToken: string,
  competitionId: string,
  conflictGroup: string,
  body: unknown,
) {
  return app.request(`/api/v1/competitions/${competitionId}/conflicts/${conflictGroup}/resolve`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify(body),
  })
}

describe('GET /competitions/:id/conflicts', () => {
  it('liste le groupe de conflit avec les deux valeurs', async () => {
    const { fixture, conflictGroup } = await setUpConflict()
    const response = await getConflicts(fixture.organizerToken, fixture.competition.id)
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      conflictGroup: string
      ascents: { ascent: { holdNumber: number | null }; judgeDisplayName: string | null }[]
    }[]
    expect(body).toHaveLength(1)
    expect(body[0]?.conflictGroup).toBe(conflictGroup)
    expect(body[0]?.ascents).toHaveLength(2)
    expect(body[0]?.ascents.map((a) => a.ascent.holdNumber).sort()).toEqual([20, 28])
    expect(body[0]?.ascents.every((a) => a.judgeDisplayName === 'Juge Test')).toBe(true)
  })

  it('ne liste plus rien une fois vide', async () => {
    const fixture = await createJudgeFixture(app, mailer)
    const response = await getConflicts(fixture.organizerToken, fixture.competition.id)
    expect((await response.json()) as unknown[]).toEqual([])
  })
})

describe('POST /competitions/:id/conflicts/:conflictGroupId/resolve', () => {
  it('résout par choix d’une valeur existante — le perdant est chaîné, le conflit disparaît', async () => {
    const { fixture, conflictGroup, ascentIds } = await setUpConflict()
    const winnerId = ascentIds[0]!
    const response = await resolveConflict(
      fixture.organizerToken,
      fixture.competition.id,
      conflictGroup,
      { resolution: 'choose', ascentId: winnerId },
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as { id: string; holdNumber: number | null }
    expect(body.id).toBe(winnerId)

    const winnerRow = await handle.db.query.ascent.findFirst({ where: eq(ascent.id, winnerId) })
    expect(winnerRow?.conflictGroup).toBeNull()
    expect(winnerRow?.supersededBy).toBeNull()

    const loserId = ascentIds[1]!
    const loserRow = await handle.db.query.ascent.findFirst({ where: eq(ascent.id, loserId) })
    expect(loserRow?.conflictGroup).toBeNull()
    expect(loserRow?.supersededBy).toBe(winnerId)

    const remaining = await getConflicts(fixture.organizerToken, fixture.competition.id)
    expect((await remaining.json()) as unknown[]).toEqual([])
  })

  it('résout par nouvelle valeur — les deux sont chaînées vers une troisième ligne, motif obligatoire', async () => {
    const { fixture, conflictGroup, ascentIds } = await setUpConflict()

    const refused = await resolveConflict(
      fixture.organizerToken,
      fixture.competition.id,
      conflictGroup,
      { resolution: 'new_value', holdNumber: 24, modifier: 'none', isTop: false, status: 'valid' },
    )
    expect(refused.status).toBe(400)

    const response = await resolveConflict(
      fixture.organizerToken,
      fixture.competition.id,
      conflictGroup,
      {
        resolution: 'new_value',
        reason: 'Vérifié avec les deux juges après visionnage de la vidéo.',
        holdNumber: 24,
        modifier: 'none',
        isTop: false,
        status: 'valid',
      },
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as { id: string; holdNumber: number | null }
    expect(body.holdNumber).toBe(24)
    expect(ascentIds).not.toContain(body.id)

    for (const oldId of ascentIds) {
      const row = await handle.db.query.ascent.findFirst({ where: eq(ascent.id, oldId) })
      expect(row?.supersededBy).toBe(body.id)
      expect(row?.conflictGroup).toBeNull()
    }

    const events = await handle.db.query.ascentEvent.findMany({
      where: eq(ascentEvent.ascentId, body.id),
    })
    expect(events.map((e) => e.eventType)).toEqual(['created'])
  })

  it('404 pour un groupe de conflit inconnu', async () => {
    const fixture = await createJudgeFixture(app, mailer)
    const response = await resolveConflict(
      fixture.organizerToken,
      fixture.competition.id,
      crypto.randomUUID(),
      { resolution: 'choose', ascentId: crypto.randomUUID() },
    )
    expect(response.status).toBe(404)
  })
})
