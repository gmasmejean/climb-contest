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
  createTestCompetition,
  registerLoggedInOrganizer,
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
    sql`truncate table "user", "club", "session", "competition", "round", "category", "competitor" cascade`,
  )
})

async function setup() {
  const { accessToken } = await registerLoggedInOrganizer(app, mailer)
  const competition = await createTestCompetition(app, accessToken, { startsOn: '2021-09-01' }) // saison 2022
  return { accessToken, competition }
}

describe('POST /competitions/:id/categories', () => {
  it('crée une catégorie libre avec un display_order auto-incrémenté', async () => {
    const { accessToken, competition } = await setup()

    const first = await app.request(`/api/v1/competitions/${competition.id}/categories`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ label: 'Open A', sex: 'X' }),
    })
    const second = await app.request(`/api/v1/competitions/${competition.id}/categories`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ label: 'Open B', sex: 'X' }),
    })

    const firstBody = (await first.json()) as { displayOrder: number }
    const secondBody = (await second.json()) as { displayOrder: number }
    expect(firstBody.displayOrder).toBe(0)
    expect(secondBody.displayOrder).toBe(1)
  })

  it('refuse un libellé déjà utilisé dans la compétition', async () => {
    const { accessToken, competition } = await setup()
    await app.request(`/api/v1/competitions/${competition.id}/categories`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ label: 'U16 Femme', sex: 'F' }),
    })
    const response = await app.request(`/api/v1/competitions/${competition.id}/categories`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ label: 'U16 Femme', sex: 'F' }),
    })
    expect(response.status).toBe(409)
  })
})

describe('POST /competitions/:id/categories/template', () => {
  it('crée les 14 catégories FFME avec les bonnes bornes d’âge (saison 2022)', async () => {
    const { accessToken, competition } = await setup()
    const response = await app.request(
      `/api/v1/competitions/${competition.id}/categories/template`,
      {
        method: 'POST',
        headers: authHeaders(accessToken),
      },
    )
    expect(response.status).toBe(201)
    const created = (await response.json()) as {
      label: string
      birthYearMin: number | null
      birthYearMax: number | null
    }[]
    expect(created).toHaveLength(14)
    const u12 = created.find((row) => row.label === 'U12 Femme')
    expect(u12?.birthYearMin).toBe(2011)
    expect(u12?.birthYearMax).toBe(2012)
    const veteran = created.find((row) => row.label === 'Vétéran Homme')
    expect(veteran?.birthYearMin).toBeNull()
  })

  it('ne recrée pas les catégories déjà présentes (idempotent par libellé)', async () => {
    const { accessToken, competition } = await setup()
    await app.request(`/api/v1/competitions/${competition.id}/categories/template`, {
      method: 'POST',
      headers: authHeaders(accessToken),
    })
    const second = await app.request(`/api/v1/competitions/${competition.id}/categories/template`, {
      method: 'POST',
      headers: authHeaders(accessToken),
    })
    const body = (await second.json()) as unknown[]
    expect(body).toEqual([])

    const list = await app.request(`/api/v1/competitions/${competition.id}/categories`, {
      headers: authHeaders(accessToken),
    })
    expect(((await list.json()) as unknown[]).length).toBe(14)
  })
})

describe('DELETE /competitions/:id/categories/:categoryId', () => {
  it('supprime une catégorie sans compétiteur', async () => {
    const { accessToken, competition } = await setup()
    const created = await app.request(`/api/v1/competitions/${competition.id}/categories`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ label: 'U16 Femme', sex: 'F' }),
    })
    const category = (await created.json()) as { id: string }

    const response = await app.request(
      `/api/v1/competitions/${competition.id}/categories/${category.id}`,
      { method: 'DELETE', headers: authHeaders(accessToken) },
    )
    expect(response.status).toBe(204)
  })

  it('refuse de supprimer une catégorie qui a des compétiteurs (409)', async () => {
    const { accessToken, competition } = await setup()
    const created = await app.request(`/api/v1/competitions/${competition.id}/categories`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ label: 'U16 Femme', sex: 'F' }),
    })
    const category = (await created.json()) as { id: string }
    await app.request(`/api/v1/competitions/${competition.id}/competitors`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ categoryId: category.id, firstName: 'Léa', lastName: 'Martin' }),
    })

    const response = await app.request(
      `/api/v1/competitions/${competition.id}/categories/${category.id}`,
      { method: 'DELETE', headers: authHeaders(accessToken) },
    )
    expect(response.status).toBe(409)
  })
})

describe('POST /competitions/:id/categories/reorder', () => {
  it('applique le nouvel ordre demandé', async () => {
    const { accessToken, competition } = await setup()
    const a = (await (
      await app.request(`/api/v1/competitions/${competition.id}/categories`, {
        method: 'POST',
        headers: authHeaders(accessToken),
        body: JSON.stringify({ label: 'A', sex: 'X' }),
      })
    ).json()) as { id: string }
    const b = (await (
      await app.request(`/api/v1/competitions/${competition.id}/categories`, {
        method: 'POST',
        headers: authHeaders(accessToken),
        body: JSON.stringify({ label: 'B', sex: 'X' }),
      })
    ).json()) as { id: string }

    const response = await app.request(
      `/api/v1/competitions/${competition.id}/categories/reorder`,
      {
        method: 'POST',
        headers: authHeaders(accessToken),
        body: JSON.stringify({ orderedIds: [b.id, a.id] }),
      },
    )
    const reordered = (await response.json()) as { id: string; displayOrder: number }[]
    expect(reordered.map((row) => row.id)).toEqual([b.id, a.id])
    expect(reordered.map((row) => row.displayOrder)).toEqual([0, 1])
  })

  it('refuse une liste incomplète', async () => {
    const { accessToken, competition } = await setup()
    await app.request(`/api/v1/competitions/${competition.id}/categories`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ label: 'A', sex: 'X' }),
    })
    await app.request(`/api/v1/competitions/${competition.id}/categories`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ label: 'B', sex: 'X' }),
    })

    const response = await app.request(
      `/api/v1/competitions/${competition.id}/categories/reorder`,
      {
        method: 'POST',
        headers: authHeaders(accessToken),
        body: JSON.stringify({ orderedIds: ['inexistant'] }),
      },
    )
    expect(response.status).toBe(400)
  })
})

describe('isolation multi-club', () => {
  it("refuse d'accéder aux catégories d'une compétition d'un autre club", async () => {
    const { competition } = await setup()
    const other = await registerLoggedInOrganizer(app, mailer)

    const response = await app.request(`/api/v1/competitions/${competition.id}/categories`, {
      headers: authHeaders(other.accessToken),
    })
    expect(response.status).toBe(404)
  })
})
