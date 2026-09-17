import {
  ascentEvent,
  applyPendingMigrations,
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
  authenticateJudge,
  createJudgeFixture,
  judgeAuthHeaders,
  type JudgeFixture,
} from '../test-utils/fixtures'

let container: StartedPostgreSqlContainer
let handle: DatabaseHandle
let mailer: FakeMailer
let app: ReturnType<typeof createApp>

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
  app = createApp({
    env,
    db: handle.db,
    mailer,
    logger: { info: () => {} } as unknown as Logger,
    accessTokenSigner: createAccessTokenSigner(env.JWT_ACCESS_SECRET),
    judgeTokenSigner: createJudgeTokenSigner(env.JWT_JUDGE_SECRET),
  })
})

afterEach(async () => {
  await handle.db.execute(
    sql`truncate table "user", "club", "session", "competition", "round", "category", "competitor", "route", "route_category", "round_route", "ascent", "ascent_event", "judge", "judge_route" cascade`,
  )
})

interface AscentBody {
  id: string
  roundId: string
  routeId: string
  competitorId: string
  holdNumber: number | null
  modifier: 'none' | 'plus'
  isTop: boolean
  status: 'valid' | 'dns' | 'dnf' | 'dsq'
  climbTimeMs: number | null
}

async function setUp(overrides?: Parameters<typeof createJudgeFixture>[2]) {
  const fixture = await createJudgeFixture(app, mailer, overrides)
  const judgeJwt = await authenticateJudge(app, fixture.judge.accessToken, fixture.judge.pin)
  const routeDetailResponse = await app.request(`/api/v1/judge/routes/${fixture.route.id}`, {
    headers: judgeAuthHeaders(judgeJwt),
  })
  const routeDetail = (await routeDetailResponse.json()) as { round: { id: string } }
  return { fixture, judgeJwt, roundId: routeDetail.round.id }
}

function ascentPayload(
  fixture: JudgeFixture,
  roundId: string,
  overrides: Partial<{
    id: string
    holdNumber: number | null
    modifier: 'none' | 'plus'
    isTop: boolean
    status: 'valid' | 'dns' | 'dnf'
    climbTimeMs: number | null
  }> = {},
) {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    roundId,
    routeId: fixture.route.id,
    competitorId: fixture.competitor.id,
    holdNumber: overrides.holdNumber !== undefined ? overrides.holdNumber : 25,
    modifier: overrides.modifier ?? 'none',
    isTop: overrides.isTop ?? false,
    status: overrides.status ?? 'valid',
    climbTimeMs: overrides.climbTimeMs ?? null,
    recordedAt: new Date().toISOString(),
    deviceId: 'device-test-1',
  }
}

async function postAscent(judgeJwt: string, body: unknown) {
  return app.request('/api/v1/judge/ascents', {
    method: 'POST',
    headers: judgeAuthHeaders(judgeJwt),
    body: JSON.stringify(body),
  })
}

