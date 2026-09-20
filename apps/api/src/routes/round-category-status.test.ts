import { applyPendingMigrations, createDatabase, type DatabaseHandle } from '@climbcontest/db'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { sql } from 'drizzle-orm'
import pg from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createApp } from '../app'
import type { Env } from '../env'
import { createAccessTokenSigner, createJudgeTokenSigner } from '../lib/jwt'
import { createPublicRankingCache, type PublicRankingCache } from '../lib/public-cache'
import type { Logger } from '../lib/logger'
import { FakeMailer } from '../test-utils/fake-mailer'
import {
  authHeaders,
  createTestCompetition,
  registerLoggedInOrganizer,
} from '../test-utils/fixtures'
import { json } from '../test-utils/phases-scenario'

let container: StartedPostgreSqlContainer
let handle: DatabaseHandle
let mailer: FakeMailer
let app: ReturnType<typeof createApp>
let fakeNow: Date
let cache: PublicRankingCache

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
  cache = createPublicRankingCache()
  app = createApp({
    env,
    db: handle.db,
    mailer,
    logger: { info: () => {} } as unknown as Logger,
    accessTokenSigner: createAccessTokenSigner(env.JWT_ACCESS_SECRET),
    judgeTokenSigner: createJudgeTokenSigner(env.JWT_JUDGE_SECRET),
    now: () => fakeNow,
    publicRankingCache: cache,
  })
})

afterEach(async () => {
  await handle.db.execute(
    sql`truncate table "user", "club", "session", "competition", "round", "category", "competitor", "route", "route_category", "round_route", "ascent", "ascent_event", "activity_log", "judge", "judge_route" cascade`,
  )
})

interface TwoCategories {
  organizerToken: string
  competitionId: string
  publicSlug: string
  u16: string
  u18: string
  qualificationId: string
  semifinalId: string
  routeQ: string
  routeS: string
  /** bib 1-3 : U16 ; bib 4-6 : U18. */
  competitors: Record<number, string>
}

/**
 * Le cas d'ADR-065 : deux catégories dans la MÊME qualification et la MÊME
 * demi-finale. Les U16 passent le matin, les U18 l'après-midi. `semifinalOnRouteQ`
 * fait réutiliser la voie de la qualification par la demi-finale (cas du
 * garde-fou « voie déjà utilisée »).
 */
async function twoCategories(semifinalOnRouteQ = false): Promise<TwoCategories> {
  const { accessToken: organizerToken } = await registerLoggedInOrganizer(app, mailer)
  const competition = await createTestCompetition(app, organizerToken, {
    format: 'phases',
    startsOn: '2099-01-01',
    endsOn: '2099-01-01',
  })
  const base = `/api/v1/competitions/${competition.id}`
  const post = (path: string, body: unknown, method = 'POST') =>
    app.request(`${base}${path}`, {
      method,
      headers: authHeaders(organizerToken),
      body: JSON.stringify(body),
    })

  const u16 = (await json<{ id: string }>(await post('/categories', { label: 'U16', sex: 'X' }))).id
  const u18 = (await json<{ id: string }>(await post('/categories', { label: 'U18', sex: 'X' }))).id

  const competitors: Record<number, string> = {}
  for (const bib of [1, 2, 3, 4, 5, 6]) {
    const created = await json<{ id: string }>(
      await post('/competitors', {
        categoryId: bib <= 3 ? u16 : u18,
        bib,
        firstName: `Prénom${bib}`,
        lastName: `Nom${bib}`,
      }),
    )
    competitors[bib] = created.id
  }

  const routeIds: string[] = []
  for (const number of [1, 2]) {
    const created = await json<{ id: string }>(
      await post('/routes', { number, holdCount: 40, categoryIds: [] }),
    )
    await post(`/routes/${created.id}`, { categoryIds: [u16, u18] }, 'PATCH')
    routeIds.push(created.id)
  }
  const [routeQ, routeS] = routeIds as [string, string]

  const qualification = await json<{ id: string }>(
    await post('/rounds', { type: 'qualification', style: 'onsight', qualifyingCount: 2 }),
  )
  const semifinal = await json<{ id: string }>(
    await post('/rounds', { type: 'semifinal', style: 'onsight' }),
  )
  await post(
    `/rounds/${qualification.id}/routes`,
    {
      assignments: [
        { routeId: routeQ, categoryId: u16 },
        { routeId: routeQ, categoryId: u18 },
      ],
    },
    'PUT',
  )
  const semifinalRoute = semifinalOnRouteQ ? routeQ : routeS
  await post(
    `/rounds/${semifinal.id}/routes`,
    {
      assignments: [
        { routeId: semifinalRoute, categoryId: u16 },
        { routeId: semifinalRoute, categoryId: u18 },
      ],
    },
    'PUT',
  )

  return {
    organizerToken,
    competitionId: competition.id,
    publicSlug: String(competition['publicSlug']),
    u16,
    u18,
    qualificationId: qualification.id,
    semifinalId: semifinal.id,
    routeQ,
    routeS,
    competitors,
  }
}

