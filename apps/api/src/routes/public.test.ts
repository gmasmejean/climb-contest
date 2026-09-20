import { applyPendingMigrations, createDatabase, type DatabaseHandle } from '@climbcontest/db'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { sql } from 'drizzle-orm'
import pg from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createApp } from '../app'
import type { Env } from '../env'
import { createAccessTokenSigner, createJudgeTokenSigner } from '../lib/jwt'
import type { Logger } from '../lib/logger'
import { createPublicRankingCache, type PublicRankingCache } from '../lib/public-cache'
import { createRealtimeBridge, type RealtimeBridge } from '../lib/realtime-bridge'
import { FakeMailer } from '../test-utils/fake-mailer'
import {
  authenticateJudge,
  authHeaders,
  createJudgeFixture,
  judgeAuthHeaders,
  openContestRound,
  type JudgeFixture,
} from '../test-utils/fixtures'

let container: StartedPostgreSqlContainer
let handle: DatabaseHandle
let mailer: FakeMailer
let app: ReturnType<typeof createApp>
let cache: PublicRankingCache
let bridge: RealtimeBridge

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
const silentLogger = { info: () => {}, warn: () => {}, error: () => {} } as unknown as Logger

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16.15-alpine').start()
  const client = new pg.Client({ connectionString: container.getConnectionUri() })
  await client.connect()
  await applyPendingMigrations(client)
  await client.end()
  handle = createDatabase(container.getConnectionUri())
  // Vrai pont LISTEN/NOTIFY (pas le défaut inoffensif de `createApp`) :
  // les tests d'invalidation de cache ci-dessous en dépendent réellement.
  bridge = createRealtimeBridge(container.getConnectionUri(), { logger: silentLogger })
  await sleep(500)
}, 180_000)

afterAll(async () => {
  await bridge.close()
  await handle.close()
  await container.stop()
})

beforeEach(() => {
  mailer = new FakeMailer()
  cache = createPublicRankingCache()
  app = createApp({
    env,
    db: handle.db,
    mailer,
    logger: silentLogger,
    accessTokenSigner: createAccessTokenSigner(env.JWT_ACCESS_SECRET),
    judgeTokenSigner: createJudgeTokenSigner(env.JWT_JUDGE_SECRET),
    publicRankingCache: cache,
    realtimeBridge: bridge,
  })
})

afterEach(async () => {
  await handle.db.execute(
    sql`truncate table "user", "club", "session", "competition", "round", "category", "competitor", "route", "route_category", "round_route", "ascent", "ascent_event", "judge", "judge_route" cascade`,
  )
})

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function addCompetitor(
  organizerToken: string,
  competitionId: string,
  categoryId: string,
  overrides: { bib?: number; firstName?: string; lastName?: string; clubName?: string } = {},
) {
  const response = await app.request(`/api/v1/competitions/${competitionId}/competitors`, {
    method: 'POST',
    headers: authHeaders(organizerToken),
    body: JSON.stringify({
      categoryId,
      bib: overrides.bib ?? 2,
      firstName: overrides.firstName ?? 'Zoé',
      lastName: overrides.lastName ?? 'Petit',
      clubName: overrides.clubName ?? 'Club Voisin',
    }),
  })
  if (response.status !== 201) {
    throw new Error(`addCompetitor failed: ${response.status} ${await response.text()}`)
  }
  return (await response.json()) as { id: string; bib: number; firstName: string; lastName: string }
}

async function judgeRoundId(fixture: JudgeFixture, judgeJwt: string): Promise<string> {
  const response = await app.request(`/api/v1/judge/routes/${fixture.route.id}`, {
    headers: judgeAuthHeaders(judgeJwt),
  })
  const body = (await response.json()) as { round: { id: string } | null }
  if (!body.round) throw new Error('Aucun tour ouvert pour cette voie.')
  return body.round.id
}

function ascentItem(
  fixture: JudgeFixture,
  roundId: string,
  competitorId: string,
  overrides: Partial<{
    holdNumber: number | null
    modifier: 'none' | 'plus'
    isTop: boolean
    status: 'valid' | 'dns' | 'dnf'
  }> = {},
) {
  return {
    kind: 'create' as const,
    id: crypto.randomUUID(),
    roundId,
    routeId: fixture.route.id,
    competitorId,
    holdNumber: overrides.holdNumber !== undefined ? overrides.holdNumber : 20,
    modifier: overrides.modifier ?? 'none',
    isTop: overrides.isTop ?? false,
    status: overrides.status ?? 'valid',
    recordedAt: new Date().toISOString(),
    deviceId: 'device-test',
  }
}

