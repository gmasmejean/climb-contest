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
  authenticateJudge,
  authHeaders,
  createJudgeFixture,
  judgeAuthHeaders,
  type JudgeFixture,
} from '../test-utils/fixtures'

/**
 * Trouvé par la répétition générale (Lot 9, `infra/scripts/rehearsal.ts`) :
 * en format contest à plusieurs voies, un compétiteur qui n'a pas de passage
 * ACTIF sur toutes les voies (pas encore grimpé, ou passage en conflit non
 * tranché) faisait répondre 500 au classement public de TOUTE la catégorie.
 * `buildRoundDetail` supposait un passage par voie, vrai seulement en format
 * phases (DNS synthétisés, ADR-041).
 */

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
    sql`truncate table "user", "club", "session", "competition", "round", "category", "competitor", "route", "route_category", "round_route", "ascent", "ascent_event", "activity_log", "judge", "judge_route" cascade`,
  )
})

interface Setup {
  f: JudgeFixture
  judgeJwt: string
  roundId: string
  route2Id: string
}

/** Contest à DEUX voies, 2 compétiteurs ; le juge est assigné aux deux voies. */
async function twoRouteContest(): Promise<Setup> {
  const f = await createJudgeFixture(app, mailer)
  const base = `/api/v1/competitions/${f.competition.id}`
  await app.request(`${base}/competitors`, {
    method: 'POST',
    headers: authHeaders(f.organizerToken),
    body: JSON.stringify({
      categoryId: f.category.id,
      bib: 2,
      firstName: 'Zoé',
      lastName: 'Petit',
    }),
  })
  const route2 = (await (
    await app.request(`${base}/routes`, {
      method: 'POST',
      headers: authHeaders(f.organizerToken),
      body: JSON.stringify({ number: 2, holdCount: 40, categoryIds: [f.category.id] }),
    })
  ).json()) as { id: string }
  const judgeJwt = await authenticateJudge(app, f.judge.accessToken, f.judge.pin)
  // Le juge de la fixture n'a que la voie 1 : on lui ajoute la voie 2 via un second juge.
  const judge2 = (await (
    await app.request(`${base}/judges`, {
      method: 'POST',
      headers: authHeaders(f.organizerToken),
      body: JSON.stringify({ displayName: 'Juge 2', routeIds: [route2.id] }),
    })
  ).json()) as { accessToken: string; pin?: string }
  const judge2Jwt = await authenticateJudge(app, judge2.accessToken, judge2.pin)
  const detail = (await (
    await app.request(`/api/v1/judge/routes/${f.route.id}`, { headers: judgeAuthHeaders(judgeJwt) })
  ).json()) as { round: { id: string } }
  return { f, judgeJwt: `${judgeJwt}|${judge2Jwt}`, roundId: detail.round.id, route2Id: route2.id }
}

async function record(
  s: Setup,
  which: 'judge1' | 'judge2',
  routeId: string,
  competitorId: string,
  holdNumber: number,
  deviceId = 'device-a',
) {
  const [jwt1, jwt2] = s.judgeJwt.split('|') as [string, string]
  const response = await app.request('/api/v1/judge/ascents/batch', {
    method: 'POST',
    headers: judgeAuthHeaders(which === 'judge1' ? jwt1 : jwt2),
    body: JSON.stringify({
      items: [
        {
          kind: 'create',
          id: crypto.randomUUID(),
          roundId: s.roundId,
          routeId,
          competitorId,
          holdNumber,
          modifier: 'none',
          isTop: false,
          status: 'valid',
          climbTimeMs: null,
          recordedAt: new Date().toISOString(),
          deviceId,
        },
      ],
    }),
  })
  return ((await response.json()) as { results: { status: string }[] }).results[0]?.status
}

const rankings = (s: Setup) =>
  app.request(
    `/api/v1/public/${String(s.f.competition['publicSlug'])}/rankings?category=${s.f.category.id}`,
  )

describe('classement public d’un contest à plusieurs voies', () => {
  it('un compétiteur qui n’a grimpé QU’UNE voie sur deux est classé, sans erreur', async () => {
    const s = await twoRouteContest()
    // Léa grimpe les deux voies, Zoé seulement la voie 2.
    await record(s, 'judge1', s.f.route.id, s.f.competitor.id, 30)
    await record(s, 'judge2', s.route2Id, s.f.competitor.id, 25)
    const zoe = (await (
      await app.request(`/api/v1/competitions/${s.f.competition.id}/competitors`, {
        headers: authHeaders(s.f.organizerToken),
      })
    ).json()) as { id: string; firstName: string }[]
    await record(s, 'judge2', s.route2Id, zoe.find((c) => c.firstName === 'Zoé')!.id, 20)

    const response = await rankings(s)

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      entries: { firstName: string; rounds: { routes: { routeNumber: number }[] }[] }[]
    }
    const zoeEntry = body.entries.find((e) => e.firstName === 'Zoé')
    expect(zoeEntry).toBeDefined()
    // Zoé n'a de détail que pour la voie qu'elle a grimpée.
    expect(zoeEntry!.rounds[0]!.routes.map((r) => r.routeNumber)).toEqual([2])
  })

  it('un passage en CONFLIT non tranché sur une voie ne fait pas tomber le classement de la catégorie', async () => {
    const s = await twoRouteContest()
    await record(s, 'judge2', s.route2Id, s.f.competitor.id, 25)
    // Deux appareils saisissent des valeurs différentes pour Léa sur la voie 1 : conflit.
    expect(await record(s, 'judge1', s.f.route.id, s.f.competitor.id, 30, 'device-a')).toBe(
      'accepted',
    )
    expect(await record(s, 'judge1', s.f.route.id, s.f.competitor.id, 33, 'device-b')).toBe(
      'conflict',
    )

    const response = await rankings(s)

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      entries: { firstName: string; rounds: { routes: { routeNumber: number }[] }[] }[]
    }
    const lea = body.entries.find((e) => e.firstName === 'Léa')
    expect(lea?.rounds[0]?.routes.map((r) => r.routeNumber)).toEqual([2])
  })

  it('un contest où PERSONNE n’a encore grimpé la voie 2 reste lisible', async () => {
    const s = await twoRouteContest()
    await record(s, 'judge1', s.f.route.id, s.f.competitor.id, 30)

    const response = await rankings(s)

    expect(response.status).toBe(200)
    expect(((await response.json()) as { entries: unknown[] }).entries).toHaveLength(1)
  })
})