function setStatus(s: TwoCategories, roundId: string, status: string, categoryIds: string[]) {
  return app.request(`/api/v1/competitions/${s.competitionId}/round-status/${roundId}`, {
    method: 'POST',
    headers: authHeaders(s.organizerToken),
    body: JSON.stringify({ status, categoryIds }),
  })
}

/** Saisie de secours organisateur : un passage à la prise `hold`. */
function enter(s: TwoCategories, roundId: string, routeId: string, bib: number, hold: number) {
  return app.request(`/api/v1/competitions/${s.competitionId}/ascents`, {
    method: 'POST',
    headers: authHeaders(s.organizerToken),
    body: JSON.stringify({
      roundId,
      routeId,
      competitorId: s.competitors[bib],
      holdNumber: hold,
      modifier: 'none',
      isTop: false,
      status: 'valid',
      recordedAt: fakeNow.toISOString(),
    }),
  })
}

/** Le statut de chaque couple (tour, catégorie), tel que l'affiche le pilotage. */
async function statuses(s: TwoCategories): Promise<Record<string, string>> {
  const dashboard = await json<{
    categories: {
      categoryId: string
      routes: { roundId: string | null; roundStatus: string | null }[]
    }[]
  }>(
    await app.request(`/api/v1/competitions/${s.competitionId}/dashboard`, {
      headers: authHeaders(s.organizerToken),
    }),
  )
  const label = (id: string) => (id === s.u16 ? 'U16' : 'U18')
  const round = (id: string) => (id === s.qualificationId ? 'qualif' : 'demi')
  const result: Record<string, string> = {}
  for (const cat of dashboard.categories) {
    for (const r of cat.routes) {
      if (r.roundId && r.roundStatus)
        result[`${round(r.roundId)} ${label(cat.categoryId)}`] = r.roundStatus
    }
  }
  return result
}

