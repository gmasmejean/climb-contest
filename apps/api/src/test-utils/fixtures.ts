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
