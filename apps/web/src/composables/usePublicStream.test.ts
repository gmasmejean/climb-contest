import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { usePublicStream } from './usePublicStream'

type Listener = (event: { data: string | undefined }) => void

class FakeEventSource {
  static instances: FakeEventSource[] = []
  listeners = new Map<string, Listener[]>()
  closed = false

  constructor(public url: string) {
    FakeEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type) ?? []
    list.push(listener)
    this.listeners.set(type, list)
  }

  close(): void {
    this.closed = true
  }

  dispatch(type: string, data?: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ data })
  }
}

function lastInstance(): FakeEventSource {
  const instance = FakeEventSource.instances.at(-1)
  if (!instance) throw new Error('Aucune instance FakeEventSource créée.')
  return instance
}

describe('usePublicStream', () => {
  beforeEach(() => {
    FakeEventSource.instances = []
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('ouvre une connexion vers le bon slug au démarrage', () => {
    const onEvent = vi.fn()
    const stream = usePublicStream(
      'abc123',
      { onEvent },
      { createEventSource: (url) => new FakeEventSource(url) as unknown as EventSource },
    )
    stream.start()

    expect(FakeEventSource.instances).toHaveLength(1)
    expect(lastInstance().url).toBe('/api/v1/public/abc123/stream')
    stream.stop()
  })

  it('passe à « open » et remet le compteur de reprise à zéro quand la connexion s’ouvre', () => {
    const onStateChange = vi.fn()
    const stream = usePublicStream(
      'abc123',
      { onEvent: vi.fn(), onStateChange },
      { createEventSource: (url) => new FakeEventSource(url) as unknown as EventSource },
    )
    stream.start()
    expect(onStateChange).toHaveBeenCalledWith('connecting')

    lastInstance().dispatch('open')
    expect(onStateChange).toHaveBeenCalledWith('open')
    stream.stop()
  })

  it('transmet un événement métier reçu et déclenche le battement de cœur', () => {
    const onEvent = vi.fn()
    const onHeartbeat = vi.fn()
    const stream = usePublicStream(
      'abc123',
      { onEvent, onHeartbeat },
      { createEventSource: (url) => new FakeEventSource(url) as unknown as EventSource },
    )
    stream.start()

    const payload = { type: 'ranking_updated', competitionId: 'comp-1', categoryId: 'cat-1' }
    lastInstance().dispatch('ranking_updated', JSON.stringify(payload))

    expect(onEvent).toHaveBeenCalledWith(payload)
    expect(onHeartbeat).toHaveBeenCalledTimes(1)
    stream.stop()
  })

  it('un ping déclenche le battement de cœur mais jamais onEvent', () => {
    const onEvent = vi.fn()
    const onHeartbeat = vi.fn()
    const stream = usePublicStream(
      'abc123',
      { onEvent, onHeartbeat },
      { createEventSource: (url) => new FakeEventSource(url) as unknown as EventSource },
    )
    stream.start()

    lastInstance().dispatch('ping')

    expect(onHeartbeat).toHaveBeenCalledTimes(1)
    expect(onEvent).not.toHaveBeenCalled()
    stream.stop()
  })

  it("bascule sur le sondage à l'erreur, puis rouvre une connexion après le délai de repli", () => {
    const onEvent = vi.fn()
    const onPoll = vi.fn()
    const onStateChange = vi.fn()
    const stream = usePublicStream(
      'abc123',
      { onEvent, onPoll, onStateChange },
      {
        createEventSource: (url) => new FakeEventSource(url) as unknown as EventSource,
        random: () => 0.5, // délai déterministe
        pollIntervalMs: 1000,
      },
    )
    stream.start()
    const first = lastInstance()

    first.dispatch('error')
    expect(first.closed).toBe(true)
    expect(onStateChange).toHaveBeenCalledWith('reconnecting')

    // Sondage actif tant que la connexion n'est pas rétablie.
    vi.advanceTimersByTime(1000)
    expect(onPoll).toHaveBeenCalledTimes(1)

    // random()=0.5, base=1000ms, tentative 0 -> délai = 500ms, déjà dépassé
    // par l'avance de 1000ms ci-dessus : une deuxième connexion a dû s'ouvrir.
    expect(FakeEventSource.instances).toHaveLength(2)
    stream.stop()
  })

  it('« online » force une reconnexion immédiate sans attendre le délai de repli programmé', () => {
    const stream = usePublicStream(
      'abc123',
      { onEvent: vi.fn() },
      {
        createEventSource: (url) => new FakeEventSource(url) as unknown as EventSource,
        random: () => 0.99,
      },
    )
    stream.start()
    lastInstance().dispatch('error')
    expect(FakeEventSource.instances).toHaveLength(1)

    window.dispatchEvent(new Event('online'))
    expect(FakeEventSource.instances).toHaveLength(2)
    stream.stop()
  })

  it('stop() ferme la connexion et empêche toute reconnexion ultérieure', () => {
    const stream = usePublicStream(
      'abc123',
      { onEvent: vi.fn() },
      {
        createEventSource: (url) => new FakeEventSource(url) as unknown as EventSource,
      },
    )
    stream.start()
    const first = lastInstance()
    stream.stop()

    expect(first.closed).toBe(true)
    first.dispatch('error')
    vi.advanceTimersByTime(60_000)
    expect(FakeEventSource.instances).toHaveLength(1)
  })

  describe('chien de garde (mode dégradé)', () => {
    const factory = {
      createEventSource: (url: string) => new FakeEventSource(url) as unknown as EventSource,
    }

    it('une connexion silencieuse depuis plus de 65 s est déclarée morte : « reconnexion » et nouvelle tentative', () => {
      const onStateChange = vi.fn()
      const stream = usePublicStream(
        'abc',
        { onEvent: vi.fn(), onStateChange },
        { ...factory, random: () => 0.5 },
      )
      stream.start()
      lastInstance().dispatch('open')
      expect(onStateChange).toHaveBeenLastCalledWith('open')

      vi.advanceTimersByTime(60_000)
      expect(onStateChange).toHaveBeenLastCalledWith('open')

      vi.advanceTimersByTime(10_000)
      expect(onStateChange).toHaveBeenLastCalledWith('reconnecting')
      expect(FakeEventSource.instances[0]?.closed).toBe(true)

      vi.advanceTimersByTime(2_000)
      expect(FakeEventSource.instances).toHaveLength(2)
      stream.stop()
    })

    it('un ping remet le compteur à zéro : une connexion qui vit n’est jamais déclarée morte', () => {
      const onStateChange = vi.fn()
      const stream = usePublicStream('abc', { onEvent: vi.fn(), onStateChange }, factory)
      stream.start()
      lastInstance().dispatch('open')

      for (let i = 0; i < 6; i += 1) {
        vi.advanceTimersByTime(25_000)
        lastInstance().dispatch('ping')
      }

      expect(onStateChange).not.toHaveBeenCalledWith('reconnecting')
      expect(FakeEventSource.instances).toHaveLength(1)
      stream.stop()
    })

    it('un événement métier compte aussi comme un signe de vie', () => {
      const onStateChange = vi.fn()
      const stream = usePublicStream('abc', { onEvent: vi.fn(), onStateChange }, factory)
      stream.start()
      lastInstance().dispatch('open')

      vi.advanceTimersByTime(60_000)
      lastInstance().dispatch(
        'ranking_updated',
        JSON.stringify({ type: 'ranking_updated', competitionId: 'c', categoryId: 'k' }),
      )
      vi.advanceTimersByTime(60_000)

      expect(onStateChange).not.toHaveBeenCalledWith('reconnecting')
      stream.stop()
    })

    it('« offline » du navigateur passe tout de suite en reconnexion, sans attendre le chien de garde', () => {
      const onStateChange = vi.fn()
      const stream = usePublicStream('abc', { onEvent: vi.fn(), onStateChange }, factory)
      stream.start()
      lastInstance().dispatch('open')

      window.dispatchEvent(new Event('offline'))

      expect(onStateChange).toHaveBeenLastCalledWith('reconnecting')
      expect(FakeEventSource.instances[0]?.closed).toBe(true)
      stream.stop()
    })

    it('repasse à « open » quand la connexion revient', () => {
      const onStateChange = vi.fn()
      const stream = usePublicStream('abc', { onEvent: vi.fn(), onStateChange }, factory)
      stream.start()
      lastInstance().dispatch('open')
      window.dispatchEvent(new Event('offline'))

      window.dispatchEvent(new Event('online'))
      lastInstance().dispatch('open')

      expect(onStateChange).toHaveBeenLastCalledWith('open')
      stream.stop()
    })

    it('stop() arrête le chien de garde : aucune reconnexion après l’arrêt', () => {
      const onStateChange = vi.fn()
      const stream = usePublicStream('abc', { onEvent: vi.fn(), onStateChange }, factory)
      stream.start()
      lastInstance().dispatch('open')
      stream.stop()

      vi.advanceTimersByTime(300_000)

      expect(FakeEventSource.instances).toHaveLength(1)
      expect(onStateChange).not.toHaveBeenCalledWith('reconnecting')
    })
  })
})
