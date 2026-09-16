import {
  applyPendingMigrations,
  ascent,
  createDatabase,
  user,
  type DatabaseHandle,
} from '@climbcontest/db'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { eq, sql } from 'drizzle-orm'
import pg from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createApp } from '../app'
import type { Env } from '../env'
import { createAccessTokenSigner } from '../lib/jwt'
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
  })
})

afterEach(async () => {
  await handle.db.execute(
    sql`truncate table "user", "club", "session", "competition", "round", "category", "competitor", "route", "route_category", "ascent" cascade`,
  )
})

async function setupCompetitionWithCategory() {
  const { accessToken, email } = await registerLoggedInOrganizer(app, mailer)
  const competition = await createTestCompetition(app, accessToken, { format: 'contest' })
  const categoryResponse = await app.request(`/api/v1/competitions/${competition.id}/categories`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify({ label: 'U16 Femme', sex: 'F' }),
  })
  const category = (await categoryResponse.json()) as { id: string }
  return { accessToken, email, competition, category }
}

describe('POST /competitions/:id/competitors', () => {
  it('crée un compétiteur sans dossard', async () => {
    const { accessToken, competition, category } = await setupCompetitionWithCategory()
    const response = await app.request(`/api/v1/competitions/${competition.id}/competitors`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ categoryId: category.id, firstName: 'Léa', lastName: 'Martin' }),
    })
    expect(response.status).toBe(201)
    const body = (await response.json()) as { bib: number | null }
    expect(body.bib).toBeNull()
  })

  it('refuse un dossard déjà attribué (409)', async () => {
    const { accessToken, competition, category } = await setupCompetitionWithCategory()
    await app.request(`/api/v1/competitions/${competition.id}/competitors`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({
        categoryId: category.id,
        firstName: 'Léa',
        lastName: 'Martin',
        bib: 1,
      }),
    })
    const response = await app.request(`/api/v1/competitions/${competition.id}/competitors`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({
        categoryId: category.id,
        firstName: 'Théo',
        lastName: 'Dupuis',
        bib: 1,
      }),
    })
    expect(response.status).toBe(409)
  })

  it("refuse une catégorie qui n'appartient pas à la compétition", async () => {
    const { accessToken, competition } = await setupCompetitionWithCategory()
    const response = await app.request(`/api/v1/competitions/${competition.id}/competitors`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ categoryId: 'inexistante', firstName: 'Léa', lastName: 'Martin' }),
    })
    expect(response.status).toBe(400)
  })
})

