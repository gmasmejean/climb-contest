import type { createApp } from '../app'
import type { FakeMailer } from './fake-mailer'

type App = ReturnType<typeof createApp>

let counter = 0
function unique(prefix: string): string {
  counter += 1
  return `${prefix}-${Date.now()}-${counter}`
}

/**
 * Inscrit, vérifie et connecte un organisateur (owner d'un nouveau club) —
 * boilerplate commun à tous les tests de routes protégées par
 * `requireOrganizer`. Réutilise le flux HTTP réel plutôt que d'insérer
 * directement en base, pour rester représentatif (comme `auth.test.ts`).
 */
export async function registerLoggedInOrganizer(
  app: App,
  mailer: FakeMailer,
  overrides: { email?: string; password?: string; clubName?: string } = {},
): Promise<{ accessToken: string; email: string }> {
  const email = overrides.email ?? `${unique('organizer')}@club-demo.test`
  const password = overrides.password ?? 'un-mot-de-passe-solide'
  const clubName = overrides.clubName ?? unique('Club')

  await app.request('/api/v1/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, displayName: 'Alex', clubName }),
  })
  const token = mailer.lastTokenFor(email)
  await app.request('/api/v1/auth/verify-email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  })
  const loginResponse = await app.request('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const { accessToken } = (await loginResponse.json()) as { accessToken: string }
  return { accessToken, email }
}

export interface TestCompetition {
  id: string
  format: 'contest' | 'phases'
  [key: string]: unknown
}

export async function createTestCompetition(
  app: App,
  accessToken: string,
  overrides: Record<string, unknown> = {},
): Promise<TestCompetition> {
  const response = await app.request('/api/v1/competitions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      name: unique('Coupe'),
      venue: 'Salle Roc',
      startsOn: '2026-05-01',
      endsOn: '2026-05-01',
      format: 'contest',
      scoringEngineId: 'ffme-difficulty-2026',
      scoringConfig: { routesCounted: 3 },
      ...overrides,
    }),
  })
  if (response.status !== 201) {
    throw new Error(`createTestCompetition failed: ${response.status} ${await response.text()}`)
  }
  return (await response.json()) as TestCompetition
}

