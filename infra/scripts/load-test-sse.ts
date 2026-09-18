/**
 * Test de charge du flux SSE public (ROADMAP.md Lot 7, point 3 : cible 300
 * spectateurs connectés simultanément sur un serveur modeste).
 *
 * Aucune nouvelle dépendance (cohérent avec ADR-015 : pas d'outillage
 * disproportionné comme k6 ou un navigateur headless pour ce besoin) —
 * `fetch` + `ReadableStream` natifs de Node 22, exécuté via `tsx` (déjà une
 * dépendance du monorepo, déjà utilisée pour `packages/db/src/seed.ts`).
 *
 * Ce script s'authentifie comme le compte organisateur de démo et crée sa
 * propre compétition par l'API réelle (jamais un accès direct à la base) —
 * il mesure la vraie pile, pas un raccourci.
 *
 * Prérequis : la pile Docker Compose locale, démarrée ET seedée :
 *
 *   cd infra/docker && docker compose up --build -d
 *   docker compose --profile seed run --rm seed
 *
 * Usage (depuis la racine du dépôt) :
 *
 *   pnpm loadtest:sse
 *   LOAD_TEST_CONNECTIONS=500 LOAD_TEST_BASE_URL=http://localhost:8080 pnpm loadtest:sse
 *
 * Ce que ce script NE mesure PAS :
 * - la mémoire du conteneur API — aucun endpoint de debug n'a été ajouté à
 *   l'API pour ça (hors périmètre) ; observer `docker stats <conteneur api>`
 *   dans un terminal séparé pendant l'exécution ;
 * - la capacité du serveur isolée de celle de la machine qui exécute CE
 *   script : les 300 connexions sortantes partagent le même processus Node
 *   et la même pile réseau locale — sur une machine faible, le client peut
 *   devenir le facteur limitant avant le serveur.
 */

const BASE_URL = process.env['LOAD_TEST_BASE_URL'] ?? 'http://localhost:8080'
const CONNECTION_COUNT = Number(process.env['LOAD_TEST_CONNECTIONS'] ?? 300)
const ORGANIZER_EMAIL = 'organisateur@club-demo.test'
const ORGANIZER_PASSWORD = 'ChangeMoi123!'
/** Le serveur émet un `ping` toutes les 25 s (apps/api/src/routes/public.ts) — largement au-delà du temps de propagation attendu pour un seul NOTIFY. */
const EVENT_WAIT_TIMEOUT_MS = 20_000

async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers as Record<string, string> | undefined) },
  })
  if (!response.ok) {
    throw new Error(`${path} -> ${response.status} ${await response.text()}`)
  }
  return response.json() as Promise<T>
}

interface Fixture {
  slug: string
  categoryId: string
  competitionId: string
  roundId: string
  authHeaders: Record<string, string>
}

/**
 * Format phases : un `PATCH .../rounds/:id { status: 'open' }` suffit à
 * déclencher un `ranking_updated` réel (routes/rounds.ts), sans avoir à
 * fabriquer un juge ni un passage — le strict minimum pour ce test.
 */
async function setUp(): Promise<Fixture> {
  const { accessToken } = await apiJson<{ accessToken: string }>('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: ORGANIZER_EMAIL, password: ORGANIZER_PASSWORD }),
  })
  const authHeaders = { authorization: `Bearer ${accessToken}` }

  const competition = await apiJson<{ id: string; publicSlug: string }>('/api/v1/competitions', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      name: `Test de charge ${new Date().toISOString()}`,
      venue: 'Test de charge',
      startsOn: '2099-01-01',
      endsOn: '2099-01-01',
      format: 'phases',
      scoringEngineId: 'ffme-difficulty-2026',
    }),
  })

  const category = await apiJson<{ id: string }>(`/api/v1/competitions/${competition.id}/categories`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ label: 'Test de charge', sex: 'X' }),
  })

  const route = await apiJson<{ id: string }>(`/api/v1/competitions/${competition.id}/routes`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ number: 1, holdCount: 40, categoryIds: [category.id] }),
  })

  const round = await apiJson<{ id: string }>(`/api/v1/competitions/${competition.id}/rounds`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ type: 'qualification', style: 'onsight' }),
  })

  await apiJson(`/api/v1/competitions/${competition.id}/rounds/${round.id}/routes`, {
    method: 'PUT',
    headers: authHeaders,
    body: JSON.stringify({ assignments: [{ routeId: route.id, categoryId: category.id }] }),
  })

  return {
    slug: competition.publicSlug,
    categoryId: category.id,
    competitionId: competition.id,
    roundId: round.id,
    authHeaders,
  }
}

