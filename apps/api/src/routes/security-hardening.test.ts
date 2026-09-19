import {
  applyPendingMigrations,
  createDatabase,
  route,
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
import { authHeaders, createJudgeFixture } from '../test-utils/fixtures'

/**
 * Revue de sécurité du Lot 9 — durcissement transversal : limite de taille des
 * corps, en-têtes de sécurité, adresse client non forgeable, liens de vidéo.
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
  // Une instance NEUVE par test : la limitation de débit est en mémoire.
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

const json = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

describe('taille des corps de requête', () => {
  it('refuse un corps JSON de plus de 1 Mio sur une route ordinaire, avant de le lire (413)', async () => {
    const huge = JSON.stringify({ email: 'a@b.fr', password: 'x'.repeat(2 * 1024 * 1024) })

    const response = await json('/api/v1/auth/login', huge)

    expect(response.status).toBe(413)
    expect(((await response.json()) as { title: string }).title).toBe(
      'Corps de requête trop volumineux',
    )
  })

  it('refuse aussi une route non authentifiée : personne n’a besoin de se connecter pour saturer la mémoire', async () => {
    const huge = JSON.stringify({ token: 'x'.repeat(2 * 1024 * 1024) })
    expect((await json('/api/v1/judge/auth', huge)).status).toBe(413)
    expect((await json('/api/v1/auth/register', huge)).status).toBe(413)
  })

  it('laisse passer un corps raisonnable', async () => {
    const response = await json('/api/v1/auth/login', { email: 'a@b.fr', password: 'pas-le-bon' })
    expect(response.status).toBe(401)
  })

  it('accepte jusqu’à 25 Mio pour l’import de sauvegarde, refuse au-delà', async () => {
    const f = await createJudgeFixture(app, mailer)
    const url = '/api/v1/competitions/import'
    const under = JSON.stringify({
      mode: 'preview',
      backup: { padding: 'x'.repeat(2 * 1024 * 1024) },
    })
    const over = JSON.stringify({
      mode: 'preview',
      backup: { padding: 'x'.repeat(26 * 1024 * 1024) },
    })

    // 2 Mio ne sont plus refusés pour leur taille : c'est le contenu qui l'est (400).
    expect((await json(url, under, authHeaders(f.organizerToken))).status).toBe(400)
    expect((await json(url, over, authHeaders(f.organizerToken))).status).toBe(413)
  })
})

describe('en-têtes de sécurité', () => {
  it.each([['/health'], ['/api/v1/public/inconnu'], ['/api/v1/competitions']])(
    'toute réponse de %s interdit le « sniffing » de type et le cadrage',
    async (path) => {
      const response = await app.request(path)
      expect(response.headers.get('x-content-type-options')).toBe('nosniff')
      expect(response.headers.get('x-frame-options')).toMatch(/^(DENY|SAMEORIGIN)$/)
      expect(response.headers.get('referrer-policy')).toBeTruthy()
    },
  )

  it('une réponse d’erreur ne révèle ni pile d’appels ni détail technique', async () => {
    const response = await app.request('/api/v1/competitions/pas-un-uuid', {
      headers: { authorization: 'Bearer x' },
    })
    const text = await response.text()
    expect(text).not.toMatch(/at .*\.ts|node_modules|drizzle|postgres|SELECT /i)
  })
})

describe('adresse client et limitation de débit', () => {
  it('changer d’« adresse » à chaque requête (X-Forwarded-For forgé) ne contourne PAS la limitation', async () => {
    // Le proxy de confiance ajoute toujours la vraie adresse EN DERNIER.
    const statuses: number[] = []
    for (let i = 0; i < 14; i += 1) {
      const response = await json(
        '/api/v1/auth/login',
        { email: 'victime@club.test', password: 'devine-un-mot-de-passe' },
        { 'x-forwarded-for': `10.0.${i}.${i}, 203.0.113.50` },
      )
      statuses.push(response.status)
    }
    expect(statuses.filter((s) => s === 401)).toHaveLength(10)
    expect(statuses.slice(10).every((s) => s === 429)).toBe(true)
  })

  it('AUTH_RATE_LIMIT_MAX relève le plafond (piles de test), et seulement lui', async () => {
    const relaxed = createApp({
      env: { ...env, AUTH_RATE_LIMIT_MAX: 25 },
      db: handle.db,
      mailer,
      logger: { info: () => {} } as unknown as Logger,
      accessTokenSigner: createAccessTokenSigner(env.JWT_ACCESS_SECRET),
      judgeTokenSigner: createJudgeTokenSigner(env.JWT_JUDGE_SECRET),
    })
    const attempt = () =>
      relaxed.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.77' },
        body: JSON.stringify({ email: 'a@club.test', password: 'x' }),
      })
    const statuses: number[] = []
    for (let i = 0; i < 27; i += 1) statuses.push((await attempt()).status)
    expect(statuses.filter((s) => s === 401)).toHaveLength(25)
    expect(statuses.slice(25)).toEqual([429, 429])
  })

  it('deux vraies adresses différentes ont chacune leur compteur', async () => {
    for (let i = 0; i < 10; i += 1) {
      await json(
        '/api/v1/auth/login',
        { email: 'a@club.test', password: 'x' },
        { 'x-forwarded-for': '203.0.113.1' },
      )
    }
    const blocked = await json(
      '/api/v1/auth/login',
      { email: 'a@club.test', password: 'x' },
      { 'x-forwarded-for': '203.0.113.1' },
    )
    const other = await json(
      '/api/v1/auth/login',
      { email: 'a@club.test', password: 'x' },
      { 'x-forwarded-for': '203.0.113.2' },
    )
    expect(blocked.status).toBe(429)
    expect(other.status).toBe(401)
  })
})

describe('liens de vidéo (XSS stockée)', () => {
  it.each([['javascript:alert(document.cookie)'], ['data:text/html,<script>alert(1)</script>']])(
    'refuse de STOCKER %s',
    async (videoUrl) => {
      const f = await createJudgeFixture(app, mailer)
      const response = await app.request(
        `/api/v1/competitions/${f.competition.id}/routes/${f.route.id}`,
        {
          method: 'PATCH',
          headers: authHeaders(f.organizerToken),
          body: JSON.stringify({ videoUrl }),
        },
      )
      expect(response.status).toBe(400)
    },
  )

  it('ne renvoie JAMAIS au public un lien non http(s) déjà stocké avant la règle', async () => {
    const f = await createJudgeFixture(app, mailer)
    // Une ligne « héritée » : écrite directement en base, contournant la validation.
    await handle.db
      .update(route)
      .set({ videoUrl: 'javascript:alert(1)' })
      .where(eq(route.id, f.route.id))

    const response = await app.request(
      `/api/v1/public/${String(f.competition['publicSlug'])}/routes?category=${f.category.id}`,
    )

    expect(response.status).toBe(200)
    const routes = (await response.json()) as { videoUrl: string | null }[]
    expect(routes[0]?.videoUrl).toBeNull()
  })

  it('renvoie un lien https normal', async () => {
    const f = await createJudgeFixture(app, mailer)
    await handle.db
      .update(route)
      .set({ videoUrl: 'https://youtu.be/abc123' })
      .where(eq(route.id, f.route.id))
    const response = await app.request(
      `/api/v1/public/${String(f.competition['publicSlug'])}/routes?category=${f.category.id}`,
    )
    expect(((await response.json()) as { videoUrl: string | null }[])[0]?.videoUrl).toBe(
      'https://youtu.be/abc123',
    )
  })
})
