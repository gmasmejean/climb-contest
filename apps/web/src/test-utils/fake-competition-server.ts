import { vi } from 'vitest'

/**
 * Un serveur de compétitions en mémoire, branché sur `fetch`, qui rejoue le
 * contrat de `routes/competition-trash.ts` (Lot 11) : liste, corbeille,
 * restauration, suppression définitive, et le refus 409 d'une compétition
 * « En cours ». Les tests d'écran s'y branchent au lieu de deviner des réponses.
 */
export interface FakeCompetition {
  id: string
  name: string
  venue: string
  status: 'draft' | 'open' | 'running' | 'closed' | 'archived'
  startsOn: string
  endsOn: string
  purgedAt: string | null
  deletedAt: string | null
}

export function makeCompetition(
  overrides: Partial<FakeCompetition> & { id: string },
): FakeCompetition {
  return {
    name: 'Compétition',
    venue: 'Salle',
    status: 'closed',
    startsOn: '2026-01-01',
    endsOn: '2026-01-01',
    purgedAt: null,
    deletedAt: null,
    ...overrides,
  }
}

export interface FakeCompetitionServer {
  active: FakeCompetition[]
  trash: FakeCompetition[]
  /** `METHOD /chemin` de chaque appel reçu, dans l'ordre. */
  calls: string[]
  /** Ids pour lesquels le serveur répond une erreur, avec le corps problem+json voulu. */
  failing: Map<string, { status: number; title: string; detail: string }>
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

export function installFakeCompetitionServer(
  initial: FakeCompetition[],
  initialTrash: FakeCompetition[] = [],
): FakeCompetitionServer {
  const server: FakeCompetitionServer = {
    active: [...initial],
    trash: [...initialTrash],
    calls: [],
    failing: new Map(),
  }

  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const path = raw.replace(/^.*\/api\/v1/, '')
      const method = init?.method ?? 'GET'
      server.calls.push(`${method} ${path}`)

      if (method === 'GET' && path === '/competitions')
        return Promise.resolve(json(200, server.active))
      if (method === 'GET' && path === '/competitions/trash')
        return Promise.resolve(json(200, server.trash))

      const match = /^\/competitions\/([^/]+)(\/restore|\/permanent)?$/.exec(path)
      const id = match?.[1]
      const suffix = match?.[2]
      if (!id) return Promise.resolve(json(404, { title: 'Introuvable', detail: path }))

      const failure = server.failing.get(id)
      if (failure) return Promise.resolve(json(failure.status, failure))

      if (method === 'DELETE' && suffix === undefined) {
        const found = server.active.find((c) => c.id === id)
        if (!found) return Promise.resolve(json(404, { title: 'Compétition introuvable' }))
        server.active = server.active.filter((c) => c.id !== id)
        const moved = { ...found, deletedAt: new Date().toISOString() }
        server.trash = [moved, ...server.trash]
        return Promise.resolve(json(200, moved))
      }
      if (method === 'POST' && suffix === '/restore') {
        const found = server.trash.find((c) => c.id === id)
        if (!found) return Promise.resolve(json(404, { title: 'Compétition introuvable' }))
        server.trash = server.trash.filter((c) => c.id !== id)
        const restored = { ...found, deletedAt: null }
        server.active = [...server.active, restored]
        return Promise.resolve(json(200, restored))
      }
      if (method === 'DELETE' && suffix === '/permanent') {
        server.trash = server.trash.filter((c) => c.id !== id)
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      return Promise.resolve(json(404, { title: 'Introuvable', detail: `${method} ${path}` }))
    }),
  )
  return server
}

/** Laisse les promesses et le rendu se résoudre (requêtes simulées, mises à jour de la liste). */
export async function flush(times = 3): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}