interface ConnectionResult {
  connectMs: number
  eventLatencyMs: number | null
}

async function openConnectionAndWaitForEvent(
  slug: string,
  categoryId: string,
  publishedAt: { time: number | null },
): Promise<ConnectionResult> {
  const connectStart = performance.now()
  const response = await fetch(`${BASE_URL}/api/v1/public/${slug}/stream`)
  const connectMs = performance.now() - connectStart
  if (!response.ok || !response.body) {
    throw new Error(`GET .../stream -> ${response.status}`)
  }

  const reader: ReadableStreamDefaultReader<Uint8Array> = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let eventLatencyMs: number | null = null

  const deadline = performance.now() + EVENT_WAIT_TIMEOUT_MS
  while (performance.now() < deadline) {
    const result = await reader.read()
    if (result.done) break
    buffer += decoder.decode(result.value, { stream: true })
    if (buffer.includes('event: ranking_updated') && buffer.includes(categoryId)) {
      eventLatencyMs = publishedAt.time === null ? null : performance.now() - publishedAt.time
      break
    }
  }
  await reader.cancel().catch(() => {})
  return { connectMs, eventLatencyMs }
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[index] ?? Number.NaN
}

function summarize(label: string, values: readonly number[]): void {
  if (values.length === 0) {
    console.log(`${label} : aucune donnée.`)
    return
  }
  console.log(
    `${label} — min ${Math.round(Math.min(...values))} ms, p50 ${Math.round(percentile(values, 50))} ms, ` +
      `p95 ${Math.round(percentile(values, 95))} ms, max ${Math.round(Math.max(...values))} ms (n=${values.length})`,
  )
}

async function main(): Promise<void> {
  console.log(`Test de charge SSE — ${CONNECTION_COUNT} connexions contre ${BASE_URL}`)
  const fixture = await setUp()
  console.log(`Compétition de test créée : ${fixture.competitionId} (slug ${fixture.slug})`)

  const publishedAt: { time: number | null } = { time: null }
  const connections = Array.from({ length: CONNECTION_COUNT }, () =>
    openConnectionAndWaitForEvent(fixture.slug, fixture.categoryId, publishedAt),
  )

  // Laisse les connexions s'établir avant l'écriture qui doit toutes les atteindre.
  await new Promise((resolve) => setTimeout(resolve, 3000))
  console.log('Ouverture du tour — déclenche le NOTIFY que toutes les connexions attendent…')
  publishedAt.time = performance.now()
  await apiJson(`/api/v1/competitions/${fixture.competitionId}/rounds/${fixture.roundId}`, {
    method: 'PATCH',
    headers: fixture.authHeaders,
    body: JSON.stringify({ status: 'open' }),
  })

  const results = await Promise.all(connections)

  const connectMsValues = results.map((r) => r.connectMs)
  const eventLatencyValues = results
    .map((r) => r.eventLatencyMs)
    .filter((v): v is number => v !== null)
  const missedCount = results.length - eventLatencyValues.length

  console.log('')
  console.log('--- Résultats ---')
  summarize('Temps de connexion', connectMsValues)
  summarize('Latence de propagation NOTIFY -> réception SSE', eventLatencyValues)
  console.log(`Connexions n'ayant reçu aucun événement dans le délai : ${missedCount}/${results.length}`)
  console.log('')
  console.log(
    'Mémoire non mesurée par ce script — observer `docker stats <conteneur api>` en parallèle.',
  )
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