async function postAscent(judgeJwt: string, item: ReturnType<typeof ascentItem>) {
  const response = await app.request('/api/v1/judge/ascents/batch', {
    method: 'POST',
    headers: judgeAuthHeaders(judgeJwt),
    body: JSON.stringify({ items: [item] }),
  })
  const body = (await response.json()) as { results: { status: string }[] }
  if (body.results[0]?.status !== 'accepted') {
    throw new Error(`postAscent: statut inattendu ${JSON.stringify(body)}`)
  }
}

interface PublicRankingEntryBody {
  rank: number
  bib: number | null
  firstName: string
  lastName: string
  club: string | null
  rounds: { roundType: string; routes: { status: string; routeRank: number }[] }[]
}
interface PublicRankingBody {
  categoryId: string
  started: boolean
  provisional: boolean
  entries: PublicRankingEntryBody[]
}

describe('GET /public/:slug', () => {
  it('renvoie 404 pour un slug inconnu', async () => {
    const response = await app.request('/api/v1/public/slug-inconnu')
    expect(response.status).toBe(404)
  })

  it('ne renvoie aucune donnée organisateur (métadonnées publiques uniquement)', async () => {
    const fixture = await createJudgeFixture(app, mailer, { format: 'contest' })
    const response = await app.request(`/api/v1/public/${fixture.competition.publicSlug as string}`)
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).not.toContain('scoringConfig')
    expect(text).not.toContain('clubId')
    const body = JSON.parse(text) as { competition: { slug: string; format: string }; rounds: unknown[] }
    expect(body.competition.slug).toBe(fixture.competition.publicSlug)
    // Round implicite du contest jamais exposé (ADR-023).
    expect(body.rounds).toEqual([])
  })

  it('expose les tours pour le format phases', async () => {
    const fixture = await createJudgeFixture(app, mailer, { format: 'phases', openRound: true })
    const response = await app.request(`/api/v1/public/${fixture.competition.publicSlug as string}`)
    const body = (await response.json()) as {
      rounds: { categories: { categoryId: string; status: string }[] }[]
    }
    expect(body.rounds).toHaveLength(1)
    // ADR-065 : un état par catégorie.
    expect(body.rounds[0]?.categories).toEqual([{ categoryId: fixture.category.id, status: 'open' }])
  })
})

