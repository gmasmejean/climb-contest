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

async function postStatus(
  accessToken: string,
  competitionId: string,
  roundId: string,
  status: string,
  categoryIds: string[],
) {
  return app.request(`/api/v1/competitions/${competitionId}/round-status/${roundId}`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify({ status, categoryIds }),
  })
}

async function draftPhasesRound() {
  // `openRound: false` laisse le tour en `draft` (fixtures.ts).
  const fixture = await createJudgeFixture(app, mailer, { format: 'phases', openRound: false })
  const routesResponse = await app.request(
    `/api/v1/competitions/${fixture.competition.id}/rounds`,
    { headers: authHeaders(fixture.organizerToken) },
  )
  const rounds = (await routesResponse.json()) as { id: string }[]
  const roundId = rounds[0]?.id
  if (!roundId) throw new Error('Tour introuvable dans la fixture.')
  const categoryIds = [fixture.category.id]
  /** Passe la (seule) catégorie du tour à `status`. */
  const to = (status: string) =>
    postStatus(fixture.organizerToken, fixture.competition.id, roundId, status, categoryIds)
  return { fixture, roundId, categoryIds, to }
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

describe('POST /competitions/:id/round-status/:roundId', () => {
  it('ouvre un tour brouillon pour la catégorie demandée', async () => {
    const { to, roundId, categoryIds } = await draftPhasesRound()
    const response = await to('open')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      roundId,
      categories: [{ categoryId: categoryIds[0], status: 'open' }],
      competitionStatus: 'running',
    })
  })

  it('refuse de sauter directement de draft à published', async () => {
    const { to } = await draftPhasesRound()
    expect((await to('published')).status).toBe(409)
  })

  it('refuse de rouvrir un tour publié sans passer par closed', async () => {
    const { to } = await draftPhasesRound()
    await to('open')
    await to('closed')
    await to('published')

    expect((await to('draft')).status).toBe(409)
  })

  it('permet de rouvrir un tour fermé, et de dépublier un tour publié', async () => {
    const { to } = await draftPhasesRound()
    await to('open')
    await to('closed')

    expect((await to('open')).status).toBe(200)

    await to('closed')
    expect((await to('published')).status).toBe(200)
    expect((await to('closed')).status).toBe(200)
  })

  it('bloque la publication tant qu’un conflit de saisie n’est pas résolu', async () => {
    const { fixture, roundId, to } = await draftPhasesRound()
    await to('open')
    await createConflict(fixture, roundId)
    await to('closed')

    expect((await to('published')).status).toBe(409)
  })

  it('fonctionne aussi pour le tour implicite du format contest (ADR-040)', async () => {
    // Format contest : la fixture ouvre le round implicite par catégorie
    // (`openContestRound`, ADR-065) — on part directement de `open`.
    const fixture = await createJudgeFixture(app, mailer, { format: 'contest' })
    const judgeJwt = await authenticateJudge(app, fixture.judge.accessToken, fixture.judge.pin)
    const routeDetail = (await (
      await app.request(`/api/v1/judge/routes/${fixture.route.id}`, {
        headers: judgeAuthHeaders(judgeJwt),
      })
    ).json()) as { round: { id: string } }
    const roundId = routeDetail.round.id
    const to = (status: string) =>
      postStatus(fixture.organizerToken, fixture.competition.id, roundId, status, [
        fixture.category.id,
      ])

    expect((await to('closed')).status).toBe(200)
    expect((await to('published')).status).toBe(200)
  })

  it('écrit une entrée par catégorie dans le journal d’activité', async () => {
    const { to, roundId, categoryIds, fixture } = await draftPhasesRound()
    await to('open')

    const row = await handle.db.query.activityLog.findFirst({
      where: (log, { eq }) => eq(log.entityId, roundId),
    })
    expect(row?.eventType).toBe('round_status_changed')
    expect(row?.actorType).toBe('organizer')
    expect(row?.payload).toMatchObject({
      from: 'draft',
      to: 'open',
      categoryId: categoryIds[0],
      categoryLabel: fixture.category.label,
    })
  })

  it('est idempotent : redemander l’état actuel ne change rien et n’écrit rien', async () => {
    const { to, roundId } = await draftPhasesRound()
    await to('open')
    const before = await handle.db.query.activityLog.findMany({
      where: (log, { eq }) => eq(log.entityId, roundId),
    })

    const again = await to('open')
    expect(again.status).toBe(200)
    const after = await handle.db.query.activityLog.findMany({
      where: (log, { eq }) => eq(log.entityId, roundId),
    })
    expect(after).toHaveLength(before.length)
  })

  it('ouvrir une catégorie fait démarrer la compétition, et le journal le dit (ADR-065)', async () => {
    const { fixture, to } = await draftPhasesRound()
    const before = await handle.db.query.competition.findFirst({
      where: (c, { eq }) => eq(c.id, fixture.competition.id),
    })
    expect(before?.status).toBe('draft')

    await to('open')

    const after = await handle.db.query.competition.findFirst({
      where: (c, { eq }) => eq(c.id, fixture.competition.id),
    })
    expect(after?.status).toBe('running')
    const log = await handle.db.query.activityLog.findFirst({
      where: (l, { eq }) => eq(l.competitionId, fixture.competition.id),
    })
    expect(log?.payload).toMatchObject({ competitionStatusFrom: 'draft' })
  })

  it('refuse une liste de catégories vide, avec un message en français', async () => {
    const { fixture, roundId } = await draftPhasesRound()
    const response = await postStatus(
      fixture.organizerToken,
      fixture.competition.id,
      roundId,
      'open',
      [],
    )
    expect(response.status).toBe(400)
    expect(((await response.json()) as { detail: string }).detail).toBe(
      'Choisissez au moins une catégorie.',
    )
  })

  it('refuse une catégorie qui ne fait pas partie du tour', async () => {
    const { fixture, roundId } = await draftPhasesRound()
    const stranger = await app.request(
      `/api/v1/competitions/${fixture.competition.id}/categories`,
      {
        method: 'POST',
        headers: authHeaders(fixture.organizerToken),
        body: JSON.stringify({ label: 'Hors tour', sex: 'X' }),
      },
    )
    const { id: strangerId } = (await stranger.json()) as { id: string }

    const response = await postStatus(
      fixture.organizerToken,
      fixture.competition.id,
      roundId,
      'open',
      [strangerId],
    )
    expect(response.status).toBe(404)
    expect(((await response.json()) as { title: string }).title).toBe('Catégorie introuvable')
  })
})