describe('changement de catégorie et retrait (ADR-005)', () => {
  async function setupCompetitorWithAscent() {
    const { accessToken, competition, category, email } = await setupCompetitionWithCategory()
    const otherCategoryResponse = await app.request(
      `/api/v1/competitions/${competition.id}/categories`,
      {
        method: 'POST',
        headers: authHeaders(accessToken),
        body: JSON.stringify({ label: 'U18 Femme', sex: 'F' }),
      },
    )
    const otherCategory = (await otherCategoryResponse.json()) as { id: string }

    const competitorResponse = await app.request(
      `/api/v1/competitions/${competition.id}/competitors`,
      {
        method: 'POST',
        headers: authHeaders(accessToken),
        body: JSON.stringify({ categoryId: category.id, firstName: 'Léa', lastName: 'Martin' }),
      },
    )
    const competitor = (await competitorResponse.json()) as { id: string }

    const routeResponse = await app.request(`/api/v1/competitions/${competition.id}/routes`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ number: 1, holdCount: 40, categoryIds: [category.id] }),
    })
    const route = (await routeResponse.json()) as { id: string }

    const implicitRound = await handle.db.query.round.findFirst({
      where: (row, { eq: whereEq }) => whereEq(row.competitionId, competition.id),
    })
    if (!implicitRound) throw new Error('round implicite manquant')
    const organizerUser = await handle.db.query.user.findFirst({ where: eq(user.email, email) })
    if (!organizerUser) throw new Error('organisateur introuvable')

    // Saisie de secours par l'organisateur pour ce test — un juge n'existe
    // pas encore avant le Lot 4.
    await handle.db.insert(ascent).values({
      id: crypto.randomUUID(),
      competitionId: competition.id,
      roundId: implicitRound.id,
      routeId: route.id,
      competitorId: competitor.id,
      holdCount: 40,
      status: 'valid',
      isTop: true,
      recordedByUserId: organizerUser.id,
      deviceId: 'test',
      recordedAt: new Date(),
    })

    return {
      accessToken,
      competition,
      competitorId: competitor.id,
      otherCategoryId: otherCategory.id,
    }
  }

  it('bloque le changement de catégorie une fois un passage enregistré', async () => {
    const { accessToken, competition, competitorId, otherCategoryId } =
      await setupCompetitorWithAscent()
    const response = await app.request(
      `/api/v1/competitions/${competition.id}/competitors/${competitorId}`,
      {
        method: 'PATCH',
        headers: authHeaders(accessToken),
        body: JSON.stringify({ categoryId: otherCategoryId }),
      },
    )
    expect(response.status).toBe(409)
  })

  it('bloque le retrait une fois un passage enregistré', async () => {
    const { accessToken, competition, competitorId } = await setupCompetitorWithAscent()
    const response = await app.request(
      `/api/v1/competitions/${competition.id}/competitors/${competitorId}`,
      { method: 'DELETE', headers: authHeaders(accessToken) },
    )
    expect(response.status).toBe(409)
  })
})

describe('POST /competitions/:id/competitors/import', () => {
  it('aperçu : valide un CSV correct sans rien écrire', async () => {
    const { accessToken, competition, category } = await setupCompetitionWithCategory()
    const csv = 'dossard,prenom,nom,categorie\n1,Léa,Martin,U16 Femme\n,Théo,Dupuis,U16 Femme\n'

    const response = await app.request(
      `/api/v1/competitions/${competition.id}/competitors/import`,
      {
        method: 'POST',
        headers: authHeaders(accessToken),
        body: JSON.stringify({ csv, mode: 'preview' }),
      },
    )
    expect(response.status).toBe(200)
    const report = (await response.json()) as {
      committed: boolean
      validRows: number
      totalRows: number
    }
    expect(report.committed).toBe(false)
    expect(report.validRows).toBe(2)
    expect(report.totalRows).toBe(2)

    const list = await app.request(`/api/v1/competitions/${competition.id}/competitors`, {
      headers: authHeaders(accessToken),
    })
    expect(((await list.json()) as unknown[]).length).toBe(0)
    void category
  })

  it('aperçu : signale une catégorie introuvable', async () => {
    const { accessToken, competition } = await setupCompetitionWithCategory()
    const csv = 'dossard,prenom,nom,categorie\n1,Léa,Martin,Catégorie fantôme\n'

    const response = await app.request(
      `/api/v1/competitions/${competition.id}/competitors/import`,
      {
        method: 'POST',
        headers: authHeaders(accessToken),
        body: JSON.stringify({ csv, mode: 'preview' }),
      },
    )
    const report = (await response.json()) as { rows: { errors: string[] }[] }
    expect(report.rows[0]?.errors.some((e) => e.includes('introuvable'))).toBe(true)
  })

  it('aperçu : signale un dossard dupliqué dans le fichier, sur les deux lignes', async () => {
    const { accessToken, competition } = await setupCompetitionWithCategory()
    const csv = 'dossard,prenom,nom,categorie\n1,Léa,Martin,U16 Femme\n1,Théo,Dupuis,U16 Femme\n'

    const response = await app.request(
      `/api/v1/competitions/${competition.id}/competitors/import`,
      {
        method: 'POST',
        headers: authHeaders(accessToken),
        body: JSON.stringify({ csv, mode: 'preview' }),
      },
    )
    const report = (await response.json()) as { rows: { line: number; errors: string[] }[] }
    expect(report.rows[0]?.errors.length).toBeGreaterThan(0)
    expect(report.rows[1]?.errors.length).toBeGreaterThan(0)
  })

  it('commit : écrit tout quand le fichier est propre', async () => {
    const { accessToken, competition } = await setupCompetitionWithCategory()
    const csv = 'dossard,prenom,nom,categorie\n1,Léa,Martin,U16 Femme\n,Théo,Dupuis,U16 Femme\n'

    const response = await app.request(
      `/api/v1/competitions/${competition.id}/competitors/import`,
      {
        method: 'POST',
        headers: authHeaders(accessToken),
        body: JSON.stringify({ csv, mode: 'commit' }),
      },
    )
    expect(response.status).toBe(201)

    const list = await app.request(`/api/v1/competitions/${competition.id}/competitors`, {
      headers: authHeaders(accessToken),
    })
    expect(((await list.json()) as unknown[]).length).toBe(2)
  })

  it("commit : n'écrit rien si une ligne est en erreur (422)", async () => {
    const { accessToken, competition } = await setupCompetitionWithCategory()
    const csv = 'dossard,prenom,nom,categorie\n1,Léa,Martin,Catégorie fantôme\n'

    const response = await app.request(
      `/api/v1/competitions/${competition.id}/competitors/import`,
      {
        method: 'POST',
        headers: authHeaders(accessToken),
        body: JSON.stringify({ csv, mode: 'commit' }),
      },
    )
    expect(response.status).toBe(422)

    const list = await app.request(`/api/v1/competitions/${competition.id}/competitors`, {
      headers: authHeaders(accessToken),
    })
    expect(((await list.json()) as unknown[]).length).toBe(0)
  })
})

