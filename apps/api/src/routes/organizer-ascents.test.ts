import { applyPendingMigrations, ascent, createDatabase, type DatabaseHandle } from '@climbcontest/db'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { eq, sql } from 'drizzle-orm'
import pg from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createApp } from '../app'
import type { Env } from '../env'
import { createAccessTokenSigner, createJudgeTokenSigner } from '../lib/jwt'
import type { Logger } from '../lib/logger'
import { FakeMailer } from '../test-utils/fake-mailer'
import { authHeaders, authenticateJudge, createJudgeFixture, judgeAuthHeaders } from '../test-utils/fixtures'

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

async function setUp() {
  const fixture = await createJudgeFixture(app, mailer)
  const judgeJwt = await authenticateJudge(app, fixture.judge.accessToken, fixture.judge.pin)
  const routeDetail = (await (
    await app.request(`/api/v1/judge/routes/${fixture.route.id}`, {
      headers: judgeAuthHeaders(judgeJwt),
    })
  ).json()) as { round: { id: string } }
  return { fixture, judgeJwt, roundId: routeDetail.round.id }
}

async function postBackupEntry(accessToken: string, competitionId: string, body: unknown) {
  return app.request(`/api/v1/competitions/${competitionId}/ascents`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify(body),
  })
}

async function patchCorrection(
  accessToken: string,
  competitionId: string,
  ascentId: string,
  body: unknown,
) {
  return app.request(`/api/v1/competitions/${competitionId}/ascents/${ascentId}`, {
    method: 'PATCH',
    headers: authHeaders(accessToken),
    body: JSON.stringify(body),
  })
}

describe('GET /competitions/:id/ascents (liste pour correction/secours)', () => {
  it('liste le compétiteur sans passage, puis avec son passage une fois saisi', async () => {
    const { fixture, judgeJwt, roundId } = await setUp()
    const list = async () =>
      (await (
        await app.request(
          `/api/v1/competitions/${fixture.competition.id}/ascents?roundId=${roundId}&routeId=${fixture.route.id}`,
          { headers: authHeaders(fixture.organizerToken) },
        )
      ).json()) as { id: string; ascent: { holdNumber: number } | null }[]

    const before = await list()
    expect(before).toEqual([expect.objectContaining({ id: fixture.competitor.id, ascent: null })])

    await app.request('/api/v1/judge/ascents/batch', {
      method: 'POST',
      headers: judgeAuthHeaders(judgeJwt),
      body: JSON.stringify({
        items: [
          {
            kind: 'create',
            id: crypto.randomUUID(),
            roundId,
            routeId: fixture.route.id,
            competitorId: fixture.competitor.id,
            holdNumber: 22,
            modifier: 'none',
            isTop: false,
            status: 'valid',
            climbTimeMs: null,
            recordedAt: fakeNow.toISOString(),
            deviceId: 'device-1',
          },
        ],
      }),
    })

    const after = await list()
    expect(after[0]?.ascent).toEqual(expect.objectContaining({ holdNumber: 22 }))
  })

  it("404 si la voie n'appartient pas à ce tour", async () => {
    const { fixture, roundId } = await setUp()
    const response = await app.request(
      `/api/v1/competitions/${fixture.competition.id}/ascents?roundId=${roundId}&routeId=${crypto.randomUUID()}`,
      { headers: authHeaders(fixture.organizerToken) },
    )
    expect(response.status).toBe(404)
  })
})

