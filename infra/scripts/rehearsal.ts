/**
 * Répétition générale (ROADMAP.md Lot 9, point 6) — et test de charge de la
 * synchronisation (point 4) : une compétition complète de 60 compétiteurs,
 * 4 catégories, 8 voies et 4 juges, avec des coupures réseau provoquées.
 *
 * Tout passe par l'API RÉELLE de la pile locale (jamais un accès direct à la
 * base), avec de vrais lots `POST /judge/ascents/batch`. Chaque « appareil »
 * juge tient sa file en mémoire et se comporte comme `packages/sync` :
 * il renvoie tant qu'il n'a pas d'accusé de réception, avec un repli.
 *
 * Ce qui est provoqué :
 *   - des requêtes perdues AVANT d'arriver au serveur (réseau coupé) ;
 *   - des réponses perdues APRÈS que le serveur a traité (le client rejoue :
 *     le serveur doit répondre `duplicate`, jamais créer un doublon) ;
 *   - un second appareil du juge 1 qui saisit des valeurs DIFFÉRENTES pour les
 *     mêmes passages (conflits, tranchés ensuite par l'organisateur) ;
 *   - deux corrections de juge ;
 *   - le juge 4 révoqué en cours de route (saisie de secours de l'organisateur).
 *
 * Ce qui est vérifié à la fin :
 *   - aucun passage perdu, aucun doublon actif (export JSON de sauvegarde) ;
 *   - le classement public de chaque catégorie est IDENTIQUE au recalcul
 *     indépendant fait ici avec `packages/scoring` à partir des saisies connues.
 *
 * Prérequis : la pile Docker Compose locale, démarrée ET seedée, avec un
 * plafond d'authentification relevé (voir e2e/README.md) — le script se
 * connecte une fois :
 *
 *   pnpm rehearsal
 *   REHEARSAL_SEED=7 REHEARSAL_DROP_RATE=0.4 pnpm rehearsal
 */
import { getScoringEngine } from '../../packages/scoring/src/index'

const BASE_URL = process.env['REHEARSAL_BASE_URL'] ?? 'http://localhost:8080'
const SEED = Number(process.env['REHEARSAL_SEED'] ?? 42)
const DROP_RATE = Number(process.env['REHEARSAL_DROP_RATE'] ?? 0.25)
const LOST_RESPONSE_RATE = Number(process.env['REHEARSAL_LOST_RESPONSE_RATE'] ?? 0.15)
const ORGANIZER_EMAIL = 'organisateur@club-demo.test'
const ORGANIZER_PASSWORD = 'ChangeMoi123!'

const CATEGORY_COUNT = 4
const PER_CATEGORY = 15
const ROUTES_PER_CATEGORY = 2
const HOLD_COUNT = 40

/** Générateur pseudo-aléatoire déterministe (mulberry32) : deux exécutions avec la même graine jouent la même compétition. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const random = rng(SEED)
const between = (min: number, max: number) => min + Math.floor(random() * (max - min + 1))
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

interface Truth {
  id: string
  competitorId: string
  bib: number
  categoryIndex: number
  routeNumber: number
  holdNumber: number | null
  isTop: boolean
  status: 'valid' | 'dns' | 'dnf'
}

const stats = {
  batches: 0,
  requests: 0,
  droppedBeforeSend: 0,
  lostResponses: 0,
  rateLimited: 0,
  accepted: 0,
  duplicate: 0,
  conflict: 0,
  rejected: 0,
  unauthorized: 0,
  latencies: [] as number[],
}
const anomalies: string[] = []

async function http(path: string, init: RequestInit = {}) {
  return fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init.headers as Record<string, string> | undefined),
    },
  })
}
async function json<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await http(path, init)
  if (!response.ok) throw new Error(`${path} -> ${response.status} ${await response.text()}`)
  return (await response.json()) as T
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0
}

/** Envoie un lot unique (correction, second appareil…) en reprenant sur `429` : la limitation de débit par adresse est PARTAGÉE par tous les juges d'une salle. */
async function postBatchOnce(
  token: string,
  items: unknown[],
): Promise<{ status: string; reason?: string }[]> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const response = await http('/api/v1/judge/ascents/batch', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ items }),
    })
    if (response.status === 429) {
      stats.rateLimited += 1
      await sleep(Math.min(5000, 250 * 2 ** attempt))
      continue
    }
    if (!response.ok) throw new Error(`lot refusé avec ${response.status}`)
    return ((await response.json()) as { results: { status: string; reason?: string }[] }).results
  }
  throw new Error('lot toujours limité en débit après 12 essais')
}

