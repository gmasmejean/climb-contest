import type { APIRequestContext } from '@playwright/test'

const MAILPIT_URL = process.env['E2E_MAILPIT_URL'] ?? 'http://localhost:8025'

export async function apiJson<T>(
  request: APIRequestContext,
  url: string,
  init?: Parameters<APIRequestContext['fetch']>[1],
): Promise<T> {
  const response = await request.fetch(url, init)
  if (!response.ok()) {
    throw new Error(`${url} -> ${response.status()} ${await response.text()}`)
  }
  return response.json() as Promise<T>
}

/** Inscrit un organisateur neuf, vérifie son e-mail via Mailpit, renvoie ses identifiants. */
export async function registerAndVerifyOrganizer(request: APIRequestContext, label: string) {
  const stamp = Date.now()
  const email = `e2e-${label}-${stamp}@example.com`
  const password = 'un-mot-de-passe-solide'
  await apiJson(request, '/api/v1/auth/register', {
    method: 'POST',
    data: { email, password, displayName: `Orga ${label}`, clubName: `Club ${label} ${stamp}` },
  })
  const messages = await request.get(`${MAILPIT_URL}/api/v1/messages?limit=1`).then((r) => r.json())
  const messageId = messages.messages[0].ID as string
  const full = await request.get(`${MAILPIT_URL}/api/v1/message/${messageId}`).then((r) => r.json())
  const token = (full.Text as string).match(/token=(\S+)/)?.[1]
  await apiJson(request, '/api/v1/auth/verify-email', { method: 'POST', data: { token } })
  return { email, password }
}

export async function loginApi(request: APIRequestContext, email: string, password: string) {
  const { accessToken } = await apiJson<{ accessToken: string }>(request, '/api/v1/auth/login', {
    method: 'POST',
    data: { email, password },
  })
  return { accessToken, headers: { authorization: `Bearer ${accessToken}` } }
}

/**
 * Ouvre, pour toutes ses catégories, le round implicite d'un contest (ADR-023).
 * ADR-065 : le statut de compétition « En cours » n'ouvre plus rien ; chaque
 * catégorie s'ouvre par `round-status`, comme le fait l'écran Pilotage. Le round
 * n'est pas exposé en contest, on lit son identifiant sur le tableau de bord.
 * `base` = `/api/v1/competitions/<id>`.
 */
export async function openContestRound(
  request: APIRequestContext,
  headers: Record<string, string>,
  base: string,
): Promise<void> {
  const dashboard = await apiJson<{
    categories: { categoryId: string; routes: { roundId: string | null }[] }[]
  }>(request, `${base}/dashboard`, { headers })
  const categoriesByRound = new Map<string, Set<string>>()
  for (const cat of dashboard.categories) {
    for (const r of cat.routes) {
      if (!r.roundId) continue
      const set = categoriesByRound.get(r.roundId) ?? new Set<string>()
      set.add(cat.categoryId)
      categoriesByRound.set(r.roundId, set)
    }
  }
  if (categoriesByRound.size === 0) {
    throw new Error(`${base} : aucun tour à ouvrir (la voie est-elle affectée à une catégorie ?)`)
  }
  for (const [roundId, categoryIds] of categoriesByRound) {
    await apiJson(request, `${base}/round-status/${roundId}`, {
      method: 'POST',
      headers,
      data: { status: 'open', categoryIds: [...categoryIds] },
    })
  }
}
