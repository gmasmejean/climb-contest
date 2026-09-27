import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { applyPendingMigrations, createDatabase, type DatabaseHandle } from '@climbcontest/db'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { sql } from 'drizzle-orm'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createApp } from '../app'
import type { Env } from '../env'
import { createAccessTokenSigner, createJudgeTokenSigner } from '../lib/jwt'
import type { Logger } from '../lib/logger'
import { LocalDiskStorage } from '../lib/storage'
import { FakeMailer } from '../test-utils/fake-mailer'
import {
  authHeaders,
  authenticateJudge,
  openContestRound,
  registerLoggedInOrganizer,
} from '../test-utils/fixtures'

/**
 * Revue de sécurité des trois frontières (organisateur, juge, public) —
 * Lot 9, point 4. La matrice part de `app.routes` : une route ajoutée sans
 * être classée fait ÉCHOUER ce fichier, et une route classée dans un préfixe
 * hérite automatiquement des contrôles d'authentification de ce préfixe.
 */

type Kind = 'public' | 'stream' | 'anonymous' | 'judge' | 'organizer' | 'organizer-competition'
interface RouteEntry {
  method: string
  path: string
  kind: Kind | 'unclassified'
}

const ANONYMOUS_AUTH =
  /^\/api\/v1\/auth\/(register|login|refresh|verify-email|resend-verification|invitations\/accept|logout)$/

export function classify(method: string, routePath: string): Kind | 'unclassified' {
  if (routePath === '/health') return 'public'
  if (routePath === '/api/v1/public/:slug/stream') return 'stream'
  if (routePath.startsWith('/api/v1/public/')) return 'public'
  if (routePath === '/api/v1/judge/access/:token') return 'anonymous'
  if (method === 'POST' && routePath === '/api/v1/judge/auth') return 'anonymous'
  if (routePath.startsWith('/api/v1/judge/')) return 'judge'
  if (ANONYMOUS_AUTH.test(routePath)) return 'anonymous'
  if (method === 'POST' && routePath === '/api/v1/auth/invitations') return 'organizer'
  // Membres de l'organisation (Lot 24) : toujours la sienne, jamais d'`:id` de compétition.
  if (routePath.startsWith('/api/v1/organization/')) return 'organizer'
  if (routePath.startsWith('/api/v1/competitions/:id')) return 'organizer-competition'
  if (
    routePath === '/api/v1/competitions' ||
    routePath === '/api/v1/competitions/import' ||
    // Corbeille (Lot 11) : la liste des compétitions supprimées DE L'ORGANISATION, sans `:id`.
    routePath === '/api/v1/competitions/trash'
  )
    return 'organizer'
  return 'unclassified'
}

let container: StartedPostgreSqlContainer
let handle: DatabaseHandle
let storageRoot: string
let app: ReturnType<typeof createApp>
let routes: RouteEntry[]

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
  // La matrice envoie des dizaines de requêtes d'authentification.
  AUTH_RATE_LIMIT_MAX: 10_000,
}

interface World {
  competitionId: string
  slug: string
  categoryId: string
  routeId: string
  competitorId: string
  organizerToken: string
  judgeJwt: string
}
let mine: World
let otherOrganizationToken: string

const uuid = () => crypto.randomUUID()
const mailer = new FakeMailer()

async function api(method: string, url: string, token: string | null, body?: unknown) {
  const response = await app.request(url, {
    method,
    headers: token ? authHeaders(token) : { 'content-type': 'application/json' },
    ...(body !== undefined &&
      method !== 'GET' &&
      method !== 'HEAD' && { body: JSON.stringify(body) }),
  })
  return response
}

