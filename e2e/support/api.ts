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