describe('statut par tour et par catégorie (ADR-065)', () => {
  it('les U16 finissent le matin et passent en demi-finale pendant que les U18 commencent', async () => {
    const s = await twoCategories()

    // Matin : seuls les U16 ouvrent la qualification.
    expect((await setStatus(s, s.qualificationId, 'open', [s.u16])).status).toBe(200)
    expect(await statuses(s)).toMatchObject({
      'qualif U16': 'open',
      'qualif U18': 'draft',
      'demi U16': 'draft',
      'demi U18': 'draft',
    })
    expect((await enter(s, s.qualificationId, s.routeQ, 1, 30)).status).toBe(201)
    expect((await enter(s, s.qualificationId, s.routeQ, 2, 25)).status).toBe(201)
    expect((await enter(s, s.qualificationId, s.routeQ, 3, 10)).status).toBe(201)
    // Les U18 ne sont pas encore ouverts : leur saisie est refusée.
    expect((await enter(s, s.qualificationId, s.routeQ, 4, 20)).status).toBe(404)

    // Fin de matinée : les U16 ferment, leur demi-finale s'ouvre — pas celle des U18.
    expect((await setStatus(s, s.qualificationId, 'closed', [s.u16])).status).toBe(200)
    const semifinalU18 = await setStatus(s, s.semifinalId, 'open', [s.u18])
    expect(semifinalU18.status).toBe(409)
    expect(((await semifinalU18.json()) as { title: string }).title).toBe(
      'Tour précédent non terminé',
    )
    expect((await setStatus(s, s.semifinalId, 'open', [s.u16])).status).toBe(200)

    // Après-midi : les U18 ouvrent leur qualification alors que la demi-finale des U16 est en cours.
    expect((await setStatus(s, s.qualificationId, 'open', [s.u18])).status).toBe(200)
    expect(await statuses(s)).toMatchObject({
      'qualif U16': 'closed',
      'qualif U18': 'open',
      'demi U16': 'open',
      'demi U18': 'draft',
    })
    expect((await enter(s, s.qualificationId, s.routeQ, 4, 20)).status).toBe(201)
    // Les U16 ont fini leur qualification : plus de saisie.
    expect((await enter(s, s.qualificationId, s.routeQ, 1, 31)).status).toBe(404)
    // Leur demi-finale est ouverte : saisie possible sur la voie de la demi-finale.
    expect((await enter(s, s.semifinalId, s.routeS, 1, 35)).status).toBe(201)
  })

  it('ne fige les qualifiés que pour la catégorie ouverte', async () => {
    const s = await twoCategories()
    await setStatus(s, s.qualificationId, 'open', [s.u16])
    await enter(s, s.qualificationId, s.routeQ, 1, 30)
    await enter(s, s.qualificationId, s.routeQ, 2, 25)
    await enter(s, s.qualificationId, s.routeQ, 3, 10)
    await setStatus(s, s.qualificationId, 'closed', [s.u16])
    await setStatus(s, s.semifinalId, 'open', [s.u16])

    const view = await json<{
      categories: { categoryId: string; count: number; frozenAt: string | null }[]
    }>(
      await app.request(
        `/api/v1/competitions/${s.competitionId}/round-status/${s.semifinalId}/qualifiers`,
        { headers: authHeaders(s.organizerToken) },
      ),
    )
    const u16 = view.categories.find((c) => c.categoryId === s.u16)
    const u18 = view.categories.find((c) => c.categoryId === s.u18)
    expect(u16?.count).toBe(2)
    expect(u16?.frozenAt).not.toBeNull()
    // Les U18 n'ont pas ouvert la demi-finale : aucune liste figée pour eux.
    expect(u18?.count).toBe(0)
    expect(u18?.frozenAt).toBeNull()
  })

  it('refuse de rouvrir la qualification des U16 dès que leur demi-finale est ouverte, sans gêner les U18', async () => {
    const s = await twoCategories()
    await setStatus(s, s.qualificationId, 'open', [s.u16, s.u18])
    await setStatus(s, s.qualificationId, 'closed', [s.u16])
    await setStatus(s, s.semifinalId, 'open', [s.u16])

    const reopen = await setStatus(s, s.qualificationId, 'open', [s.u16])
    expect(reopen.status).toBe(409)
    expect(((await reopen.json()) as { title: string }).title).toBe('Réouverture impossible')

    // Les U18 n'ont pas de demi-finale ouverte : ils peuvent fermer puis rouvrir.
    expect((await setStatus(s, s.qualificationId, 'closed', [s.u18])).status).toBe(200)
    expect((await setStatus(s, s.qualificationId, 'open', [s.u18])).status).toBe(200)
  })

  it('tout ou rien : un refus sur une catégorie refuse l’ensemble et la nomme', async () => {
    const s = await twoCategories()
    await setStatus(s, s.qualificationId, 'open', [s.u16])
    await setStatus(s, s.qualificationId, 'closed', [s.u16])

    // Demi-finale : U16 est prête (qualif fermée), U18 non (qualif encore en brouillon).
    const both = await setStatus(s, s.semifinalId, 'open', [s.u16, s.u18])
    expect(both.status).toBe(409)
    expect(((await both.json()) as { detail: string }).detail).toContain('U18 :')
    expect(await statuses(s)).toMatchObject({ 'demi U16': 'draft', 'demi U18': 'draft' })
  })

  it('refuse d’ouvrir une catégorie dont une voie sert déjà dans un autre tour ouvert', async () => {
    const s = await twoCategories(true)
    await setStatus(s, s.qualificationId, 'open', [s.u16])
    await setStatus(s, s.qualificationId, 'closed', [s.u16])
    // L'après-midi : la qualification des U18 occupe la voie 1…
    await setStatus(s, s.qualificationId, 'open', [s.u18])

    // …que la demi-finale des U16 voudrait réutiliser : un juge ne peut suivre qu'un tour à la fois.
    const clash = await setStatus(s, s.semifinalId, 'open', [s.u16])
    expect(clash.status).toBe(409)
    const body = (await clash.json()) as { title: string; detail: string }
    expect(body.title).toBe('Voie déjà utilisée')
    expect(body.detail).toContain('Qualification')

    // Une fois la qualification des U18 fermée, la voie est libre.
    await setStatus(s, s.qualificationId, 'closed', [s.u18])
    expect((await setStatus(s, s.semifinalId, 'open', [s.u16])).status).toBe(200)
  })

  it('le public voit un état par catégorie, et un classement provisoire tant que le dernier tour n’est pas publié', async () => {
    const s = await twoCategories()
    await setStatus(s, s.qualificationId, 'open', [s.u16])
    await enter(s, s.qualificationId, s.routeQ, 1, 30)
    await setStatus(s, s.qualificationId, 'closed', [s.u16])
    await setStatus(s, s.qualificationId, 'open', [s.u18])

    const meta = await json<{
      rounds: { id: string; categories: { categoryId: string; status: string }[] }[]
    }>(await app.request(`/api/v1/public/${s.publicSlug}`))
    const qualification = meta.rounds.find((r) => r.id === s.qualificationId)
    expect(qualification?.categories).toEqual(
      expect.arrayContaining([
        { categoryId: s.u16, status: 'closed' },
        { categoryId: s.u18, status: 'open' },
      ]),
    )

    const ranking = async (categoryId: string) =>
      json<{ started: boolean; provisional: boolean }>(
        await app.request(`/api/v1/public/${s.publicSlug}/rankings?category=${categoryId}`),
      )
    expect(await ranking(s.u16)).toMatchObject({ started: true, provisional: true })
    expect(await ranking(s.u18)).toMatchObject({ started: true, provisional: true })

    // Publier la qualification des U16 rend leur classement définitif — pas celui des U18.
    expect((await setStatus(s, s.qualificationId, 'published', [s.u16])).status).toBe(200)
    // En production, le pont NOTIFY invalide ce cache (couvert par public.test.ts) ;
    // ce montage n'a pas de pont, donc on fait ce geste à sa place.
    cache.invalidateCompetition(s.competitionId)
    expect(await ranking(s.u16)).toMatchObject({ provisional: false })
    expect(await ranking(s.u18)).toMatchObject({ provisional: true })
  })
})

