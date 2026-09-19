import { describe, expect, it, vi } from 'vitest'

import {
  BASE_DELAY_MS,
  MAX_ATTEMPTS,
  UploadInterruptedError,
  UploadRefusedError,
  abandonUpload,
  uploadVideo,
  type UploadDeps,
  type UploadParams,
  type UploadStore,
} from './video-upload'

const CHUNK = 1000
const ROUTE = 'route-1'
const COMPETITION = 'comp-1'

function fakeFile(size: number, name = 'video.mp4'): UploadParams['file'] & { bytes: Uint8Array } {
  const bytes = new Uint8Array(size).map((_, i) => i % 251)
  return {
    name,
    size,
    type: 'video/mp4',
    lastModified: 1,
    bytes,
    slice: (start, end) => new Blob([bytes.slice(start, end)]),
  }
}

function memoryStore(
  initial: Record<string, string> = {},
): UploadStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial))
  return {
    data,
    get: (key) => data.get(key) ?? null,
    set: (key, value) => void data.set(key, value),
    remove: (key) => void data.delete(key),
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** Un serveur en mémoire qui parle le protocole de `routes/route-video.ts`. */
function fakeServer(
  options: { declared?: number; refuseCreate?: Response; refuseComplete?: Response } = {},
) {
  let received = new Uint8Array(0)
  let declared = options.declared ?? 0
  const state = {
    created: 0,
    patches: [] as { offset: number; length: number }[],
    completed: 0,
    sessionGone: false,
    /** Fait échouer les PATCH suivants avec ce que renvoie la fonction (undefined = laisse passer). */
    interfere: (_call: number): Response | 'network' | undefined => undefined,
    /** Applique le PATCH puis perd la réponse (le client ne voit qu'une coupure). */
    loseResponseAfterApply: (_call: number) => false,
    patchCalls: 0,
  }

  const dto = (status = 'uploading') => ({
    uploadId: 'up-1',
    status,
    declaredSizeBytes: declared,
    receivedBytes: received.byteLength,
    chunkSize: CHUNK,
    maxBytes: 1_000_000,
  })

  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    const method = init.method ?? 'GET'
    if (method === 'POST' && path.endsWith('/uploads')) {
      if (options.refuseCreate) return options.refuseCreate.clone()
      state.created += 1
      declared = (JSON.parse(init.body as string) as { sizeBytes: number }).sizeBytes
      received = new Uint8Array(0)
      return json(dto(), 201)
    }
    if (method === 'GET' && path.endsWith('/up-1')) {
      return state.sessionGone ? json({ title: 'Envoi introuvable' }, 404) : json(dto())
    }
    if (method === 'PATCH') {
      state.patchCalls += 1
      const interference = state.interfere(state.patchCalls)
      if (interference === 'network') throw new TypeError('Failed to fetch')
      if (interference) return interference.clone()

      const offset = Number((init.headers as Record<string, string>)['Upload-Offset'])
      const body = new Uint8Array(await (init.body as Blob).arrayBuffer())
      if (offset !== received.byteLength) {
        return json({ title: 'Reprise', expectedOffset: received.byteLength }, 409)
      }
      state.patches.push({ offset, length: body.byteLength })
      received = new Uint8Array([...received, ...body])
      if (state.loseResponseAfterApply(state.patchCalls)) throw new TypeError('Failed to fetch')
      return json(dto())
    }
    if (method === 'POST' && path.endsWith('/complete')) {
      if (options.refuseComplete) return options.refuseComplete.clone()
      state.completed += 1
      return json({ assetId: 'asset-1', mimeType: 'video/mp4', sizeBytes: declared }, 201)
    }
    if (method === 'DELETE') return new Response(null, { status: 204 })
    throw new Error(`Requête inattendue : ${method} ${path}`)
  }

  return { state, request, receivedBytes: () => received }
}

function setUp(server: ReturnType<typeof fakeServer>, store = memoryStore()) {
  const sleeps: number[] = []
  const deps: UploadDeps = {
    request: server.request,
    store,
    sleep: (ms) => {
      sleeps.push(ms)
      return Promise.resolve()
    },
  }
  return { deps, store, sleeps }
}

const params = (file: UploadParams['file'], extra: Partial<UploadParams> = {}): UploadParams => ({
  file,
  competitionId: COMPETITION,
  routeId: ROUTE,
  ...extra,
})