async function buildWorld(format: 'contest' | 'phases', token?: string): Promise<World> {
  const organizerToken = token ?? (await registerLoggedInOrganizer(app, mailer)).accessToken
  const competition = (await (
    await api('POST', '/api/v1/competitions', organizerToken, {
      name: `Coupe sécurité ${uuid()}`,
      venue: 'Salle',
      startsOn: '2099-01-01',
      endsOn: '2099-01-01',
      format,
      scoringEngineId: 'ffme-difficulty-2026',
      scoringConfig: { routesCounted: 1 },
    })
  ).json()) as { id: string; publicSlug: string }
  const base = `/api/v1/competitions/${competition.id}`
  const category = (await (
    await api('POST', `${base}/categories`, organizerToken, { label: 'Cat', sex: 'X' })
  ).json()) as { id: string }
  const competitor = (await (
    await api('POST', `${base}/competitors`, organizerToken, {
      categoryId: category.id,
      bib: 1,
      firstName: 'Léa',
      lastName: 'Martin',
      licenseNumber: 'LIC-SECRET-42',
      birthYear: 2011,
    })
  ).json()) as { id: string }
  const route = (await (
    await api('POST', `${base}/routes`, organizerToken, {
      number: 1,
      holdCount: 40,
      categoryIds: [category.id],
    })
  ).json()) as { id: string }
  const judge = (await (
    await api('POST', `${base}/judges`, organizerToken, {
      displayName: 'Juge',
      routeIds: [route.id],
    })
  ).json()) as { accessToken: string; pin?: string }
  const judgeJwt = await authenticateJudge(app, judge.accessToken, judge.pin)

  if (format === 'contest') {
    // Un passage réel : sans lui, le compétiteur n'apparaît pas sur la page
    // publique, et « aucune donnée privée n'y fuit » ne prouverait rien.
    await openContestRound(app, organizerToken, competition.id)
    const detail = (await (
      await api('GET', `/api/v1/judge/routes/${route.id}`, judgeJwt)
    ).json()) as {
      round: { id: string }
    }
    await api('POST', '/api/v1/judge/ascents/batch', judgeJwt, {
      items: [
        {
          kind: 'create',
          id: uuid(),
          roundId: detail.round.id,
          routeId: route.id,
          competitorId: competitor.id,
          holdNumber: 20,
          modifier: 'none',
          isTop: false,
          status: 'valid',
          climbTimeMs: null,
          recordedAt: new Date().toISOString(),
          deviceId: 'device-matrix',
        },
      ],
    })
  }
  return {
    competitionId: competition.id,
    slug: competition.publicSlug,
    categoryId: category.id,
    routeId: route.id,
    competitorId: competitor.id,
    organizerToken,
    judgeJwt,
  }
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16.15-alpine').start()
  const client = new pg.Client({ connectionString: container.getConnectionUri() })
  await client.connect()
  await applyPendingMigrations(client)
  await client.end()
  handle = createDatabase(container.getConnectionUri())
  storageRoot = await mkdtemp(path.join(tmpdir(), 'climbcontest-matrix-'))
  app = createApp({
    env,
    db: handle.db,
    mailer,
    logger: { info: () => {} } as unknown as Logger,
    accessTokenSigner: createAccessTokenSigner(env.JWT_ACCESS_SECRET),
    judgeTokenSigner: createJudgeTokenSigner(env.JWT_JUDGE_SECRET),
    storage: new LocalDiskStorage(storageRoot),
  })

  const seen = new Set<string>()
  routes = []
  for (const r of app.routes) {
    if (r.method === 'ALL') continue
    const key = `${r.method} ${r.path}`
    if (seen.has(key)) continue
    seen.add(key)
    routes.push({ method: r.method, path: r.path, kind: classify(r.method, r.path) })
  }

  mine = await buildWorld('contest')
  otherOrganizationToken = (await registerLoggedInOrganizer(app, mailer)).accessToken
}, 240_000)

afterAll(async () => {
  await handle.close()
  await container.stop()
  await rm(storageRoot, { recursive: true, force: true })
})

/** Remplace chaque `:param` par une valeur plausible ; tout ce qui n'est pas l'identifiant de MA compétition est aléatoire. */
function concrete(routePath: string, world: World): string {
  return routePath.replace(/:([A-Za-z]+)/g, (_match, name: string) => {
    if (name === 'id') return world.competitionId
    if (name === 'slug') return world.slug
    if (name === 'rid' || name === 'routeId') return world.routeId
    if (name === 'token') return 'jeton-inconnu'
    return uuid()
  })
}

const BODY = { any: {} }

const inKind =
  (...kinds: Kind[]) =>
  (r: RouteEntry) =>
    (kinds as string[]).includes(r.kind)
const label = (r: RouteEntry) => `${r.method} ${r.path}`

describe('inventaire des routes', () => {
  it('toute route enregistrée est classée — une nouvelle route doit être classée ICI, donc revue', () => {
    const unclassified = routes.filter((r) => r.kind === 'unclassified').map(label)
    expect(unclassified).toEqual([])
    expect(routes.length).toBeGreaterThan(60)
  })
})