describe('POST /competitions/:id/ascents (saisie de secours)', () => {
  it("l'organisateur saisit un passage à la place d'un juge", async () => {
    const { fixture, roundId } = await setUp()
    const response = await postBackupEntry(fixture.organizerToken, fixture.competition.id, {
      roundId,
      routeId: fixture.route.id,
      competitorId: fixture.competitor.id,
      holdNumber: 30,
      modifier: 'none',
      isTop: false,
      status: 'valid',
      recordedAt: fakeNow.toISOString(),
    })
    expect(response.status).toBe(201)
    const body = (await response.json()) as { status: string; ascent: { recordedByUserId: string | null; recordedByJudgeId: string | null } }
    expect(body.status).toBe('accepted')
    expect(body.ascent.recordedByJudgeId).toBeNull()
    expect(body.ascent.recordedByUserId).not.toBeNull()
  })

  it('peut aussi saisir en DSQ, contrairement au juge', async () => {
    const { fixture, roundId } = await setUp()
    const response = await postBackupEntry(fixture.organizerToken, fixture.competition.id, {
      roundId,
      routeId: fixture.route.id,
      competitorId: fixture.competitor.id,
      holdNumber: null,
      modifier: 'none',
      isTop: false,
      status: 'dsq',
      recordedAt: fakeNow.toISOString(),
    })
    expect(response.status).toBe(201)
  })

  it('détecte un conflit avec une saisie juge concurrente, exactement comme entre deux juges', async () => {
    const { fixture, judgeJwt, roundId } = await setUp()
    await app.request('/api/v1/judge/ascents/batch', {
      method: 'POST',
      headers: judgeAuthHeaders(judgeJwt),
      body: JSON.stringify({
        items: [
          {
            kind: 'create',
            id: crypto.randomUUID(),
            roundId,
            routeId: fixture.route.id,
            competitorId: fixture.competitor.id,
            holdNumber: 20,
            modifier: 'none',
            isTop: false,
            status: 'valid',
            climbTimeMs: null,
            recordedAt: fakeNow.toISOString(),
            deviceId: 'device-judge',
          },
        ],
      }),
    })

    const response = await postBackupEntry(fixture.organizerToken, fixture.competition.id, {
      roundId,
      routeId: fixture.route.id,
      competitorId: fixture.competitor.id,
      holdNumber: 35,
      modifier: 'none',
      isTop: false,
      status: 'valid',
      recordedAt: fakeNow.toISOString(),
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { status: string; conflictGroup?: string }
    expect(body.status).toBe('conflict')
    expect(body.conflictGroup).toBeTruthy()
  })
})

describe('PATCH /competitions/:id/ascents/:ascentId (correction organisateur)', () => {
  it('refuse une correction sans motif', async () => {
    const { fixture, roundId } = await setUp()
    const created = (await (
      await postBackupEntry(fixture.organizerToken, fixture.competition.id, {
        roundId,
        routeId: fixture.route.id,
        competitorId: fixture.competitor.id,
        holdNumber: 20,
        modifier: 'none',
        isTop: false,
        status: 'valid',
        recordedAt: fakeNow.toISOString(),
      })
    ).json()) as { ascent: { id: string } }

    const response = await patchCorrection(
      fixture.organizerToken,
      fixture.competition.id,
      created.ascent.id,
      { holdNumber: 25, modifier: 'none', isTop: false, status: 'valid' },
    )
    expect(response.status).toBe(400)
  })

  it('corrige un passage, quel que soit qui l’a saisi, en chaînant supersededBy', async () => {
    const { fixture, judgeJwt, roundId } = await setUp()
    const judgeResponse = await app.request('/api/v1/judge/ascents/batch', {
      method: 'POST',
      headers: judgeAuthHeaders(judgeJwt),
      body: JSON.stringify({
        items: [
          {
            kind: 'create',
            id: crypto.randomUUID(),
            roundId,
            routeId: fixture.route.id,
            competitorId: fixture.competitor.id,
            holdNumber: 20,
            modifier: 'none',
            isTop: false,
            status: 'valid',
            climbTimeMs: null,
            recordedAt: fakeNow.toISOString(),
            deviceId: 'device-judge',
          },
        ],
      }),
    })
    const originalId = ((await judgeResponse.json()) as { results: { id: string }[] }).results[0]!.id

    const response = await patchCorrection(
      fixture.organizerToken,
      fixture.competition.id,
      originalId,
      {
        holdNumber: 32,
        modifier: 'plus',
        isTop: false,
        status: 'valid',
        reason: 'Le juge a mal lu le plan de voie, vérifié sur la vidéo.',
      },
    )
    expect(response.status).toBe(200)
    const corrected = (await response.json()) as { id: string; holdNumber: number; recordedByUserId: string | null }
    expect(corrected.holdNumber).toBe(32)
    expect(corrected.recordedByUserId).not.toBeNull()

    const originalRow = await handle.db.query.ascent.findFirst({ where: eq(ascent.id, originalId) })
    expect(originalRow?.supersededBy).toBe(corrected.id)
  })

  it('reste possible même après clôture du tour', async () => {
    const { fixture, roundId } = await setUp()
    const created = (await (
      await postBackupEntry(fixture.organizerToken, fixture.competition.id, {
        roundId,
        routeId: fixture.route.id,
        competitorId: fixture.competitor.id,
        holdNumber: 20,
        modifier: 'none',
        isTop: false,
        status: 'valid',
        recordedAt: fakeNow.toISOString(),
      })
    ).json()) as { ascent: { id: string } }

    await app.request(`/api/v1/competitions/${fixture.competition.id}/round-status/${roundId}`, {
      method: 'POST',
      headers: authHeaders(fixture.organizerToken),
      body: JSON.stringify({ status: 'closed' }),
    })

    const response = await patchCorrection(
      fixture.organizerToken,
      fixture.competition.id,
      created.ascent.id,
      { holdNumber: 25, modifier: 'none', isTop: false, status: 'valid', reason: 'Erreur de lecture initiale.' },
    )
    expect(response.status).toBe(200)
  })

  it('refuse de corriger un passage en conflit — redirige vers la résolution de conflit', async () => {
    const { fixture, judgeJwt, roundId } = await setUp()
    const batchResponse = await app.request('/api/v1/judge/ascents/batch', {
      method: 'POST',
      headers: judgeAuthHeaders(judgeJwt),
      body: JSON.stringify({
        items: [
          {
            kind: 'create',
            id: crypto.randomUUID(),
            roundId,
            routeId: fixture.route.id,
            competitorId: fixture.competitor.id,
            holdNumber: 20,
            modifier: 'none',
            isTop: false,
            status: 'valid',
            climbTimeMs: null,
            recordedAt: fakeNow.toISOString(),
            deviceId: 'device-A',
          },
          {
            kind: 'create',
            id: crypto.randomUUID(),
            roundId,
            routeId: fixture.route.id,
            competitorId: fixture.competitor.id,
            holdNumber: 28,
            modifier: 'none',
            isTop: false,
            status: 'valid',
            climbTimeMs: null,
            recordedAt: fakeNow.toISOString(),
            deviceId: 'device-B',
          },
        ],
      }),
    })
    const results = (await batchResponse.json()) as { results: { id: string }[] }
    const conflictedId = results.results[1]!.id

    const response = await patchCorrection(
      fixture.organizerToken,
      fixture.competition.id,
      conflictedId,
      { holdNumber: 25, modifier: 'none', isTop: false, status: 'valid', reason: 'Tentative.' },
    )
    expect(response.status).toBe(409)
  })
})