describe('uploadVideo', () => {
  it('envoie en morceaux, termine, oublie l’envoi et rapporte la progression', async () => {
    const file = fakeFile(2500)
    const server = fakeServer()
    const { deps, store } = setUp(server)
    const progress: number[] = []

    const asset = await uploadVideo(
      deps,
      params(file, { onProgress: (sent) => progress.push(sent) }),
    )

    expect(asset.assetId).toBe('asset-1')
    expect(server.receivedBytes()).toEqual(file.bytes)
    expect(server.state.patches.map((p) => p.length)).toEqual([1000, 1000, 500])
    expect(progress).toEqual([0, 1000, 2000, 2500])
    expect(store.data.size).toBe(0)
  })

  it('un fichier plus petit qu’un morceau part en un seul envoi', async () => {
    const server = fakeServer()
    const { deps } = setUp(server)
    await uploadVideo(deps, params(fakeFile(300)))
    expect(server.state.patches).toEqual([{ offset: 0, length: 300 }])
  })

  it('se remet d’une coupure réseau en réessayant après une attente', async () => {
    const file = fakeFile(2500)
    const server = fakeServer()
    server.state.interfere = (call) => (call === 2 ? 'network' : undefined)
    const { deps, sleeps } = setUp(server)

    await uploadVideo(deps, params(file))

    expect(server.receivedBytes()).toEqual(file.bytes)
    expect(sleeps).toEqual([BASE_DELAY_MS])
  })

  it('espace ses essais de façon exponentielle sur des erreurs serveur, et finit par réussir', async () => {
    const file = fakeFile(500)
    const server = fakeServer()
    server.state.interfere = (call) =>
      call <= 3 ? json({ title: 'Indisponible' }, 503) : undefined
    const { deps, sleeps } = setUp(server)

    await uploadVideo(deps, params(file))

    expect(sleeps).toEqual([1000, 2000, 4000])
    expect(server.receivedBytes()).toEqual(file.bytes)
  })

  it('retente aussi un 429 (trop de requêtes)', async () => {
    const server = fakeServer()
    server.state.interfere = (call) =>
      call === 1 ? json({ title: 'Trop de requêtes' }, 429) : undefined
    const { deps, sleeps } = setUp(server)
    await uploadVideo(deps, params(fakeFile(200)))
    expect(sleeps).toEqual([1000])
  })

  it('le repli exponentiel est plafonné', async () => {
    const server = fakeServer()
    server.state.interfere = (call) => (call < MAX_ATTEMPTS ? 'network' : undefined)
    const { deps, sleeps } = setUp(server)
    await uploadVideo(deps, params(fakeFile(200)))
    expect(Math.max(...sleeps)).toBeLessThanOrEqual(30_000)
    expect(sleeps).toHaveLength(MAX_ATTEMPTS - 1)
  })

  it('abandonne après trop d’échecs, garde l’envoi pour la reprise, et n’a envoyé aucun octet en double à la reprise', async () => {
    const file = fakeFile(3000)
    const server = fakeServer()
    // Le premier morceau passe, puis le réseau tombe pour de bon.
    server.state.interfere = (call) => (call >= 2 ? 'network' : undefined)
    const store = memoryStore()
    const first = setUp(server, store)

    await expect(uploadVideo(first.deps, params(file))).rejects.toBeInstanceOf(
      UploadInterruptedError,
    )
    expect(store.data.size).toBe(1)
    expect(server.receivedBytes().byteLength).toBe(1000)

    // Le réseau revient : on re-sélectionne le même fichier.
    server.state.interfere = () => undefined
    server.state.patches.length = 0
    const second = setUp(server, store)
    await uploadVideo(second.deps, params(file))

    expect(server.state.created).toBe(1)
    expect(server.receivedBytes()).toEqual(file.bytes)
    // Reprise à l'octet 1000 : le premier morceau n'est pas renvoyé.
    expect(server.state.patches.map((p) => p.offset)).toEqual([1000, 2000])
  })

  it('se recale quand la réponse d’un morceau s’est perdue (le serveur l’avait reçu)', async () => {
    const file = fakeFile(2500)
    const server = fakeServer()
    server.state.loseResponseAfterApply = (call) => call === 1
    const { deps } = setUp(server)

    await uploadVideo(deps, params(file))

    // Le morceau 1 est rejoué, le serveur répond 409 + son offset, le client
    // repart de 1000 — le contenu final est intact.
    expect(server.receivedBytes()).toEqual(file.bytes)
    expect(server.state.patches.map((p) => p.offset)).toEqual([0, 1000, 2000])
  })

  it('refuse sans réessayer quand le serveur refuse le fichier à la création', async () => {
    const server = fakeServer({
      refuseCreate: json(
        {
          title: 'Vidéo trop volumineuse',
          detail: 'Cette vidéo pèse 300 Mo, la limite est de 200 Mo.',
        },
        413,
      ),
    })
    const { deps, sleeps, store } = setUp(server)

    const error = await uploadVideo(deps, params(fakeFile(500))).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(UploadRefusedError)
    expect((error as UploadRefusedError).message).toContain('la limite est de 200 Mo')
    expect((error as UploadRefusedError).status).toBe(413)
    expect(sleeps).toEqual([])
    expect(store.data.size).toBe(0)
  })

  it('refuse sans réessayer un morceau rejeté (4xx), et oublie l’envoi', async () => {
    const server = fakeServer()
    server.state.interfere = () =>
      json({ title: 'Trop d’octets', detail: 'Ce morceau dépasse la taille annoncée.' }, 400)
    const { deps, sleeps, store } = setUp(server)

    await expect(uploadVideo(deps, params(fakeFile(500)))).rejects.toThrow(
      'dépasse la taille annoncée',
    )
    expect(sleeps).toEqual([])
    expect(store.data.size).toBe(0)
  })

  it('un format refusé à la fin est une erreur définitive, avec le message du serveur', async () => {
    const server = fakeServer({
      refuseComplete: json(
        { title: 'Format non accepté', detail: 'Ce fichier n’est pas une vidéo reconnue.' },
        400,
      ),
    })
    const { deps, store } = setUp(server)

    await expect(uploadVideo(deps, params(fakeFile(500)))).rejects.toThrow('pas une vidéo reconnue')
    expect(store.data.size).toBe(0)
  })

  it('un 409 sans offset attendu est une erreur définitive', async () => {
    const server = fakeServer()
    server.state.interfere = () =>
      json({ title: 'Envoi terminé', detail: 'Cet envoi est déjà terminé.' }, 409)
    const { deps } = setUp(server)
    await expect(uploadVideo(deps, params(fakeFile(500)))).rejects.toThrow('déjà terminé')
  })

  it('ouvre un nouvel envoi quand celui gardé n’existe plus côté serveur', async () => {
    const file = fakeFile(500)
    const server = fakeServer()
    server.state.sessionGone = true
    const store = memoryStore()
    store.set(
      `climbcontest.video-upload.${ROUTE}.${file.name}.${file.size}.${file.lastModified}`,
      'up-1',
    )
    const { deps } = setUp(server, store)

    await uploadVideo(deps, params(file))

    expect(server.state.created).toBe(1)
    expect(server.receivedBytes()).toEqual(file.bytes)
  })

  it('ne reprend pas un envoi dont la taille annoncée diffère du fichier', async () => {
    const file = fakeFile(500)
    const server = fakeServer({ declared: 9999 })
    const store = memoryStore()
    store.set(
      `climbcontest.video-upload.${ROUTE}.${file.name}.${file.size}.${file.lastModified}`,
      'up-1',
    )
    const { deps } = setUp(server, store)

    await uploadVideo(deps, params(file))

    expect(server.state.created).toBe(1)
  })

  it('une annulation interrompt l’envoi sans le marquer comme échoué', async () => {
    const controller = new AbortController()
    const server = fakeServer()
    server.state.interfere = () => {
      controller.abort()
      return 'network'
    }
    const { deps } = setUp(server)

    const error = await uploadVideo(
      deps,
      params(fakeFile(2500), { signal: controller.signal }),
    ).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(DOMException)
    expect((error as DOMException).name).toBe('AbortError')
  })
})