describe('frontière organisateur', () => {
  const organizerRoutes = () => routes.filter(inKind('organizer', 'organizer-competition'))

  it('sans jeton : 401 partout', async () => {
    for (const r of organizerRoutes()) {
      const response = await api(r.method, concrete(r.path, mine), null, BODY.any)
      expect(response.status, label(r)).toBe(401)
    }
  })

  it('avec un jeton bidon : 401 partout', async () => {
    for (const r of organizerRoutes()) {
      const response = await api(r.method, concrete(r.path, mine), 'pas.un.jeton', BODY.any)
      expect(response.status, label(r)).toBe(401)
    }
  })

  it('avec un JETON JUGE valide : 401 partout — les deux portées ne se mélangent jamais', async () => {
    for (const r of organizerRoutes()) {
      const response = await api(r.method, concrete(r.path, mine), mine.judgeJwt, BODY.any)
      expect(response.status, label(r)).toBe(401)
    }
  })

  it('une compétition d’un AUTRE organisation : 404 partout (jamais 403, jamais 200)', async () => {
    for (const r of routes.filter(inKind('organizer-competition'))) {
      const response = await api(r.method, concrete(r.path, mine), otherOrganizationToken, BODY.any)
      expect(response.status, label(r)).toBe(404)
    }
  })
})

describe('frontière juge', () => {
  const judgeRoutes = () => routes.filter(inKind('judge'))

  it('sans jeton : 401 partout', async () => {
    for (const r of judgeRoutes()) {
      const response = await api(r.method, concrete(r.path, mine), null, BODY.any)
      expect(response.status, label(r)).toBe(401)
    }
  })

  it('avec un jeton bidon : 401 partout', async () => {
    for (const r of judgeRoutes()) {
      const response = await api(r.method, concrete(r.path, mine), 'pas.un.jeton', BODY.any)
      expect(response.status, label(r)).toBe(401)
    }
  })

  it('avec un JETON ORGANISATEUR valide : 401 partout', async () => {
    for (const r of judgeRoutes()) {
      const response = await api(r.method, concrete(r.path, mine), mine.organizerToken, BODY.any)
      expect(response.status, label(r)).toBe(401)
    }
  })
})

describe('frontière publique et routes anonymes', () => {
  const exposed = () =>
    routes.filter(inKind('public', 'anonymous')).filter((r) => r.path !== '/health')

  it('chaque route non authentifiée est limitée en débit (SPEC.md §6.4)', async () => {
    const missing: string[] = []
    for (const r of exposed()) {
      const response = await app.request(concrete(r.path, mine), {
        method: r.method,
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': `198.51.100.${Math.floor(Math.random() * 250)}`,
        },
        ...(r.method !== 'GET' && { body: '{}' }),
      })
      if (!response.headers.get('ratelimit-limit')) missing.push(label(r))
    }
    expect(missing).toEqual([])
  })

  it('aucune route ne répond 5xx à des paramètres hostiles', async () => {
    const hostile = [
      '../../etc/passwd',
      "' OR 1=1 --",
      'a'.repeat(5000),
      '%00',
      '{{7*7}}',
      '<script>alert(1)</script>',
      '🧗',
    ]
    const failures: string[] = []
    for (const r of routes.filter(inKind('public', 'anonymous'))) {
      if (r.path.includes('stream')) continue
      for (const value of hostile) {
        const url = r.path.replace(/:[A-Za-z]+/g, encodeURIComponent(value))
        const response = await app.request(url, {
          method: r.method,
          headers: {
            'content-type': 'application/json',
            'x-forwarded-for': `198.51.100.${Math.floor(Math.random() * 250)}`,
          },
          ...(r.method !== 'GET' && {
            body: JSON.stringify({ token: value, email: value, password: value }),
          }),
        })
        if (response.status >= 500)
          failures.push(`${label(r)} ← ${value.slice(0, 20)} → ${response.status}`)
      }
    }
    expect(failures).toEqual([])
  })

  it('les réponses publiques ne contiennent aucune donnée que le public ne doit pas voir', async () => {
    const bodies: string[] = []
    for (const r of routes.filter(inKind('public'))) {
      if (
        r.method !== 'GET' ||
        r.path.includes('stream') ||
        r.path === '/health' ||
        r.path.endsWith('/video')
      )
        continue
      const query =
        r.path.endsWith('/rankings') || r.path.endsWith('/routes')
          ? `?category=${mine.categoryId}`
          : ''
      const response = await app.request(concrete(r.path, mine) + query, {
        headers: { 'x-forwarded-for': `198.51.100.${Math.floor(Math.random() * 250)}` },
      })
      expect(response.status, label(r)).toBe(200)
      bodies.push(await response.text())
    }
    const all = bodies.join('\n')
    expect(all).toContain('Martin')
    expect(all).not.toContain('LIC-SECRET-42')
    expect(all).not.toContain('2011')
    expect(all).not.toMatch(
      /passwordHash|accessToken|pinHash|refreshToken|@club-demo\.test|@example/i,
    )
  })

  it('le flux temps réel d’une compétition inconnue répond 404, sans rester ouvert', async () => {
    const response = await app.request('/api/v1/public/inconnu/stream', {
      headers: { 'x-forwarded-for': '198.51.100.9' },
    })
    expect(response.status).toBe(404)
  })
})

