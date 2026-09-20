import type { createApp } from '../app'
import type { FakeMailer } from './fake-mailer'
import {
  authenticateJudge,
  authHeaders,
  createTestCompetition,
  judgeAuthHeaders,
  registerLoggedInOrganizer,
} from './fixtures'

type App = ReturnType<typeof createApp>

export async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

/**
 * Scénario en phases partagé par les tests d'intégration du Lot 9 : une
 * catégorie de quatre compétiteurs (dossards 1 à 4), une qualification (voie
 * Q) puis une demi-finale (voie S), un juge assigné aux deux voies.
 */
export interface PhasesScenario {
  organizerToken: string
  competitionId: string
  publicSlug: string
  categoryId: string
  qualificationId: string
  semifinalId: string
  routeQ: string
  routeS: string
  /** bib 1..4, dans cet ordre. */
  competitors: { id: string; bib: number }[]
  judgeJwt: string
}

export async function setUpPhasesScenario(
  app: App,
  mailer: FakeMailer,
  qualifyingCount: number | null,
): Promise<PhasesScenario> {
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

  const category = await json<{ id: string }>(await post('/categories', { label: 'U16', sex: 'X' }))

  const competitors: { id: string; bib: number }[] = []
  for (const bib of [1, 2, 3, 4]) {
    const created = await json<{ id: string }>(
      await post('/competitors', {
        categoryId: category.id,
        bib,
        firstName: `Prénom${bib}`,
        lastName: `Nom${bib}`,
      }),
    )
    competitors.push({ id: created.id, bib })
  }

  const routeIds: string[] = []
  for (const number of [1, 2]) {
    const created = await json<{ id: string }>(
      await post('/routes', { number, holdCount: 40, categoryIds: [] }),
    )
    await post(`/routes/${created.id}`, { categoryIds: [category.id] }, 'PATCH')
    routeIds.push(created.id)
  }
  const [routeQ, routeS] = routeIds as [string, string]

  const qualification = await json<{ id: string }>(
    await post('/rounds', { type: 'qualification', style: 'onsight', qualifyingCount }),
  )
  const semifinal = await json<{ id: string }>(
    await post('/rounds', { type: 'semifinal', style: 'onsight' }),
  )
  await post(
    `/rounds/${qualification.id}/routes`,
    { assignments: [{ routeId: routeQ, categoryId: category.id }] },
    'PUT',
  )
  await post(
    `/rounds/${semifinal.id}/routes`,
    { assignments: [{ routeId: routeS, categoryId: category.id }] },
    'PUT',
  )

  const judge = await json<{ accessToken: string; pin?: string }>(
    await post('/judges', { displayName: 'Juge Test', routeIds: [routeQ, routeS] }),
  )
  const judgeJwt = await authenticateJudge(app, judge.accessToken, judge.pin)

  return {
    organizerToken,
    competitionId: competition.id,
    publicSlug: String(competition['publicSlug']),
    categoryId: category.id,
    qualificationId: qualification.id,
    semifinalId: semifinal.id,
    routeQ,
    routeS,
    competitors,
    judgeJwt,
  }
}

export function postRoundStatus(
  app: App,
  s: PhasesScenario,
  roundId: string,
  status: string,
): Promise<Response> {
  return Promise.resolve(
    app.request(`/api/v1/competitions/${s.competitionId}/round-status/${roundId}`, {
      method: 'POST',
      headers: authHeaders(s.organizerToken),
      body: JSON.stringify({ status, categoryIds: [s.categoryId] }),
    }),
  )
}

export async function enterAscent(
  app: App,
  s: PhasesScenario,
  roundId: string,
  routeId: string,
  competitorId: string,
  holdNumber: number,
) {
  const response = await app.request('/api/v1/judge/ascents/batch', {
    method: 'POST',
    headers: judgeAuthHeaders(s.judgeJwt),
    body: JSON.stringify({
      items: [
        {
          kind: 'create',
          id: crypto.randomUUID(),
          roundId,
          routeId,
          competitorId,
          holdNumber,
          modifier: 'none',
          isTop: false,
          status: 'valid',
          climbTimeMs: null,
          recordedAt: '2026-09-19T10:00:00.000Z',
          deviceId: 'device-test',
        },
      ],
    }),
  })
  const body = await json<{ results: { status: string; reason?: string }[] }>(response)
  return body.results[0]
}

/** Qualification jouée : bib 1 = prise 30, 2 = 25, 3 = 20, 4 = 10 (sauf `holds`), puis fermée. */
export async function playQualification(
  app: App,
  s: PhasesScenario,
  holds: number[] = [30, 25, 20, 10],
): Promise<void> {
  const opened = await postRoundStatus(app, s, s.qualificationId, 'open')
  if (opened.status !== 200) throw new Error(`open qualification: ${opened.status}`)
  for (const [index, competitor] of s.competitors.entries()) {
    const result = await enterAscent(
      app,
      s,
      s.qualificationId,
      s.routeQ,
      competitor.id,
      holds[index]!,
    )
    if (result?.status !== 'accepted') throw new Error(`enter ascent: ${JSON.stringify(result)}`)
  }
  const closed = await postRoundStatus(app, s, s.qualificationId, 'closed')
  if (closed.status !== 200) throw new Error(`close qualification: ${closed.status}`)
}