describe('POST /judge/ascents', () => {
  it('accepte une prise en limite basse (1)', async () => {
    const { fixture, judgeJwt, roundId } = await setUp()
    const response = await postAscent(judgeJwt, ascentPayload(fixture, roundId, { holdNumber: 1 }))
    expect(response.status).toBe(201)
    const body = (await response.json()) as AscentBody
    expect(body.holdNumber).toBe(1)
  })

  it('accepte une prise en limite haute (hold_count)', async () => {
    const { fixture, judgeJwt, roundId } = await setUp({ holdCount: 40 })
    const response = await postAscent(judgeJwt, ascentPayload(fixture, roundId, { holdNumber: 40 }))
    expect(response.status).toBe(201)
  })

  it('refuse une prise au-delà de hold_count', async () => {
    const { fixture, judgeJwt, roundId } = await setUp({ holdCount: 40 })
    const response = await postAscent(judgeJwt, ascentPayload(fixture, roundId, { holdNumber: 41 }))
    expect(response.status).toBe(400)
  })

  it('refuse un TOP qui porte quand même un numéro de prise (validation de forme)', async () => {
    const { fixture, judgeJwt, roundId } = await setUp()
    const response = await postAscent(judgeJwt, {
      ...ascentPayload(fixture, roundId, { isTop: true }),
      holdNumber: 25,
    })
    expect(response.status).toBe(400)
  })

  it('enregistre un TOP (holdNumber = null)', async () => {
    const { fixture, judgeJwt, roundId } = await setUp()
    const response = await postAscent(
      judgeJwt,
      ascentPayload(fixture, roundId, { isTop: true, holdNumber: null }),
    )
    expect(response.status).toBe(201)
    const body = (await response.json()) as AscentBody
    expect(body.isTop).toBe(true)
    expect(body.holdNumber).toBeNull()
  })

  it('vide holdNumber et isTop pour un DNS', async () => {
    const { fixture, judgeJwt, roundId } = await setUp()
    const response = await postAscent(
      judgeJwt,
      ascentPayload(fixture, roundId, { status: 'dns', holdNumber: null, isTop: false }),
    )
    expect(response.status).toBe(201)
    const body = (await response.json()) as AscentBody
    expect(body.status).toBe('dns')
    expect(body.holdNumber).toBeNull()
    expect(body.isTop).toBe(false)
  })

  it('refuse un DNF qui porte un numéro de prise (validation de forme)', async () => {
    const { fixture, judgeJwt, roundId } = await setUp()
    const response = await postAscent(judgeJwt, {
      ...ascentPayload(fixture, roundId, { status: 'dnf' }),
      holdNumber: 10,
    })
    expect(response.status).toBe(400)
  })

  it('rejoue le même id de façon idempotente (même triplet)', async () => {
    const { fixture, judgeJwt, roundId } = await setUp()
    const payload = ascentPayload(fixture, roundId, { holdNumber: 30 })
    const first = await postAscent(judgeJwt, payload)
    expect(first.status).toBe(201)
    const second = await postAscent(judgeJwt, payload)
    expect(second.status).toBe(200)
    const firstBody = (await first.json()) as AscentBody
    const secondBody = (await second.json()) as AscentBody
    expect(secondBody.id).toBe(firstBody.id)
  })

  it('refuse un même id réutilisé avec un contenu différent (409)', async () => {
    const { fixture, judgeJwt, roundId } = await setUp()
    const id = crypto.randomUUID()
    const first = await postAscent(
      judgeJwt,
      ascentPayload(fixture, roundId, { id, holdNumber: 20 }),
    )
    expect(first.status).toBe(201)

    // Même id, même triplet (tour, voie, compétiteur), mais une prise
    // différente : ce n'est pas un rejeu identique d'un réessai réseau, donc
    // pas une réussite silencieuse (200) — signalé explicitement.
    const second = await postAscent(
      judgeJwt,
      ascentPayload(fixture, roundId, { id, holdNumber: 21 }),
    )
    expect(second.status).toBe(409)
  })

  it('refuse un second passage pour le même (tour, voie, compétiteur) avec un id différent', async () => {
    const { fixture, judgeJwt, roundId } = await setUp()
    const first = await postAscent(judgeJwt, ascentPayload(fixture, roundId, { holdNumber: 20 }))
    expect(first.status).toBe(201)

    const second = await postAscent(judgeJwt, ascentPayload(fixture, roundId, { holdNumber: 22 }))
    expect(second.status).toBe(409)
  })

  it('refuse une voie non assignée au juge (404 générique)', async () => {
    const { judgeJwt, roundId } = await setUp()
    const other = await createJudgeFixture(app, mailer)
    const response = await postAscent(judgeJwt, ascentPayload(other, roundId, { holdNumber: 10 }))
    expect(response.status).toBe(404)
  })

  it("refuse un tour qui n'est pas ouvert pour cette voie", async () => {
    const fixture = await createJudgeFixture(app, mailer, { format: 'phases', openRound: false })
    const judgeJwt = await authenticateJudge(app, fixture.judge.accessToken, fixture.judge.pin)
    // Le round « existe » (créé en `draft`, `round_route` câblé) mais n'a
    // jamais été ouvert pour cette voie — `GET /judge/routes/:routeId` ne le
    // renvoie donc pas (round: null), il faut le retrouver côté organisateur.
    const draftRoundsResponse = await app.request(
      `/api/v1/competitions/${fixture.competition.id}/rounds`,
      { headers: { authorization: `Bearer ${fixture.organizerToken}` } },
    )
    const [draftRound] = (await draftRoundsResponse.json()) as Array<{ id: string }>
    const response = await postAscent(
      judgeJwt,
      ascentPayload(fixture, draftRound?.id ?? crypto.randomUUID(), { holdNumber: 10 }),
    )
    expect(response.status).toBe(404)
  })

  it('écrit un événement `ascent_event` de type `created`', async () => {
    const { fixture, judgeJwt, roundId } = await setUp()
    const response = await postAscent(judgeJwt, ascentPayload(fixture, roundId, { holdNumber: 18 }))
    expect(response.status).toBe(201)
    const body = (await response.json()) as AscentBody

    const events = await handle.db.query.ascentEvent.findMany({
      where: eq(ascentEvent.ascentId, body.id),
    })
    expect(events).toHaveLength(1)
    expect(events[0]?.eventType).toBe('created')
    expect(events[0]?.actorType).toBe('judge')
  })
})