describe('les lectures (GET) ne modifient rien', () => {
  async function counts(): Promise<string> {
    const tables = [
      'user',
      'organization',
      'session',
      'competition',
      'category',
      'competitor',
      'route',
      'round',
      'ascent',
      'ascent_event',
      'judge',
      'asset',
      'asset_upload',
      'activity_log',
      'round_qualifier',
    ]
    const rows = await Promise.all(
      tables.map((t) => handle.db.execute(sql.raw(`select count(*)::int as n from "${t}"`))),
    )
    return rows.map((r, i) => `${tables[i]}=${(r.rows[0] as { n: number }).n}`).join(',')
  }

  it('aucune route GET ne crée, ne supprime ni ne consomme de ligne (ADR-020)', async () => {
    const before = await counts()
    for (const r of routes.filter((x) => x.method === 'GET' && x.kind !== 'stream')) {
      const token =
        r.kind === 'judge'
          ? mine.judgeJwt
          : r.kind === 'organizer-competition' || r.kind === 'organizer'
            ? mine.organizerToken
            : null
      const query =
        r.path.endsWith('/rankings') || r.path.endsWith('/routes')
          ? `?category=${mine.categoryId}`
          : ''
      await app.request(concrete(r.path, mine) + query, {
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          'x-forwarded-for': `198.51.100.${Math.floor(Math.random() * 250)}`,
        },
      })
    }
    expect(await counts()).toBe(before)
  })
})

/**
 * Classe de faille la plus courante d'une API multi-compétitions : oublier de
 * borner une requête à `competition_id`. `requireCompetitionAccess` protège le
 * `:id` du chemin ; rien ne protège un identifiant IMBRIQUÉ (`:competitorId`…)
 * ni une référence dans le CORPS, sauf chaque route elle-même. Ici, DEUX
 * compétitions de la MÊME organisation : A1 est celle qu'on attaque, A2 celle qu'on vise.
 */