export function authHeaders(accessToken: string): Record<string, string> {
  return { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` }
}

export interface JudgeFixture {
  organizerToken: string
  competition: TestCompetition
  category: { id: string; label: string }
  competitor: { id: string; bib: number | null; firstName: string; lastName: string }
  route: { id: string; number: number; holdCount: number }
  judge: { id: string; accessToken: string; pin?: string }
}

/**
 * Compétition complète pour tester l'interface juge : une catégorie, un
 * compétiteur, une voie affectée à cette catégorie, un juge assigné à cette
 * voie. Par défaut format contest (round implicite, ADR-023), ouvert (la
 * compétition passe à `running`, ce qui ouvre mécaniquement ce round —
 * DECISIONS.md ADR-030). `format: 'phases'` crée un tour explicite
 * (`qualification`/`onsight`) câblé à la voie via `PUT .../rounds/:id/routes`
 * plutôt que la synchronisation automatique du contest ; `openRound: false`
 * laisse ce tour en `draft` — utile pour tester l'état « aucun tour ouvert ».
 * Le `roundId` n'est volontairement pas renvoyé ici : un test l'obtient comme
 * le ferait un vrai client, via `GET /api/v1/judge/routes/:routeId` une fois
 * le juge authentifié.
 */
export async function createJudgeFixture(
  app: App,
  mailer: FakeMailer,
  overrides: {
    judgePinRequired?: boolean
    holdCount?: number
    format?: 'contest' | 'phases'
    openRound?: boolean
  } = {},
): Promise<JudgeFixture> {
  const format = overrides.format ?? 'contest'
  const openRound = overrides.openRound ?? true
  const { accessToken: organizerToken } = await registerLoggedInOrganizer(app, mailer)
  // `endsOn` dans le futur : le JWT juge expire à fin de compétition + 12h
  // (SPEC.md § 3.2).
  const competition = await createTestCompetition(app, organizerToken, {
    format,
    startsOn: '2099-01-01',
    endsOn: '2099-01-01',
  })

  if (overrides.judgePinRequired) {
    await app.request(`/api/v1/competitions/${competition.id}`, {
      method: 'PATCH',
      headers: authHeaders(organizerToken),
      body: JSON.stringify({ judgePinRequired: true }),
    })
  }

  const categoryResponse = await app.request(`/api/v1/competitions/${competition.id}/categories`, {
    method: 'POST',
    headers: authHeaders(organizerToken),
    body: JSON.stringify({ label: unique('Categorie'), sex: 'X' }),
  })
  const category = (await categoryResponse.json()) as { id: string; label: string }

  const competitorResponse = await app.request(
    `/api/v1/competitions/${competition.id}/competitors`,
    {
      method: 'POST',
      headers: authHeaders(organizerToken),
      body: JSON.stringify({
        categoryId: category.id,
        bib: 1,
        firstName: 'Léa',
        lastName: 'Martin',
      }),
    },
  )
  const competitor = (await competitorResponse.json()) as {
    id: string
    bib: number | null
    firstName: string
    lastName: string
  }

  const routeResponse = await app.request(`/api/v1/competitions/${competition.id}/routes`, {
    method: 'POST',
    headers: authHeaders(organizerToken),
    body: JSON.stringify({
      number: 1,
      holdCount: overrides.holdCount ?? 40,
      // En contest, affecter la catégorie ici câble aussi `round_route`
      // automatiquement (`lib/contest-round.ts`). En phases, `round_route`
      // n'existe pas encore : câblé explicitement ci-dessous une fois le
      // tour créé.
      categoryIds: format === 'contest' ? [category.id] : [],
    }),
  })
  const route = (await routeResponse.json()) as { id: string; number: number; holdCount: number }

  if (format === 'phases') {
    await app.request(`/api/v1/competitions/${competition.id}/routes/${route.id}`, {
      method: 'PATCH',
      headers: authHeaders(organizerToken),
      body: JSON.stringify({ categoryIds: [category.id] }),
    })
    const roundResponse = await app.request(`/api/v1/competitions/${competition.id}/rounds`, {
      method: 'POST',
      headers: authHeaders(organizerToken),
      body: JSON.stringify({ type: 'qualification', style: 'onsight' }),
    })
    const round = (await roundResponse.json()) as { id: string }
    await app.request(`/api/v1/competitions/${competition.id}/rounds/${round.id}/routes`, {
      method: 'PUT',
      headers: authHeaders(organizerToken),
      body: JSON.stringify({ assignments: [{ routeId: route.id, categoryId: category.id }] }),
    })
    if (openRound) {
      await app.request(`/api/v1/competitions/${competition.id}/rounds/${round.id}`, {
        method: 'PATCH',
        headers: authHeaders(organizerToken),
        body: JSON.stringify({ status: 'open' }),
      })
    }
  }

  const judgeResponse = await app.request(`/api/v1/competitions/${competition.id}/judges`, {
    method: 'POST',
    headers: authHeaders(organizerToken),
    body: JSON.stringify({ displayName: 'Juge Test', routeIds: [route.id] }),
  })
  const judge = (await judgeResponse.json()) as { id: string; accessToken: string; pin?: string }

  if (format === 'contest' && openRound) {
    // Round implicite du contest (ADR-023) : s'ouvre automatiquement quand
    // la compétition passe à `running` (ADR-030) — aucun écran « Tours » ne
    // l'expose en contest.
    await app.request(`/api/v1/competitions/${competition.id}/status`, {
      method: 'POST',
      headers: authHeaders(organizerToken),
      body: JSON.stringify({ status: 'running' }),
    })
  }

  return { organizerToken, competition, category, competitor, route, judge }
}

export async function authenticateJudge(
  app: App,
  accessToken: string,
  pin?: string,
): Promise<string> {
  const response = await app.request('/api/v1/judge/auth', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: accessToken, pin }),
  })
  if (response.status !== 200) {
    throw new Error(`authenticateJudge failed: ${response.status} ${await response.text()}`)
  }
  const body = (await response.json()) as { token: string }
  return body.token
}

export function judgeAuthHeaders(judgeJwt: string): Record<string, string> {
  return { 'content-type': 'application/json', authorization: `Bearer ${judgeJwt}` }
}
