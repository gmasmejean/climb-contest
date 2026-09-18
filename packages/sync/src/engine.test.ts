import { describe, expect, it } from 'vitest'

import { computeBackoffDelayMs } from './backoff'
import { SyncEngine } from './engine'
import { FakeClock } from './test-utils/fake-clock'
import { FakeTransport } from './test-utils/fake-transport'
import { InMemoryQueueStorage } from './test-utils/in-memory-storage'
import type { BatchResultItem, QueueItem, SyncTransport } from './types'

interface Payload {
  value: string
}

function createEngine(options: { clock?: FakeClock; maxBatchSize?: number } = {}) {
  const storage = new InMemoryQueueStorage<Payload>()
  const transport = new FakeTransport<Payload>()
  const engine = new SyncEngine<Payload>(storage, transport, {
    // jamais atteint dans ces tests : flush() est appelé explicitement
    debounceMs: 10_000,
    ...(options.clock ? { clock: options.clock } : {}),
    ...(options.maxBatchSize !== undefined ? { maxBatchSize: options.maxBatchSize } : {}),
  })
  return { storage, transport, engine }
}

function createControllableTransport<TPayload>(): {
  transport: SyncTransport<TPayload>
  resolveNext: (results: BatchResultItem[]) => void
  calls: QueueItem<TPayload>[][]
} {
  const calls: QueueItem<TPayload>[][] = []
  let resolveFn: ((results: BatchResultItem[]) => void) | null = null
  const transport: SyncTransport<TPayload> = {
    sendBatch: (items) => {
      calls.push(items)
      return new Promise((resolve) => {
        resolveFn = resolve
      })
    },
  }
  return {
    transport,
    calls,
    resolveNext: (results) => {
      const fn = resolveFn
      if (!fn) throw new Error('Aucun appel sendBatch en attente.')
      resolveFn = null
      fn(results)
    },
  }
}