describe('abandonUpload', () => {
  it('demande au serveur d’abandonner et oublie l’identifiant local', async () => {
    const file = fakeFile(500)
    const request = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    const store = memoryStore({
      [`climbcontest.video-upload.${ROUTE}.${file.name}.${file.size}.${file.lastModified}`]: 'up-1',
    })

    await abandonUpload(request, store, { file, competitionId: COMPETITION, routeId: ROUTE })

    expect(request).toHaveBeenCalledWith(
      `/competitions/${COMPETITION}/routes/${ROUTE}/video/uploads/up-1`,
      { method: 'DELETE' },
    )
    expect(store.data.size).toBe(0)
  })

  it('ne fait rien s’il n’y a aucun envoi connu, et n’échoue pas si le réseau est coupé', async () => {
    const file = fakeFile(500)
    const request = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))

    await abandonUpload(request, memoryStore(), {
      file,
      competitionId: COMPETITION,
      routeId: ROUTE,
    })
    expect(request).not.toHaveBeenCalled()

    const store = memoryStore({
      [`climbcontest.video-upload.${ROUTE}.${file.name}.${file.size}.${file.lastModified}`]: 'up-1',
    })
    await expect(
      abandonUpload(request, store, { file, competitionId: COMPETITION, routeId: ROUTE }),
    ).resolves.toBeUndefined()
  })
})