describe('GET /public/:slug/rankings', () => {
  it('renvoie 404 pour une catégorie qui n’appartient pas à cette compétition', async () => {
    const fixture = await createJudgeFixture(app, mailer, { format: 'contest' })
    const response = await app.request(
      `/api/v1/public/${fixture.competition.publicSlug as string}/rankings?category=${crypto.randomUUID()}`,
    )
    expect(response.status).toBe(404)
  })

  it('renvoie « pas démarré » si aucun tour ne concerne encore la catégorie', async () => {
    const fixture = await createJudgeFixture(app, mailer, {
      format: 'phases',
      openRound: false,
    })
    const response = await app.request(
      `/api/v1/public/${fixture.competition.publicSlug as string}/rankings?category=${fixture.category.id}`,
    )
    const body = (await response.json()) as PublicRankingBody
    expect(body.started).toBe(false)
    expect(body.entries).toEqual([])
  })

  it('classe deux compétiteurs en format contest, sans PII', async () => {
    const fixture = await createJudgeFixture(app, mailer, { format: 'contest' })
    const judgeJwt = await authenticateJudge(app, fixture.judge.accessToken, fixture.judge.pin)
    const roundId = await judgeRoundId(fixture, judgeJwt)
    const second = await addCompetitor(fixture.organizerToken, fixture.competition.id, fixture.category.id)

    // fixture.competitor (bib 1) : TOP. second (bib 2) : prise 20.
    await postAscent(judgeJwt, ascentItem(fixture, roundId, fixture.competitor.id, { isTop: true, holdNumber: null }))
    await postAscent(judgeJwt, ascentItem(fixture, roundId, second.id, { holdNumber: 20 }))

    const response = await app.request(
      `/api/v1/public/${fixture.competition.publicSlug as string}/rankings?category=${fixture.category.id}`,
    )
    const text = await response.text()
    expect(text).not.toContain('licenseNumber')
    expect(text).not.toContain('birthYear')

    const body = JSON.parse(text) as PublicRankingBody
    expect(body.started).toBe(true)
    expect(body.entries).toHaveLength(2)
    expect(body.entries[0]).toMatchObject({ rank: 1, bib: fixture.competitor.bib })
    expect(body.entries[1]).toMatchObject({ rank: 2, bib: second.bib })
  })

  it('format contest : deux catégories sur la même voie ne se mélangent pas dans leurs classements', async () => {
    const fixture = await createJudgeFixture(app, mailer, { format: 'contest', openRound: false })
    const categoryResponse = await app.request(`/api/v1/competitions/${fixture.competition.id}/categories`, {
      method: 'POST',
      headers: authHeaders(fixture.organizerToken),
      body: JSON.stringify({ label: 'Autre catégorie', sex: 'X' }),
    })
    const otherCategory = (await categoryResponse.json()) as { id: string }
    const otherCompetitor = await addCompetitor(
      fixture.organizerToken,
      fixture.competition.id,
      otherCategory.id,
      { bib: 2 },
    )
    // La voie sert les deux catégories : c'est le cas du bug, `ascent` n'a pas de catégorie.
    const patchResponse = await app.request(
      `/api/v1/competitions/${fixture.competition.id}/routes/${fixture.route.id}`,
      {
        method: 'PATCH',
        headers: authHeaders(fixture.organizerToken),
        body: JSON.stringify({ categoryIds: [fixture.category.id, otherCategory.id] }),
      },
    )
    expect(patchResponse.status).toBe(200)
    await openContestRound(app, fixture.organizerToken, fixture.competition.id)

    const judgeJwt = await authenticateJudge(app, fixture.judge.accessToken, fixture.judge.pin)
    const roundId = await judgeRoundId(fixture, judgeJwt)
    await postAscent(judgeJwt, ascentItem(fixture, roundId, fixture.competitor.id, { holdNumber: 25 }))
    await postAscent(judgeJwt, ascentItem(fixture, roundId, otherCompetitor.id, { holdNumber: 20 }))

    for (const [categoryId, expectedBib] of [
      [fixture.category.id, fixture.competitor.bib],
      [otherCategory.id, otherCompetitor.bib],
    ] as const) {
      const response = await app.request(
        `/api/v1/public/${fixture.competition.publicSlug as string}/rankings?category=${categoryId}`,
      )
      const body = (await response.json()) as PublicRankingBody
      expect(body.entries).toHaveLength(1)
      expect(body.entries[0]).toMatchObject({ rank: 1, bib: expectedBib })
    }
  })

  it(
    'format phases : un tour ouvert incomplet synthétise un DNS pour qui n’a pas encore grimpé, et marque « provisoire »',
    async () => {
      const fixture = await createJudgeFixture(app, mailer, { format: 'phases', openRound: true })
      const judgeJwt = await authenticateJudge(app, fixture.judge.accessToken, fixture.judge.pin)
      const roundId = await judgeRoundId(fixture, judgeJwt)
      const second = await addCompetitor(
        fixture.organizerToken,
        fixture.competition.id,
        fixture.category.id,
      )

      // Seul `fixture.competitor` a grimpé — `second` n'a encore rien saisi.
      await postAscent(judgeJwt, ascentItem(fixture, roundId, fixture.competitor.id, { holdNumber: 30 }))

      const response = await app.request(
        `/api/v1/public/${fixture.competition.publicSlug as string}/rankings?category=${fixture.category.id}`,
      )
      const body = (await response.json()) as PublicRankingBody
      expect(body.started).toBe(true)
      expect(body.provisional).toBe(true)
      expect(body.entries).toHaveLength(2)

      const secondEntry = body.entries.find((e) => e.bib === second.bib)
      expect(secondEntry?.rounds[0]?.routes[0]?.status).toBe('dns')
      const firstEntry = body.entries.find((e) => e.bib === fixture.competitor.bib)
      expect(firstEntry?.rounds[0]?.routes[0]?.status).toBe('valid')
      // Absent sur la voie = rang le plus défavorable de la voie (SPEC.md §4.3/ADR-016).
      expect(secondEntry!.rounds[0]!.routes[0]!.routeRank).toBeGreaterThan(
        firstEntry!.rounds[0]!.routes[0]!.routeRank,
      )
    },
    15_000,
  )

  it(
    'publier le tour retire le marquage « provisoire » (invalidation de cache réelle via NOTIFY)',
    async () => {
      const fixture = await createJudgeFixture(app, mailer, { format: 'phases', openRound: true })
      const judgeJwt = await authenticateJudge(app, fixture.judge.accessToken, fixture.judge.pin)
      const roundId = await judgeRoundId(fixture, judgeJwt)
      await postAscent(judgeJwt, ascentItem(fixture, roundId, fixture.competitor.id, { isTop: true, holdNumber: null }))

      const beforePublish = await app.request(
        `/api/v1/public/${fixture.competition.publicSlug as string}/rankings?category=${fixture.category.id}`,
      )
      expect(((await beforePublish.json()) as PublicRankingBody).provisional).toBe(true)

      // Lot 8 : transition séquentielle — un tour ouvert doit être fermé
      // avant de pouvoir être publié (DECISIONS.md).
      await app.request(`/api/v1/competitions/${fixture.competition.id}/round-status/${roundId}`, {
        method: 'POST',
        headers: authHeaders(fixture.organizerToken),
        body: JSON.stringify({ status: 'closed', categoryIds: [fixture.category.id] }),
      })
      await app.request(`/api/v1/competitions/${fixture.competition.id}/round-status/${roundId}`, {
        method: 'POST',
        headers: authHeaders(fixture.organizerToken),
        body: JSON.stringify({ status: 'published', categoryIds: [fixture.category.id] }),
      })
      // Laisse le temps au NOTIFY d'atteindre le bridge et d'invalider le cache.
      await sleep(500)

      const afterPublish = await app.request(
        `/api/v1/public/${fixture.competition.publicSlug as string}/rankings?category=${fixture.category.id}`,
      )
      expect(((await afterPublish.json()) as PublicRankingBody).provisional).toBe(false)
    },
    15_000,
  )
})