describe('statut de compétition et catégories ouvertes (ADR-065)', () => {
  const changeStatus = (s: TwoCategories, status: string) =>
    app.request(`/api/v1/competitions/${s.competitionId}/status`, {
      method: 'POST',
      headers: authHeaders(s.organizerToken),
      body: JSON.stringify({ status }),
    })

  it('« En cours » n’ouvre plus aucun tour', async () => {
    const s = await twoCategories()
    expect((await changeStatus(s, 'running')).status).toBe(200)
    expect(await statuses(s)).toMatchObject({
      'qualif U16': 'draft',
      'qualif U18': 'draft',
    })
  })

  it('on ne quitte pas « En cours » tant qu’une catégorie est ouverte, et le message dit quoi faire', async () => {
    const s = await twoCategories()
    await setStatus(s, s.qualificationId, 'open', [s.u16])

    const refused = await changeStatus(s, 'closed')
    expect(refused.status).toBe(409)
    const body = (await refused.json()) as { title: string; detail: string }
    expect(body.title).toBe('Des catégories sont encore ouvertes')
    expect(body.detail).toContain('Pilotage')
    expect(body.detail).toContain('Clôturée')

    // Une catégorie fermée suffit à lever le blocage.
    await setStatus(s, s.qualificationId, 'closed', [s.u16])
    expect((await changeStatus(s, 'closed')).status).toBe(200)
  })

  it('passer à « En cours » reste toujours possible, même avec une catégorie ouverte', async () => {
    const s = await twoCategories()
    await setStatus(s, s.qualificationId, 'open', [s.u18])
    expect((await changeStatus(s, 'running')).status).toBe(200)
  })

  it('rouvrir une catégorie sur une compétition clôturée la remet « En cours »', async () => {
    const s = await twoCategories()
    await setStatus(s, s.qualificationId, 'open', [s.u16])
    await setStatus(s, s.qualificationId, 'closed', [s.u16])
    await changeStatus(s, 'closed')

    const reopened = await setStatus(s, s.qualificationId, 'open', [s.u16])
    expect(reopened.status).toBe(200)
    expect(((await reopened.json()) as { competitionStatus: string }).competitionStatus).toBe(
      'running',
    )
  })
})
