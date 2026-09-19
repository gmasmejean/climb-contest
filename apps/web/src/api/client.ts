import type { AuthResponse } from '@climbcontest/contracts'

import { accessToken, clearSession, setSession } from './session'

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly title: string,
    public readonly detail?: string,
  ) {
    super(detail ?? title)
  }
}

interface ProblemBody {
  title: string
  detail?: string
}

let refreshPromise: Promise<boolean> | null = null

async function refreshSession(): Promise<boolean> {
  const response = await fetch('/api/v1/auth/refresh', {
    method: 'POST',
    credentials: 'include',
  })
  if (!response.ok) {
    clearSession()
    return false
  }
  const body = (await response.json()) as AuthResponse
  setSession(body.accessToken, body.user)
  return true
}

/** Tente de restaurer la session depuis le cookie de refresh (au démarrage). */
export async function bootstrapSession(): Promise<boolean> {
  refreshPromise ??= refreshSession().finally(() => {
    refreshPromise = null
  })
  return refreshPromise
}

/**
 * `extraOkStatuses` : certaines routes (l'aperçu/import CSV compétiteurs,
 * `apps/api/src/routes/competitors.ts`) répondent un corps structuré
 * exploitable par l'écran même sur un statut non-2xx (422 « rapport
 * d'import invalide », pas une erreur générique problem+json) — ces
 * statuts sont alors traités comme un succès et leur corps est renvoyé
 * normalement plutôt que jeté comme `ApiError`.
 */
export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  allowRetry = true,
  extraOkStatuses: number[] = [],
): Promise<T> {
  const headers = new Headers(options.headers)
  headers.set('Content-Type', 'application/json')
  if (accessToken.value) {
    headers.set('Authorization', `Bearer ${accessToken.value}`)
  }

  const response = await fetch(`/api/v1${path}`, {
    ...options,
    headers,
    credentials: 'include',
  })

  if (response.status === 401 && allowRetry) {
    const refreshed = await refreshSession()
    if (refreshed) {
      return apiFetch<T>(path, options, false, extraOkStatuses)
    }
  }

  if (!response.ok && !extraOkStatuses.includes(response.status)) {
    let body: ProblemBody | undefined
    try {
      body = (await response.json()) as ProblemBody
    } catch {
      body = undefined
    }
    throw new ApiError(response.status, body?.title ?? 'Erreur', body?.detail)
  }

  if (response.status === 204) {
    return undefined as T
  }
  return (await response.json()) as T
}

/** Nom de fichier proposé par le serveur (`Content-Disposition: attachment; filename="…"`). */
function filenameFrom(response: Response, fallback: string): string {
  const header = response.headers.get('content-disposition') ?? ''
  return /filename="([^"]+)"/.exec(header)?.[1] ?? fallback
}

/**
 * `fetch` authentifié qui renvoie la réponse brute (ni corps JSON ni erreur
 * levée) : pour ce qui n'est pas du JSON — téléchargements, envoi d'octets.
 * Même reprise sur 401 que `apiFetch` : le jeton d'accès dure 15 minutes, un
 * envoi de vidéo plus long doit le renouveler en cours de route.
 */
export async function apiRawFetch(
  path: string,
  init: RequestInit = {},
  allowRetry = true,
): Promise<Response> {
  const headers = new Headers(init.headers)
  if (accessToken.value) headers.set('Authorization', `Bearer ${accessToken.value}`)
  const response = await fetch(`/api/v1${path}`, { ...init, headers, credentials: 'include' })
  if (response.status === 401 && allowRetry && (await refreshSession())) {
    return apiRawFetch(path, init, false)
  }
  return response
}

/** Transforme une réponse d'erreur (problem+json) en `ApiError`. */
export async function errorFromResponse(response: Response): Promise<ApiError> {
  let body: ProblemBody | undefined
  try {
    body = (await response.json()) as ProblemBody
  } catch {
    body = undefined
  }
  return new ApiError(response.status, body?.title ?? 'Erreur', body?.detail)
}

/** Télécharge un fichier protégé par le jeton organisateur (exports, Lot 9). */
export async function apiDownload(
  path: string,
  fallbackFilename: string,
): Promise<{ blob: Blob; filename: string }> {
  const response = await apiRawFetch(path)
  if (!response.ok) throw await errorFromResponse(response)
  return { blob: await response.blob(), filename: filenameFrom(response, fallbackFilename) }
}

/** Déclenche l'enregistrement d'un contenu déjà en mémoire, sans quitter la page. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
