import { applyPendingMigrations, createDatabase, type DatabaseHandle } from '@climbcontest/db'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { sql } from 'drizzle-orm'
import pg from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createApp } from '../app'
import type { Env } from '../env'
import { createAccessTokenSigner } from '../lib/jwt'
import type { Logger } from '../lib/logger'
import { FakeMailer } from '../test-utils/fake-mailer'

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
  await handle.db.execute(sql`truncate table "user", "club", "session" cascade`)
})

function cookieHeaderFrom(response: Response): string {
  const setCookie = response.headers.get('set-cookie') ?? ''
  return setCookie.split(';')[0] ?? ''
}

async function registerAndVerify(email: string, password = 'un-mot-de-passe-solide') {
  await app.request('/api/v1/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, displayName: 'Alex', clubName: 'Club Démo' }),
  })
  const token = mailer.lastTokenFor(email)
  const verifyResponse = await app.request(
    `/api/v1/auth/verify-email?token=${token}`,
    { redirect: 'manual' },
  )
  expect(verifyResponse.status).toBe(302)
  expect(verifyResponse.headers.get('location')).toContain('verified=1')
}

describe('POST /auth/register', () => {
  it('crée un compte non activé et envoie un e-mail de vérification', async () => {
    const response = await app.request('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'alex@club-demo.test',
        password: 'un-mot-de-passe-solide',
        displayName: 'Alex',
        clubName: 'Club Démo',
      }),
    })
    expect(response.status).toBe(201)
    expect(mailer.sent).toHaveLength(1)
    expect(mailer.sent[0]?.to).toBe('alex@club-demo.test')
  })

  it('refuse un e-mail déjà utilisé', async () => {
    await registerAndVerify('deja@club-demo.test')
    const response = await app.request('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'deja@club-demo.test',
        password: 'un-mot-de-passe-solide',
        displayName: 'Alex',
        clubName: 'Club Démo',
      }),
    })
    expect(response.status).toBe(409)
  })
})

describe('vérification et connexion', () => {
  it('refuse la connexion avant vérification puis l’autorise après', async () => {
    const email = 'pending@club-demo.test'
    const password = 'un-mot-de-passe-solide'
    await app.request('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, displayName: 'Alex', clubName: 'Club Démo' }),
    })

    const before = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    expect(before.status).toBe(403)

    const token = mailer.lastTokenFor(email)
    const verifyResponse = await app.request(`/api/v1/auth/verify-email?token=${token}`, {
      redirect: 'manual',
    })
    expect(verifyResponse.status).toBe(302)
    expect(verifyResponse.headers.get('location')).toContain('verified=1')

    const after = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    expect(after.status).toBe(200)
  })

  it('jeton de vérification expiré ou déjà utilisé → 302 vers login avec erreur', async () => {
    const email = 'expired@club-demo.test'
    await app.request('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email,
        password: 'un-mot-de-passe-solide',
        displayName: 'Alex',
        clubName: 'Club Démo',
      }),
    })
    const token = mailer.lastTokenFor(email)
    await app.request(`/api/v1/auth/verify-email?token=${token}`, { redirect: 'manual' })
    const secondAttempt = await app.request(`/api/v1/auth/verify-email?token=${token}`, {
      redirect: 'manual',
    })
    expect(secondAttempt.headers.get('location')).toContain('verify_error=1')
  })
})

describe('refresh token — rotation et détection de réutilisation', () => {
  it('tourne le jeton à chaque refresh, et révoque tout à la réutilisation', async () => {
    const email = 'rotation@club-demo.test'
    const password = 'un-mot-de-passe-solide'
    await registerAndVerify(email, password)

    const loginResponse = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    expect(loginResponse.status).toBe(200)
    const firstCookie = cookieHeaderFrom(loginResponse)

    // Premier refresh : légitime, la rotation doit réussir.
    const firstRefresh = await app.request('/api/v1/auth/refresh', {
      method: 'POST',
      headers: { cookie: firstCookie },
    })
    expect(firstRefresh.status).toBe(200)
    const secondCookie = cookieHeaderFrom(firstRefresh)
    expect(secondCookie).not.toBe(firstCookie)

    // Deuxième refresh avec le nouveau jeton : doit réussir aussi.
    const secondRefresh = await app.request('/api/v1/auth/refresh', {
      method: 'POST',
      headers: { cookie: secondCookie },
    })
    expect(secondRefresh.status).toBe(200)
    const thirdCookie = cookieHeaderFrom(secondRefresh)

    // Réutilisation du PREMIER jeton (déjà consommé) : doit échouer et
    // révoquer toute la lignée, y compris la session actuellement valide.
    const reuseAttempt = await app.request('/api/v1/auth/refresh', {
      method: 'POST',
      headers: { cookie: firstCookie },
    })
    expect(reuseAttempt.status).toBe(401)

    const afterReuse = await app.request('/api/v1/auth/refresh', {
      method: 'POST',
      headers: { cookie: thirdCookie },
    })
    expect(afterReuse.status).toBe(401)
  })

  it('refuse un refresh sans cookie', async () => {
    const response = await app.request('/api/v1/auth/refresh', { method: 'POST' })
    expect(response.status).toBe(401)
  })
})

describe('invitations', () => {
  it('un organizer ne peut pas inviter (seul owner peut)', async () => {
    const ownerEmail = 'owner-inv@club-demo.test'
    const ownerPassword = 'un-mot-de-passe-solide'
    await registerAndVerify(ownerEmail, ownerPassword)
    const ownerLogin = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: ownerEmail, password: ownerPassword }),
    })
    const { accessToken } = (await ownerLogin.json()) as { accessToken: string }

    const inviteResponse = await app.request('/api/v1/auth/invitations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        email: 'colleague@club-demo.test',
        displayName: 'Colleague',
        role: 'organizer',
      }),
    })
    expect(inviteResponse.status).toBe(201)
    expect(mailer.sent.some((mail) => mail.to === 'colleague@club-demo.test')).toBe(true)

    const acceptToken = mailer.lastTokenFor('colleague@club-demo.test')
    const acceptResponse = await app.request('/api/v1/auth/invitations/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: acceptToken, password: 'un-autre-mot-de-passe' }),
    })
    expect(acceptResponse.status).toBe(201)
    const accepted = (await acceptResponse.json()) as { user: { role: string } }
    expect(accepted.user.role).toBe('organizer')

    // Le nouvel organizer (pas owner) ne doit pas pouvoir inviter à son tour.
    const colleagueLogin = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'colleague@club-demo.test', password: 'un-autre-mot-de-passe' }),
    })
    const { accessToken: colleagueToken } = (await colleagueLogin.json()) as { accessToken: string }
    const forbidden = await app.request('/api/v1/auth/invitations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${colleagueToken}`,
      },
      body: JSON.stringify({ email: 'other@club-demo.test', displayName: 'Other', role: 'organizer' }),
    })
    expect(forbidden.status).toBe(403)
  })

  it('rejette une invitation sans jeton d’accès', async () => {
    const response = await app.request('/api/v1/auth/invitations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'x@club-demo.test', displayName: 'X', role: 'organizer' }),
    })
    expect(response.status).toBe(401)
  })
})

describe('GET /health', () => {
  it('répond ok', async () => {
    const response = await app.request('/health')
    expect(response.status).toBe(200)
  })
})