describe('GET /public/:slug/routes', () => {
  it('renvoie les voies de la catégorie, sans notes ni identifiant de fichier vidéo', async () => {
    const fixture = await createJudgeFixture(app, mailer, { format: 'contest' })
    const response = await app.request(
      `/api/v1/public/${fixture.competition.publicSlug as string}/routes?category=${fixture.category.id}`,
    )
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).not.toContain('notes')
    expect(text).not.toContain('videoAssetId')
    const body = JSON.parse(text) as { id: string; number: number; holdCount: number }[]
    expect(body).toHaveLength(1)
    expect(body[0]).toMatchObject({ id: fixture.route.id, number: fixture.route.number })
  })
})

describe('limitation de débit publique — distincte et plus généreuse que celle de l’auth', () => {
  it('applique une limite spécifique et généreuse sur les endpoints de lecture', async () => {
    const fixture = await createJudgeFixture(app, mailer, { format: 'contest' })
    const response = await app.request(`/api/v1/public/${fixture.competition.publicSlug as string}`)
    expect(response.headers.get('ratelimit-limit')).toBe('600')
  })

  it('applique une limite dédiée, distincte, sur l’ouverture du flux SSE', async () => {
    const fixture = await createJudgeFixture(app, mailer, { format: 'contest' })
    const controller = new AbortController()
    const response = await app.request(`/api/v1/public/${fixture.competition.publicSlug as string}/stream`, {
      signal: controller.signal,
    })
    expect(response.headers.get('ratelimit-limit')).toBe('300')
    controller.abort()
  })
})

describe('GET /public/:slug/stream', () => {
  it(
    'diffuse ranking_updated quand un passage est saisi',
    async () => {
      const fixture = await createJudgeFixture(app, mailer, { format: 'contest' })
      const judgeJwt = await authenticateJudge(app, fixture.judge.accessToken, fixture.judge.pin)
      const roundId = await judgeRoundId(fixture, judgeJwt)

      const controller = new AbortController()
      const streamResponse = await app.request(
        `/api/v1/public/${fixture.competition.publicSlug as string}/stream`,
        { signal: controller.signal },
      )
      expect(streamResponse.headers.get('content-type')).toContain('text/event-stream')
      const reader = streamResponse.body?.getReader()
      if (!reader) throw new Error('Flux SSE sans corps lisible.')

      // Laisse le flux s'abonner avant d'écrire — sinon la course peut
      // manquer l'événement (NOTIFY sans abonné à ce moment précis).
      await sleep(300)
      await postAscent(judgeJwt, ascentItem(fixture, roundId, fixture.competitor.id, { holdNumber: 22 }))

      const chunk = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Timeout en attente du chunk SSE.')), 8000),
        ),
      ])
      const text = new TextDecoder().decode(chunk.value)
      expect(text).toContain('event: ranking_updated')
      expect(text).toContain(fixture.category.id)

      await reader.cancel()
      controller.abort()
    },
    15_000,
  )
})