describe('isolement entre deux compétitions de la même organisation', () => {
  interface Victim {
    competitionId: string
    categoryId: string
    competitorId: string
    routeId: string
    roundId: string
    judgeId: string
    ascentId: string
  }
  let attackerCompetition: string
  let victim: Victim
  let token: string

  beforeAll(async () => {
    const attacker = await buildWorld('phases')
    token = attacker.organizerToken
    attackerCompetition = attacker.competitionId
    const other = await buildWorld('phases', token)
    const base = `/api/v1/competitions/${other.competitionId}`
    const round = (await (
      await api('POST', `${base}/rounds`, token, { type: 'qualification', style: 'onsight' })
    ).json()) as { id: string }
    await api('PUT', `${base}/rounds/${round.id}/routes`, token, {
      assignments: [{ routeId: other.routeId, categoryId: other.categoryId }],
    })
    await api('POST', `${base}/round-status/${round.id}`, token, {
      status: 'open',
      categoryIds: [other.categoryId],
    })
    const ascent = (await (
      await api('POST', `${base}/ascents`, token, {
        roundId: round.id,
        routeId: other.routeId,
        competitorId: other.competitorId,
        holdNumber: 10,
        modifier: 'none',
        isTop: false,
        status: 'valid',
        climbTimeMs: null,
        recordedAt: new Date().toISOString(),
      })
    ).json()) as { ascent: { id: string } }
    const judges = (await (await api('GET', `${base}/judges`, token)).json()) as { id: string }[]
    victim = {
      competitionId: other.competitionId,
      categoryId: other.categoryId,
      competitorId: other.competitorId,
      routeId: other.routeId,
      roundId: round.id,
      judgeId: judges[0]!.id,
      ascentId: ascent.ascent.id,
    }
  }, 120_000)

  const attack = (method: string, suffix: string, body?: unknown) =>
    api(method, `/api/v1/competitions/${attackerCompetition}${suffix}`, token, body)

  it('un identifiant imbriqué d’une AUTRE compétition est introuvable (404), jamais modifié ni supprimé', async () => {
    const cases: [string, string, unknown?][] = [
      ['PATCH', `/competitors/${victim.competitorId}`, { firstName: 'Piraté' }],
      ['PATCH', `/competitors/${victim.competitorId}/status`, { status: 'withdrawn' }],
      ['DELETE', `/competitors/${victim.competitorId}`],
      ['PATCH', `/categories/${victim.categoryId}`, { label: 'Piratée' }],
      ['DELETE', `/categories/${victim.categoryId}`],
      ['PATCH', `/routes/${victim.routeId}`, { name: 'Piratée' }],
      ['POST', `/judges/${victim.judgeId}/revoke`, {}],
      ['POST', `/judges/${victim.judgeId}/regenerate-pin`, {}],
      ['PATCH', `/rounds/${victim.roundId}`, { style: 'flash' }],
      ['GET', `/rounds/${victim.roundId}/routes`],
      ['PUT', `/rounds/${victim.roundId}/routes`, { assignments: [] }],
      [
        'POST',
        `/round-status/${victim.roundId}`,
        { status: 'closed', categoryIds: [victim.categoryId] },
      ],
      ['GET', `/round-status/${victim.roundId}/qualifiers`],
      [
        'PATCH',
        `/ascents/${victim.ascentId}`,
        { holdNumber: 1, modifier: 'none', isTop: false, status: 'valid', reason: 'Piratage' },
      ],
      [
        'POST',
        `/routes/${victim.routeId}/video/uploads`,
        { sizeBytes: 100, mimeType: 'video/mp4' },
      ],
      ['DELETE', `/routes/${victim.routeId}/video`],
    ]
    const wrong: string[] = []
    for (const [method, suffix, body] of cases) {
      const response = await attack(method, suffix, body)
      if (response.status !== 404) wrong.push(`${method} ${suffix} → ${response.status}`)
    }
    expect(wrong).toEqual([])
  })

  it('une référence à une AUTRE compétition dans le CORPS est refusée, sans rien écrire', async () => {
    const cases: [string, string, unknown][] = [
      [
        'POST',
        '/competitors',
        { categoryId: victim.categoryId, bib: 99, firstName: 'Infiltré', lastName: 'Test' },
      ],
      ['POST', '/routes', { number: 77, holdCount: 30, categoryIds: [victim.categoryId] }],
      ['POST', '/judges', { displayName: 'Juge infiltré', routeIds: [victim.routeId] }],
      [
        'POST',
        '/ascents',
        {
          roundId: victim.roundId,
          routeId: victim.routeId,
          competitorId: victim.competitorId,
          holdNumber: 5,
          modifier: 'none',
          isTop: false,
          status: 'valid',
          climbTimeMs: null,
          recordedAt: new Date().toISOString(),
        },
      ],
    ]
    const accepted: string[] = []
    for (const [method, suffix, body] of cases) {
      const response = await attack(method, suffix, body)
      if (response.status < 400) accepted.push(`${method} ${suffix} → ${response.status}`)
    }
    expect(accepted).toEqual([])
  })

  it('la compétition visée n’a subi aucune modification', async () => {
    const base = `/api/v1/competitions/${victim.competitionId}`
    const competitors = (await (await api('GET', `${base}/competitors`, token)).json()) as {
      id: string
      firstName: string
      status: string
      deletedAt: unknown
    }[]
    const categories = (await (await api('GET', `${base}/categories`, token)).json()) as {
      id: string
      label: string
    }[]
    const routesList = (await (await api('GET', `${base}/routes`, token)).json()) as {
      id: string
      name: string | null
    }[]
    const judgesList = (await (await api('GET', `${base}/judges`, token)).json()) as {
      id: string
      revokedAt: unknown
    }[]
    const rounds = (await (await api('GET', `${base}/rounds`, token)).json()) as {
      id: string
      style: string
    }[]
    // ADR-065 : le statut d'un tour est par catégorie, on le lit sur le tableau de bord.
    const dashboard = (await (await api('GET', `${base}/dashboard`, token)).json()) as {
      categories: { routes: { roundStatus: string | null }[] }[]
    }

    expect(competitors.map((c) => [c.firstName, c.status])).toEqual([['Léa', 'registered']])
    expect(categories.map((c) => c.label)).toEqual(['Cat'])
    expect(routesList.map((r) => r.name)).toEqual([null])
    expect(judgesList).toHaveLength(1)
    expect(judgesList[0]?.revokedAt ?? null).toBeNull()
    expect(rounds.map((r) => r.style)).toEqual(['onsight'])
    expect(dashboard.categories.flatMap((c) => c.routes.map((r) => r.roundStatus))).toEqual([
      'open',
    ])
  })
})
