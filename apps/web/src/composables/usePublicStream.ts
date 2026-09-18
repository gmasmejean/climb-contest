import type { PublicStreamEvent } from '@climbcontest/contracts'

/**
 * Repli sondage (ROADMAP.md Lot 7 : « toutes les 30 s si SSE échoue »).
 */
const DEFAULT_POLL_INTERVAL_MS = 30_000

/**
 * Même formule que `packages/sync/src/backoff.ts` (full jitter, ADR-037) —
 * réimplantée ici plutôt qu'importée : ce paquet reste ciblé sur la file
 * IndexedDB du juge, `apps/web` ne doit pas en dépendre pour un composable
 * public sans rapport avec le hors-ligne (ADR-012 : le public passe par
 * TanStack Query, pas par `packages/sync`).
 */
function computeBackoffDelayMs(attempt: number, random: () => number, baseMs = 1000, capMs = 30_000): number {
  return Math.floor(random() * Math.min(capMs, baseMs * 2 ** attempt))
}

export type PublicStreamConnectionState = 'connecting' | 'open' | 'reconnecting'

export interface UsePublicStreamOptions {
  /** Injectable pour les tests — par défaut, un vrai `EventSource` du navigateur. */
  createEventSource?: (url: string) => EventSource
  pollIntervalMs?: number
  random?: () => number
  setTimeoutFn?: typeof setTimeout
  clearTimeoutFn?: typeof clearTimeout
  setIntervalFn?: typeof setInterval
  clearIntervalFn?: typeof clearInterval
}

export interface PublicStreamHandlers {
  /** Un événement métier (`ranking_updated`/`round_status_changed`/`route_updated`) — jamais `ping`. */
  onEvent: (event: PublicStreamEvent) => void
  onStateChange?: (state: PublicStreamConnectionState) => void
  /** Appelé sur `ping` ET sur chaque événement métier — sert à l'indicateur « dernière mise à jour ». */
  onHeartbeat?: () => void
  /**
   * Repli en sondage (toutes les `pollIntervalMs`, tant que le flux n'est
   * pas ouvert) : rejoue le MÊME chemin de récupération que le
   * chargement initial, sans connaître la catégorie affichée — c'est au
   * composant appelant de relire son état courant, pas à ce composable de
   * fabriquer un faux événement.
   */
  onPoll?: () => void
}

export interface PublicStream {
  start(): void
  stop(): void
}

const BUSINESS_EVENT_TYPES = ['ranking_updated', 'round_status_changed', 'route_updated'] as const

/**
 * Ouvre le flux SSE `GET /public/:slug/stream`, avec reconnexion à repli
 * exponentiel (ADR-037 : les événements explicites — ici la fin d'un
 * repli — réinitialisent le compteur, jamais un flush périodique interne)
 * et un repli en sondage pendant toute période où le flux n'est pas
 * ouvert. Ne s'abonne pas lui-même à `onMounted`/`onUnmounted` — le
 * composant appelant pilote `start()`/`stop()`, ce qui rend ce composable
 * testable sans monter de composant Vue.
 */
export function usePublicStream(
  slug: string,
  handlers: PublicStreamHandlers,
  options: UsePublicStreamOptions = {},
): PublicStream {
  const createEventSource = options.createEventSource ?? ((url: string) => new EventSource(url))
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const random = options.random ?? Math.random
  const scheduleTimeout = options.setTimeoutFn ?? setTimeout
  const cancelTimeout = options.clearTimeoutFn ?? clearTimeout
  const scheduleInterval = options.setIntervalFn ?? setInterval
  const cancelInterval = options.clearIntervalFn ?? clearInterval

  let source: EventSource | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let attempt = 0
  let stopped = true

  function setState(state: PublicStreamConnectionState): void {
    handlers.onStateChange?.(state)
  }

  function ensurePolling(): void {
    if (pollTimer !== null) return
    pollTimer = scheduleInterval(() => {
      handlers.onPoll?.()
    }, pollIntervalMs)
  }

  function stopPolling(): void {
    if (pollTimer === null) return
    cancelInterval(pollTimer)
    pollTimer = null
  }

  function closeSource(): void {
    if (!source) return
    source.close()
    source = null
  }

  function scheduleReconnect(): void {
    if (stopped) return
    setState('reconnecting')
    ensurePolling()
    if (reconnectTimer !== null) return
    const delayMs = computeBackoffDelayMs(attempt, random)
    attempt += 1
    reconnectTimer = scheduleTimeout(() => {
      reconnectTimer = null
      connect()
    }, delayMs)
  }

  function connect(): void {
    if (stopped) return
    closeSource()
    setState(attempt === 0 ? 'connecting' : 'reconnecting')

    const url = `/api/v1/public/${encodeURIComponent(slug)}/stream`
    const es = createEventSource(url)
    source = es

    es.addEventListener('open', () => {
      attempt = 0
      stopPolling()
      setState('open')
    })
    es.addEventListener('error', () => {
      if (stopped) return
      closeSource()
      scheduleReconnect()
    })
    es.addEventListener('ping', () => {
      handlers.onHeartbeat?.()
    })
    for (const type of BUSINESS_EVENT_TYPES) {
      es.addEventListener(type, (rawEvent) => {
        const messageEvent = rawEvent as MessageEvent<string>
        handlers.onHeartbeat?.()
        try {
          handlers.onEvent(JSON.parse(messageEvent.data) as PublicStreamEvent)
        } catch {
          // Payload illisible : ignoré, jamais une exception qui casserait
          // le flux pour un seul message malformé.
        }
      })
    }
  }

  function forceReconnectNow(): void {
    if (stopped) return
    attempt = 0
    if (reconnectTimer !== null) {
      cancelTimeout(reconnectTimer)
      reconnectTimer = null
    }
    connect()
  }

  function onOnline(): void {
    forceReconnectNow()
  }
  function onVisibilityChange(): void {
    if (document.visibilityState === 'visible') forceReconnectNow()
  }

  return {
    start() {
      if (!stopped) return
      stopped = false
      attempt = 0
      connect()
      window.addEventListener('online', onOnline)
      document.addEventListener('visibilitychange', onVisibilityChange)
    },
    stop() {
      if (stopped) return
      stopped = true
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      if (reconnectTimer !== null) cancelTimeout(reconnectTimer)
      reconnectTimer = null
      stopPolling()
      closeSource()
    },
  }
}