describe('SyncEngine', () => {
  it('enqueue écrit en pending et le persiste AVANT tout appel réseau', async () => {
    const { storage, transport, engine } = createEngine()
    const item = await engine.enqueue('create', { value: 'a' }, 'id-1')

    expect(item.state).toBe('pending')
    expect(engine.snapshot()).toEqual([item])
    expect(await storage.getAll()).toEqual([item])
    expect(transport.calls.length).toBe(0)
  })

  it('flush() traite un accepted comme un succès et retire l’élément de la file', async () => {
    const { storage, engine } = createEngine()
    await engine.enqueue('create', { value: 'a' }, 'id-1')

    await engine.flush()

    expect(engine.snapshot()).toEqual([])
    expect(await storage.getAll()).toEqual([])
  })

  it('flush() traite un duplicate exactement comme un accepted (cas SPEC.md #21)', async () => {
    const { storage, transport, engine } = createEngine()
    transport.setFallback((items) => items.map((item) => ({ id: item.id, status: 'duplicate' })))
    await engine.enqueue('create', { value: 'a' }, 'id-1')

    await engine.flush()

    expect(engine.snapshot()).toEqual([])
    expect(await storage.getAll()).toEqual([])
  })

  it('un conflict reste visible avec les deux valeurs, jamais retiré (cas SPEC.md #22)', async () => {
    const { storage, transport, engine } = createEngine()
    transport.queueResults([
      {
        id: 'id-1',
        status: 'conflict',
        conflictGroup: 'group-1',
        existing: { value: 'x' },
        incoming: { value: 'a' },
      },
    ])
    await engine.enqueue('create', { value: 'a' }, 'id-1')

    await engine.flush()

    const [item] = engine.snapshot()
    expect(item?.state).toBe('conflict')
    expect(item?.conflict).toEqual({
      conflictGroup: 'group-1',
      existing: { value: 'x' },
      incoming: { value: 'a' },
    })
    expect(await storage.getAll()).toEqual([item])

    // Jamais retenté automatiquement : un second flush() ne renvoie rien.
    await engine.flush()
    expect(transport.calls.length).toBe(1)
  })

  it('un rejected reste visible avec le motif, jamais réessayé automatiquement', async () => {
    const { storage, transport, engine } = createEngine()
    transport.queueResults([{ id: 'id-1', status: 'rejected', reason: 'Tour fermé.' }])
    await engine.enqueue('create', { value: 'a' }, 'id-1')

    await engine.flush()

    const [item] = engine.snapshot()
    expect(item?.state).toBe('rejected')
    expect(item?.rejectedReason).toBe('Tour fermé.')
    expect(await storage.getAll()).toEqual([item])

    await engine.flush()
    expect(transport.calls.length).toBe(1)
  })

  it('dismissRejected retire un rejected mais ne touche jamais un autre état', async () => {
    const { storage, transport, engine } = createEngine()
    transport.queueResults([{ id: 'id-1', status: 'rejected', reason: 'Motif.' }])
    await engine.enqueue('create', { value: 'a' }, 'id-1')
    await engine.flush()

    await engine.dismissRejected('id-1')
    expect(engine.snapshot()).toEqual([])
    expect(await storage.getAll()).toEqual([])

    // Sur un id inconnu ou un état non-rejected : no-op silencieux.
    transport.setFallback((items) =>
      items.map((item) => ({
        id: item.id,
        status: 'conflict',
        conflictGroup: 'g',
        existing: null,
        incoming: null,
      })),
    )
    await engine.enqueue('create', { value: 'b' }, 'id-2')
    await engine.flush()
    await engine.dismissRejected('id-2')
    expect(engine.snapshot()).toHaveLength(1)
    expect(engine.snapshot()[0]?.state).toBe('conflict')
  })

  it('un échec transport remet tous les éléments sélectionnés en pending avec un backoff croissant', async () => {
    const clock = new FakeClock({ now: 1000, randomValues: [1] })
    const { storage, transport, engine } = createEngine({ clock })
    transport.queueFailure()
    await engine.enqueue('create', { value: 'a' }, 'id-1')

    await engine.flush()

    const [item] = engine.snapshot()
    expect(item?.state).toBe('pending')
    expect(item?.attempts).toBe(1)
    expect(item?.nextAttemptAt).toBe(1000 + computeBackoffDelayMs(1, clock))
    expect(await storage.getAll()).toEqual([item])

    // Pas encore dû : un flush() immédiat ne renvoie rien de plus.
    await engine.flush()
    expect(transport.calls.length).toBe(1)

    // Une fois le délai écoulé, l'élément repart.
    clock.advance(computeBackoffDelayMs(1, clock) + 1)
    await engine.flush()
    expect(transport.calls.length).toBe(2)
    expect(engine.snapshot()).toEqual([])
  })

  it('onOnline() force un réessai immédiat même si le délai de repli n’est pas écoulé', async () => {
    // Régression : sans ce comportement, un élément dont le dernier essai a
    // essuyé un long backoff (jusqu'à 30 s) reste bloqué en `pending` après
    // un retour réseau explicite, alors que SPEC.md § 6.3 exige une reprise
    // automatique immédiate à cet instant précis.
    const clock = new FakeClock({ now: 1000, randomValues: [1] })
    const { storage, transport, engine } = createEngine({ clock })
    transport.queueFailure()
    await engine.enqueue('create', { value: 'a' }, 'id-1')
    await engine.flush()

    const [pending] = engine.snapshot()
    expect(pending?.nextAttemptAt).toBeGreaterThan(clock.now())

    // Le délai n'est PAS écoulé — seulement quelques secondes plus tard.
    clock.advance(500)
    engine.onOnline()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(transport.calls).toHaveLength(2)
    expect(engine.snapshot()).toEqual([])
    expect(await storage.getAll()).toEqual([])
  })

  it('un élément absent de la réponse serveur est traité comme un échec transport, jamais abandonné', async () => {
    const { storage, transport, engine } = createEngine()
    transport.queueResults([]) // le serveur ne dit rien de "id-1"
    await engine.enqueue('create', { value: 'a' }, 'id-1')

    await engine.flush()

    const [item] = engine.snapshot()
    expect(item?.state).toBe('pending')
    expect(item?.attempts).toBe(1)
    expect(await storage.getAll()).toEqual([item])
  })

  it('le lot est plafonné à maxBatchSize, le reste part dans un appel suivant', async () => {
    const { transport, engine } = createEngine({ maxBatchSize: 2 })
    await engine.enqueue('create', { value: 'a' }, 'id-1')
    await engine.enqueue('create', { value: 'b' }, 'id-2')
    await engine.enqueue('create', { value: 'c' }, 'id-3')

    await engine.flush()

    expect(transport.calls).toHaveLength(2)
    expect(transport.calls[0]).toHaveLength(2)
    expect(transport.calls[1]).toHaveLength(1)
    expect(engine.snapshot()).toEqual([])
  })

  it('deux flush() concurrents ne doublent jamais un envoi', async () => {
    const storage = new InMemoryQueueStorage<Payload>()
    const { transport, resolveNext, calls } = createControllableTransport<Payload>()
    const engine = new SyncEngine<Payload>(storage, transport, { debounceMs: 10_000 })
    await engine.enqueue('create', { value: 'a' }, 'id-1')

    const flush1 = engine.flush()
    const flush2 = engine.flush()

    expect(calls).toHaveLength(1)

    resolveNext([{ id: 'id-1', status: 'accepted' }])
    await flush1
    await flush2

    expect(calls).toHaveLength(1)
    expect(engine.snapshot()).toEqual([])
    expect(await storage.getAll()).toEqual([])
  })

  it('hydrate() recharge la file persistée au démarrage (cas SPEC.md #23)', async () => {
    const storage = new InMemoryQueueStorage<Payload>()
    const seeded: QueueItem<Payload> = {
      id: 'id-1',
      kind: 'create',
      payload: { value: 'a' },
      state: 'pending',
      attempts: 0,
      nextAttemptAt: 0,
      createdAt: 0,
      updatedAt: 0,
    }
    await storage.put(seeded)

    const transport = new FakeTransport<Payload>()
    const engine = new SyncEngine<Payload>(storage, transport, { debounceMs: 10_000 })
    expect(engine.snapshot()).toEqual([]) // rien avant hydrate()

    await engine.hydrate()
    expect(engine.snapshot()).toEqual([seeded])

    await engine.flush()
    expect(transport.calls).toEqual([[{ ...seeded, state: 'sending' }]])
    expect(engine.snapshot()).toEqual([])
  })

  it('onStartup() hydrate puis vide la file éligible', async () => {
    const storage = new InMemoryQueueStorage<Payload>()
    await storage.put({
      id: 'id-1',
      kind: 'create',
      payload: { value: 'a' },
      state: 'pending',
      attempts: 0,
      nextAttemptAt: 0,
      createdAt: 0,
      updatedAt: 0,
    })
    const transport = new FakeTransport<Payload>()
    const engine = new SyncEngine<Payload>(storage, transport, { debounceMs: 10_000 })

    await engine.onStartup()

    expect(engine.snapshot()).toEqual([])
    expect(await storage.getAll()).toEqual([])
  })

  it('subscribe() reçoit l’état courant immédiatement puis à chaque changement', async () => {
    const { engine } = createEngine()
    const seen: number[] = []
    const unsubscribe = engine.subscribe((items) => seen.push(items.length))

    expect(seen).toEqual([0])
    await engine.enqueue('create', { value: 'a' }, 'id-1')
    expect(seen).toEqual([0, 1])

    await engine.flush()
    expect(seen.at(-1)).toBe(0)
    const countBeforeUnsubscribe = seen.length

    unsubscribe()
    await engine.enqueue('create', { value: 'b' }, 'id-2')
    expect(seen).toHaveLength(countBeforeUnsubscribe) // plus de notification après désabonnement
  })

  it('onOnline()/onVisible() déclenchent un flush sans attendre le debounce', async () => {
    const { transport, engine } = createEngine()
    await engine.enqueue('create', { value: 'a' }, 'id-1')
    expect(transport.calls).toHaveLength(0)

    engine.onOnline()
    await Promise.resolve()
    await Promise.resolve()

    expect(engine.snapshot()).toEqual([])
  })
})