interface Device {
  name: string
  token: string
  queue: Truth[]
  revoked: boolean
}

interface Setup {
  competitionId: string
  slug: string
  headers: Record<string, string>
  categoryIds: string[]
  routeIds: string[]
  roundId: string
  competitorIds: Map<number, string>
  judges: { id: string; token: string; jwt: string; routeNumbers: number[] }[]
}

async function setUp(): Promise<Setup> {
  const { accessToken } = await json<{ accessToken: string }>('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: ORGANIZER_EMAIL, password: ORGANIZER_PASSWORD }),
  })
  const headers = { authorization: `Bearer ${accessToken}` }
  const competition = await json<{ id: string; publicSlug: string }>('/api/v1/competitions', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: `Répétition générale ${new Date().toISOString()}`,
      venue: 'Répétition',
      startsOn: '2099-01-01',
      endsOn: '2099-01-01',
      format: 'contest',
      scoringEngineId: 'ffme-difficulty-2026',
      scoringConfig: { routesCounted: ROUTES_PER_CATEGORY },
    }),
  })
  const base = `/api/v1/competitions/${competition.id}`

  const categoryIds: string[] = []
  const competitorIds = new Map<number, string>()
  let bib = 1
  for (let c = 0; c < CATEGORY_COUNT; c += 1) {
    const category = await json<{ id: string }>(`${base}/categories`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ label: `Catégorie ${c + 1}`, sex: 'X' }),
    })
    categoryIds.push(category.id)
    for (let i = 0; i < PER_CATEGORY; i += 1) {
      const created = await json<{ id: string }>(`${base}/competitors`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          categoryId: category.id,
          bib,
          firstName: `Prénom${bib}`,
          lastName: `Nom${bib}`,
        }),
      })
      competitorIds.set(bib, created.id)
      bib += 1
    }
  }

  const routeIds: string[] = []
  for (let n = 1; n <= CATEGORY_COUNT * ROUTES_PER_CATEGORY; n += 1) {
    const category = categoryIds[Math.floor((n - 1) / ROUTES_PER_CATEGORY)]
    const route = await json<{ id: string }>(`${base}/routes`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ number: n, holdCount: HOLD_COUNT, categoryIds: [category] }),
    })
    routeIds.push(route.id)
  }

  const judges: Setup['judges'] = []
  for (let j = 0; j < CATEGORY_COUNT; j += 1) {
    const routeNumbers = [j * 2 + 1, j * 2 + 2]
    const created = await json<{ id: string; accessToken: string }>(`${base}/judges`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        displayName: `Juge ${j + 1}`,
        routeIds: routeNumbers.map((n) => routeIds[n - 1]),
      }),
    })
    const auth = await json<{ token: string }>('/api/v1/judge/auth', {
      method: 'POST',
      body: JSON.stringify({ token: created.accessToken }),
    })
    judges.push({ id: created.id, token: created.accessToken, jwt: auth.token, routeNumbers })
  }

  // ADR-065 : le statut « En cours » n'ouvre plus le round implicite du contest ;
  // chaque catégorie s'ouvre par `round-status`. Son identifiant se lit sur le tableau de bord.
  const dashboard = await json<{
    categories: { routes: { roundId: string | null }[] }[]
  }>(`${base}/dashboard`, { headers })
  const implicitRoundId = dashboard.categories
    .flatMap((cat) => cat.routes)
    .find((r) => r.roundId !== null)?.roundId
  if (!implicitRoundId) throw new Error('Aucun tour à ouvrir : aucune voie n’est affectée.')
  await json(`${base}/round-status/${implicitRoundId}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ status: 'open', categoryIds }),
  })
  const detail = await json<{ round: { id: string } }>(`/api/v1/judge/routes/${routeIds[0]}`, {
    headers: { authorization: `Bearer ${judges[0]!.jwt}` },
  })
  return {
    competitionId: competition.id,
    slug: competition.publicSlug,
    headers,
    categoryIds,
    routeIds,
    roundId: detail.round.id,
    competitorIds,
    judges,
  }
}

function planTruth(setup: Setup): Truth[] {
  const truth: Truth[] = []
  for (const [bib, competitorId] of setup.competitorIds) {
    const categoryIndex = Math.floor((bib - 1) / PER_CATEGORY)
    for (let r = 0; r < ROUTES_PER_CATEGORY; r += 1) {
      const routeNumber = categoryIndex * ROUTES_PER_CATEGORY + r + 1
      const roll = random()
      const isTop = roll < 0.1
      const status = roll > 0.97 ? 'dnf' : roll > 0.94 ? 'dns' : 'valid'
      truth.push({
        id: crypto.randomUUID(),
        competitorId,
        bib,
        categoryIndex,
        routeNumber,
        holdNumber: status !== 'valid' || isTop ? null : between(5, HOLD_COUNT),
        isTop: status === 'valid' && isTop,
        status,
      })
    }
  }
  return truth
}

function toItem(setup: Setup, entry: Truth, deviceName: string, offsetMs: number) {
  return {
    kind: 'create' as const,
    id: entry.id,
    roundId: setup.roundId,
    routeId: setup.routeIds[entry.routeNumber - 1]!,
    competitorId: entry.competitorId,
    holdNumber: entry.holdNumber,
    modifier: 'none' as const,
    isTop: entry.isTop,
    status: entry.status,
    climbTimeMs: null,
    recordedAt: new Date(Date.now() + offsetMs).toISOString(),
    deviceId: deviceName,
  }
}

/** Un appareil : envoie sa file par lots, avec coupures, réponses perdues et repli, jusqu'à l'accusé de tout. */
async function runDevice(setup: Setup, device: Device) {
  let sent = 0
  let attemptsForBatch = 0
  while (device.queue.length > 0) {
    const batch = device.queue.slice(0, between(1, 5))
    attemptsForBatch += 1
    stats.requests += 1

    if (random() < DROP_RATE) {
      // Réseau coupé : rien n'est parti.
      stats.droppedBeforeSend += 1
      await sleep(Math.min(400, 15 * 2 ** Math.min(attemptsForBatch, 5)))
      continue
    }

    const started = performance.now()
    const response = await http('/api/v1/judge/ascents/batch', {
      method: 'POST',
      headers: { authorization: `Bearer ${device.token}` },
      body: JSON.stringify({
        items: batch.map((entry, i) => toItem(setup, entry, device.name, sent + i)),
      }),
    })
    stats.latencies.push(performance.now() - started)
    stats.batches += 1

    if (response.status === 429) {
      stats.rateLimited += 1
      await sleep(Math.min(1500, 100 * 2 ** Math.min(attemptsForBatch, 4)))
      continue
    }
    if (response.status === 401) {
      // Juge révoqué : sa file ne partira jamais. Rien ne le lui dit clairement (TODO.md).
      stats.unauthorized += 1
      device.revoked = true
      return
    }
    if (!response.ok) {
      anomalies.push(`${device.name} : lot refusé avec ${response.status}`)
      await sleep(50)
      continue
    }

    const body = (await response.json()) as {
      results: { id: string; status: string; reason?: string }[]
    }
    if (random() < LOST_RESPONSE_RATE) {
      // Le serveur a TRAITÉ, mais le client n'a jamais reçu l'accusé : il rejouera.
      stats.lostResponses += 1
      await sleep(20)
      continue
    }

    attemptsForBatch = 0
    for (const result of body.results) {
      if (result.status === 'accepted') stats.accepted += 1
      else if (result.status === 'duplicate') stats.duplicate += 1
      else if (result.status === 'conflict') stats.conflict += 1
      else {
        stats.rejected += 1
        anomalies.push(
          `${device.name} : passage ${result.id} rejeté (${result.reason ?? 'sans motif'})`,
        )
      }
    }
    device.queue.splice(0, batch.length)
    sent += batch.length
    await sleep(between(2, 25))
  }
}

async function main() {
  console.log(
    `Répétition générale — graine ${SEED}, ${CATEGORY_COUNT} catégories × ${PER_CATEGORY} = ${CATEGORY_COUNT * PER_CATEGORY} compétiteurs, ${CATEGORY_COUNT * ROUTES_PER_CATEGORY} voies, ${CATEGORY_COUNT} juges`,
  )
  console.log(
    `Coupures : ${Math.round(DROP_RATE * 100)} % de requêtes perdues, ${Math.round(LOST_RESPONSE_RATE * 100)} % de réponses perdues\n`,
  )
  const startedAt = performance.now()

  const setup = await setUp()
  const truth = planTruth(setup)
  const base = `/api/v1/competitions/${setup.competitionId}`

  // Un appareil par juge ; le 4ᵉ sera révoqué après la moitié de sa file.
  const devices: Device[] = setup.judges.map((judge, index) => ({
    name: `appareil-juge-${index + 1}`,
    token: judge.jwt,
    queue: truth.filter((t) => judge.routeNumbers.includes(t.routeNumber)),
    revoked: false,
  }))
  for (const device of devices) device.queue.sort(() => random() - 0.5)
  const revokedDevice = devices[3]!
  const revokedQueueSize = revokedDevice.queue.length
  const revokedTruth = new Set(revokedDevice.queue.map((t) => t.id))
  // La moitié de la file du juge 4 part, puis son accès est révoqué.
  const firstHalf = revokedDevice.queue.splice(0, Math.floor(revokedQueueSize / 2))
  const secondHalf = [...revokedDevice.queue]
  revokedDevice.queue = firstHalf

  // --- Phase 1 : les quatre juges saisissent en parallèle, avec coupures ---
  await Promise.all(devices.map((device) => runDevice(setup, device)))

  // --- Deux corrections du juge 2 (chaînage `superseded_by`, jamais d'écrasement) ---
  const toCorrect = truth
    .filter(
      (t) =>
        setup.judges[1]!.routeNumbers.includes(t.routeNumber) &&
        t.status === 'valid' &&
        !t.isTop &&
        t.holdNumber !== null &&
        t.holdNumber < HOLD_COUNT,
    )
    .slice(0, 2)
  for (const entry of toCorrect) {
    const newHold = (entry.holdNumber ?? 0) + 1
    const results = await postBatchOnce(setup.judges[1]!.jwt, [
      {
        kind: 'correct',
        id: crypto.randomUUID(),
        supersedesId: entry.id,
        holdNumber: newHold,
        modifier: 'none',
        isTop: false,
        status: 'valid',
        climbTimeMs: null,
      },
    ])
    const body = { results }
    if (body.results[0]?.status === 'accepted') entry.holdNumber = newHold
    else
      anomalies.push(
        `Correction refusée (${body.results[0]?.status} : ${body.results[0]?.reason ?? 'sans motif'}).`,
      )
  }

  // --- Le juge 4 est révoqué ; le reste de sa file ne partira jamais ---
  await json(`${base}/judges/${setup.judges[3]!.id}/revoke`, {
    method: 'POST',
    headers: setup.headers,
    body: '{}',
  })
  revokedDevice.queue = secondHalf
  const before401 = stats.unauthorized
  await runDevice(setup, revokedDevice)
  if (stats.unauthorized === before401)
    anomalies.push('Le juge révoqué a pu envoyer un lot APRÈS sa révocation.')

  // --- Saisie de secours : l'organisateur saisit à la place du juge révoqué ---
  for (const entry of secondHalf) {
    const response = await http(`${base}/ascents`, {
      method: 'POST',
      headers: setup.headers,
      body: JSON.stringify({
        roundId: setup.roundId,
        routeId: setup.routeIds[entry.routeNumber - 1],
        competitorId: entry.competitorId,
        holdNumber: entry.holdNumber,
        modifier: 'none',
        isTop: entry.isTop,
        status: entry.status,
        climbTimeMs: null,
        recordedAt: new Date().toISOString(),
      }),
    })
    if (!response.ok)
      anomalies.push(`Saisie de secours refusée pour le dossard ${entry.bib} : ${response.status}`)
  }

  // --- Second appareil du juge 1 : trois valeurs DIFFÉRENTES pour des passages déjà envoyés ---
  const judge1Entries = truth
    .filter(
      (t) =>
        setup.judges[0]!.routeNumbers.includes(t.routeNumber) && t.status === 'valid' && !t.isTop,
    )
    .slice(0, 3)
  const conflictTruth: { entry: Truth; otherId: string }[] = []
  for (const entry of judge1Entries) {
    const otherId = crypto.randomUUID()
    const other = {
      ...entry,
      id: otherId,
      holdNumber: entry.holdNumber === HOLD_COUNT ? HOLD_COUNT - 1 : (entry.holdNumber ?? 5) + 1,
    }
    const results = await postBatchOnce(setup.judges[0]!.jwt, [
      toItem(setup, other, 'appareil-juge-1-bis', 0),
    ])
    const body = { results }
    if (body.results[0]?.status === 'conflict') {
      stats.conflict += 1
      conflictTruth.push({ entry, otherId })
    } else
      anomalies.push(
        `Le second appareil n'a pas déclenché de conflit (statut ${body.results[0]?.status}).`,
      )
  }

  // --- L'organisateur tranche : il garde la valeur du premier appareil ---
  const conflicts = await json<{ conflictGroup: string; ascents: { ascent: { id: string } }[] }[]>(
    `${base}/conflicts`,
    { headers: setup.headers },
  )
  for (const conflict of conflicts) {
    const keep =
      conflictTruth.find((c) => conflict.ascents.some((a) => a.ascent.id === c.entry.id))?.entry
        .id ?? conflict.ascents[0]!.ascent.id
    const response = await http(`${base}/conflicts/${conflict.conflictGroup}/resolve`, {
      method: 'POST',
      headers: setup.headers,
      body: JSON.stringify({ resolution: 'choose', ascentId: keep }),
    })
    if (!response.ok) anomalies.push(`Résolution de conflit refusée : ${response.status}`)
  }
  const remaining = await json<unknown[]>(`${base}/conflicts`, { headers: setup.headers })

  // --- Vérification 1 : aucun passage perdu, aucun doublon actif ---
  const backup = await json<{
    ascents: {
      id: string
      competitorId: string
      routeId: string
      holdNumber: number | null
      isTop: boolean
      status: string
      supersededBy: string | null
      conflictGroup: string | null
    }[]
  }>(`${base}/exports/competition.json`, { headers: setup.headers })
  const active = backup.ascents.filter((a) => a.supersededBy === null && a.conflictGroup === null)
  const activeKeys = new Map<string, number>()
  for (const a of active) {
    const key = `${a.competitorId}|${a.routeId}`
    activeKeys.set(key, (activeKeys.get(key) ?? 0) + 1)
  }
  const duplicatesActive = [...activeKeys.values()].filter((n) => n > 1).length
  const missing = truth.filter(
    (t) => !activeKeys.has(`${t.competitorId}|${setup.routeIds[t.routeNumber - 1]}`),
  )
  const expectedActive = truth.length

  // --- Vérification 2 : le classement public = le recalcul indépendant ---
  const engine = getScoringEngine('ffme-difficulty-2026')
  const rankingMismatches: string[] = []
  for (let c = 0; c < CATEGORY_COUNT; c += 1) {
    const routeRankings = []
    for (let r = 0; r < ROUTES_PER_CATEGORY; r += 1) {
      const routeNumber = c * ROUTES_PER_CATEGORY + r + 1
      const ascents = truth
        .filter((t) => t.routeNumber === routeNumber)
        .map((t) => ({
          competitorId: t.competitorId,
          holdNumber: t.holdNumber,
          holdCount: HOLD_COUNT,
          modifier: 'none' as const,
          isTop: t.isTop,
          status: t.status,
          climbTimeMs: null,
        }))
      routeRankings.push(
        engine.rankRoute(ascents, { id: setup.routeIds[routeNumber - 1]!, holdCount: HOLD_COUNT }),
      )
    }
    const expected = engine.rankRound(routeRankings, {
      format: 'contest',
      routesCounted: ROUTES_PER_CATEGORY,
    })
    const expectedByCompetitor = new Map(expected.entries.map((e) => [e.competitorId, e.rank]))

    const publicRanking = await json<{ entries: { rank: number; bib: number }[] }>(
      `/api/v1/public/${setup.slug}/rankings?category=${setup.categoryIds[c]}`,
    )
    for (const entry of publicRanking.entries) {
      const competitorId = setup.competitorIds.get(entry.bib)
      if (!competitorId || expectedByCompetitor.get(competitorId) !== entry.rank) {
        rankingMismatches.push(
          `catégorie ${c + 1}, dossard ${entry.bib} : serveur rang ${entry.rank}, attendu ${expectedByCompetitor.get(competitorId ?? '') ?? '?'}`,
        )
      }
    }
    if (publicRanking.entries.length !== PER_CATEGORY)
      rankingMismatches.push(
        `catégorie ${c + 1} : ${publicRanking.entries.length} classés sur ${PER_CATEGORY}`,
      )
  }

  const seconds = (performance.now() - startedAt) / 1000
  const lost = missing.length
  console.log('── Résultat ──────────────────────────────────────────────')
  console.log(`Durée totale                 ${seconds.toFixed(1)} s`)
  console.log(`Passages attendus / actifs   ${expectedActive} / ${active.length}`)
  console.log(`Passages PERDUS              ${lost}`)
  console.log(`Doublons actifs              ${duplicatesActive}`)
  console.log(`Écarts de classement         ${rankingMismatches.length}`)
  console.log('')
  console.log(`Requêtes tentées             ${stats.requests}`)
  console.log(`  perdues avant envoi        ${stats.droppedBeforeSend}`)
  console.log(`  réponses perdues (rejeu)   ${stats.lostResponses}`)
  console.log(`  429 (limitation de débit)  ${stats.rateLimited}`)
  console.log(`Lots reçus par le serveur    ${stats.batches}`)
  console.log(
    `Éléments : acceptés ${stats.accepted}, doublons ${stats.duplicate}, conflits ${stats.conflict}, rejetés ${stats.rejected}`,
  )
  console.log(
    `Latence d'un lot (ms)        p50 ${percentile(stats.latencies, 50).toFixed(0)}, p95 ${percentile(stats.latencies, 95).toFixed(0)}, max ${Math.max(0, ...stats.latencies).toFixed(0)}`,
  )
  console.log(
    `Débit                        ${(stats.accepted / seconds).toFixed(1)} passages/s (${stats.batches} lots)`,
  )
  console.log(`Conflits restants après tranchage  ${remaining.length}`)
  console.log(
    `Juge 4 révoqué : ${revokedTruth.size} saisies prévues, ${secondHalf.length} restées dans sa file, reprises par l'organisateur ; 401 reçus ${stats.unauthorized}`,
  )
  if (anomalies.length > 0) {
    console.log('\nAnomalies :')
    for (const anomaly of [...new Set(anomalies)].slice(0, 20)) console.log(`  - ${anomaly}`)
  }
  if (rankingMismatches.length > 0) {
    console.log('\nÉcarts de classement :')
    for (const mismatch of rankingMismatches.slice(0, 10)) console.log(`  - ${mismatch}`)
  }

  const failed =
    lost > 0 || duplicatesActive > 0 || rankingMismatches.length > 0 || remaining.length > 0
  console.log(
    failed
      ? '\nÉCHEC : la répétition a révélé une perte ou un écart.'
      : '\nOK : aucune saisie perdue, aucun doublon, classement identique au recalcul indépendant.',
  )
  process.exit(failed ? 1 : 0)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(2)
})
