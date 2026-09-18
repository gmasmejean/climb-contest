import { applyPendingMigrations, createDatabase, type DatabaseHandle } from '@climbcontest/db'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { sql } from 'drizzle-orm'
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
  type JudgeFixture,
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

async function postStatus(accessToken: string, competitionId: string, roundId: string, status: string) {
  return app.request(`/api/v1/competitions/${competitionId}/round-status/${roundId}`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify({ status }),
  })
}

async function draftPhasesRound() {
  // `openRound: false` laisse le tour en `draft` (fixtures.ts).
  const fixture = await createJudgeFixture(app, mailer, { format: 'phases', openRound: false })
  const routesResponse = await app.request(
    `/api/v1/competitions/${fixture.competition.id}/rounds`,
    { headers: authHeaders(fixture.organizerToken) },
  )
  const rounds = (await routesResponse.json()) as { id: string; status: string }[]
  const roundId = rounds[0]?.id
  if (!roundId) throw new Error('Tour introuvable dans la fixture.')
  return { fixture, roundId }
}

async function createConflict(fixture: JudgeFixture, roundId: string) {
  const judgeJwt = await authenticateJudge(app, fixture.judge.accessToken, fixture.judge.pin)
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
  await app.request('/api/v1/judge/ascents/batch', {
    method: 'POST',
    headers: judgeAuthHeaders(judgeJwt),
    body: JSON.stringify({
      items: [
        { ...base, id: crypto.randomUUID(), holdNumber: 20, deviceId: 'device-A' },
        { ...base, id: crypto.randomUUID(), holdNumber: 28, deviceId: 'device-B' },
      ],
    }),
  })
}

describe('POST /competitions/:id/rounds/:roundId/status', () => {
  it('ouvre un tour brouillon', async () => {
    const { fixture, roundId } = await draftPhasesRound()
    const response = await postStatus(fixture.organizerToken, fixture.competition.id, roundId, 'open')
    expect(response.status).toBe(200)
    expect(((await response.json()) as { status: string }).status).toBe('open')
  })

  it('refuse de sauter directement de draft à published', async () => {
    const { fixture, roundId } = await draftPhasesRound()
    const response = await postStatus(
      fixture.organizerToken,
      fixture.competition.id,
      roundId,
      'published',
    )
    expect(response.status).toBe(409)
  })

  it('refuse de rouvrir un tour publié sans passer par closed', async () => {
    const { fixture, roundId } = await draftPhasesRound()
    await postStatus(fixture.organizerToken, fixture.competition.id, roundId, 'open')
    await postStatus(fixture.organizerToken, fixture.competition.id, roundId, 'closed')
    await postStatus(fixture.organizerToken, fixture.competition.id, roundId, 'published')

    const response = await postStatus(
      fixture.organizerToken,
      fixture.competition.id,
      roundId,
      'draft',
    )
    expect(response.status).toBe(409)
  })

  it('permet de rouvrir un tour fermé, et de dépublier un tour publié', async () => {
    const { fixture, roundId } = await draftPhasesRound()
    await postStatus(fixture.organizerToken, fixture.competition.id, roundId, 'open')
    await postStatus(fixture.organizerToken, fixture.competition.id, roundId, 'closed')

    const reopened = await postStatus(fixture.organizerToken, fixture.competition.id, roundId, 'open')
    expect(reopened.status).toBe(200)

    await postStatus(fixture.organizerToken, fixture.competition.id, roundId, 'closed')
    const published = await postStatus(
      fixture.organizerToken,
      fixture.competition.id,
      roundId,
      'published',
    )
    expect(published.status).toBe(200)

    const unpublished = await postStatus(
      fixture.organizerToken,
      fixture.competition.id,
      roundId,
      'closed',
    )
    expect(unpublished.status).toBe(200)
  })

  it('bloque la publication tant qu’un conflit de saisie n’est pas résolu', async () => {
    const { fixture, roundId } = await draftPhasesRound()
    await postStatus(fixture.organizerToken, fixture.competition.id, roundId, 'open')
    await createConflict(fixture, roundId)
    await postStatus(fixture.organizerToken, fixture.competition.id, roundId, 'closed')

    const response = await postStatus(
      fixture.organizerToken,
      fixture.competition.id,
      roundId,
      'published',
    )
    expect(response.status).toBe(409)
  })

  it('fonctionne aussi pour le tour implicite du format contest (ADR-040)', async () => {
    // Format contest : la compétition passant à `running` ouvre déjà le
    // round implicite (ADR-030) — on part directement de `open`.
    const fixture = await createJudgeFixture(app, mailer, { format: 'contest' })
    const judgeJwt = await authenticateJudge(app, fixture.judge.accessToken, fixture.judge.pin)
    const routeDetail = (await (
      await app.request(`/api/v1/judge/routes/${fixture.route.id}`, {
        headers: judgeAuthHeaders(judgeJwt),
      })
    ).json()) as { round: { id: string } }
    const roundId = routeDetail.round.id

    const closed = await postStatus(fixture.organizerToken, fixture.competition.id, roundId, 'closed')
    expect(closed.status).toBe(200)
    const published = await postStatus(
      fixture.organizerToken,
      fixture.competition.id,
      roundId,
      'published',
    )
    expect(published.status).toBe(200)
  })

  it('écrit une entrée dans le journal d’activité', async () => {
    const { fixture, roundId } = await draftPhasesRound()
    await postStatus(fixture.organizerToken, fixture.competition.id, roundId, 'open')

    const row = await handle.db.query.activityLog.findFirst({
      where: (log, { eq }) => eq(log.entityId, roundId),
    })
    expect(row?.eventType).toBe('round_status_changed')
    expect(row?.actorType).toBe('organizer')
    expect(row?.payload).toMatchObject({ from: 'draft', to: 'open' })
  })
})