describe('POST /competitions/:id/competitors/assign-bibs', () => {
  it('numérote séquentiellement par ordre de catégorie puis nom/prénom, en respectant les dossards déjà pris', async () => {
    const {
      accessToken,
      competition,
      category: firstCategory,
    } = await setupCompetitionWithCategory()
    const secondCategoryResponse = await app.request(
      `/api/v1/competitions/${competition.id}/categories`,
      {
        method: 'POST',
        headers: authHeaders(accessToken),
        body: JSON.stringify({ label: 'U18 Femme', sex: 'F' }),
      },
    )
    const secondCategory = (await secondCategoryResponse.json()) as { id: string }

    // Un dossard déjà pris manuellement, à ne pas réattribuer.
    await app.request(`/api/v1/competitions/${competition.id}/competitors`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({
        categoryId: firstCategory.id,
        firstName: 'Zoé',
        lastName: 'Aaaa',
        bib: 1,
      }),
    })
    // Catégorie 2 (après la 1ère dans l'ordre d'affichage), sans dossard.
    await app.request(`/api/v1/competitions/${competition.id}/competitors`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({
        categoryId: secondCategory.id,
        firstName: 'Alix',
        lastName: 'Bernard',
      }),
    })
    // Catégorie 1, sans dossard : doit passer avant la catégorie 2.
    await app.request(`/api/v1/competitions/${competition.id}/competitors`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ categoryId: firstCategory.id, firstName: 'Théo', lastName: 'Dupuis' }),
    })

    const response = await app.request(
      `/api/v1/competitions/${competition.id}/competitors/assign-bibs`,
      {
        method: 'POST',
        headers: authHeaders(accessToken),
      },
    )
    const rows = (await response.json()) as {
      firstName: string
      lastName: string
      bib: number | null
    }[]
    const byName = Object.fromEntries(
      rows.map((row) => [`${row.firstName} ${row.lastName}`, row.bib]),
    )

    expect(byName['Zoé Aaaa']).toBe(1) // dossard manuel inchangé
    expect(byName['Théo Dupuis']).toBe(2) // catégorie 1, dossard 1 déjà pris → 2
    expect(byName['Alix Bernard']).toBe(3) // catégorie 2, après la catégorie 1
  })
})
