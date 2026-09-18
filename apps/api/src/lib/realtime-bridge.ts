import type { PublicStreamEvent } from '@climbcontest/contracts'
import { EventEmitter } from 'node:events'
import pg from 'pg'

import type { Logger } from './logger'

/**
 * Un seul canal pour toute l'instance (DECISIONS.md, Lot 7) : le payload
 * JSON porte déjà `competitionId`, inutile d'ouvrir un canal par
 * compétition. `LISTEN`/`NOTIFY` (ADR-014) plutôt qu'un `EventEmitter` seul
 * en mémoire : reste correct si l'API tourne un jour en plusieurs workers
 * (TODO.md), et double comme mécanisme d'invalidation de cache cross-process
 * gratuit (voir `app.ts`).
 */
export const PUBLIC_EVENTS_CHANNEL = 'climbcontest_public_events'

const ALL_EVENTS = Symbol('realtime-bridge:all-events')

export interface RealtimeBridge {
  /** Écoute les événements d'UNE compétition — c'est ce qu'utilise un flux SSE public. */
  subscribe(competitionId: string, listener: (event: PublicStreamEvent) => void): () => void
  /** Écoute TOUS les événements, toutes compétitions — réservé à l'invalidation de cache. */
  subscribeAll(listener: (event: PublicStreamEvent) => void): () => void
  close(): Promise<void>
}

/** Full jitter exponentiel — même formule que `packages/sync/src/backoff.ts` (ADR-037), réimplantée ici : l'API ne doit pas dépendre d'un paquet ciblé IndexedDB/client (ADR-014). */
export function computeBackoffDelayMs(attempt: number, base = 1000, cap = 30_000): number {
  return Math.floor(Math.random() * Math.min(cap, base * 2 ** attempt))
}

export interface RealtimeBridgeDeps {
  logger: Logger
}

export function createRealtimeBridge(databaseUrl: string, deps: RealtimeBridgeDeps): RealtimeBridge {
  const emitter = new EventEmitter()
  // Potentiellement des centaines d'abonnés (spectateurs SSE) : ce n'est
  // pas une fuite, c'est l'usage attendu (ROADMAP.md Lot 7, cible 300).
  emitter.setMaxListeners(0)

  let closed = false
  let currentClient: pg.Client | null = null
  let attempt = 0
  let reconnectTimer: NodeJS.Timeout | null = null

  function scheduleReconnect(): void {
    if (closed) return
    attempt += 1
    const delayMs = computeBackoffDelayMs(attempt)
    reconnectTimer = setTimeout(() => void connect(), delayMs)
    reconnectTimer.unref?.()
  }

  async function connect(): Promise<void> {
    if (closed) return
    const client = new pg.Client({
      connectionString: databaseUrl,
      // Nom stable pour qu'un test d'intégration puisse retrouver et couper
      // cette connexion précise (pg_stat_activity) afin d'exercer la
      // reconnexion sans dépendre d'un vrai redémarrage de Postgres.
      application_name: 'climbcontest-realtime-bridge',
    })
    currentClient = client

    client.on('notification', (msg) => {
      if (msg.channel !== PUBLIC_EVENTS_CHANNEL || !msg.payload) return
      let event: PublicStreamEvent
      try {
        event = JSON.parse(msg.payload) as PublicStreamEvent
      } catch {
        deps.logger.warn(`realtime-bridge: NOTIFY payload illisible: ${msg.payload}`)
        return
      }
      emitter.emit(event.competitionId, event)
      emitter.emit(ALL_EVENTS, event)
    })

    client.on('error', (error) => {
      if (closed) return
      deps.logger.warn(`realtime-bridge: connexion LISTEN perdue (${error.message}), reconnexion…`)
      scheduleReconnect()
    })
    client.on('end', () => {
      if (closed || currentClient !== client) return
      scheduleReconnect()
    })

    try {
      await client.connect()
      await client.query(`LISTEN ${PUBLIC_EVENTS_CHANNEL}`)
      attempt = 0
    } catch (error) {
      deps.logger.warn(
        `realtime-bridge: échec de connexion (${error instanceof Error ? error.message : String(error)}), nouvelle tentative…`,
      )
      scheduleReconnect()
    }
  }

  void connect()

  return {
    subscribe(competitionId, listener) {
      emitter.on(competitionId, listener)
      return () => emitter.off(competitionId, listener)
    },
    subscribeAll(listener) {
      emitter.on(ALL_EVENTS, listener)
      return () => emitter.off(ALL_EVENTS, listener)
    },
    async close() {
      closed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      await currentClient?.end()
    },
  }
}

/**
 * Défaut inoffensif de `AppDeps` (app.ts) : ne se connecte jamais à
 * Postgres, ne diffuse jamais rien. Toutes les suites de test existantes qui
 * construisent `createApp({...})` sans s'intéresser au Lot 7 continuent de
 * fonctionner sans rien savoir de `LISTEN/NOTIFY` — seuls `index.ts`
 * (production) et les tests dédiés au Lot 7 injectent un vrai
 * `createRealtimeBridge`.
 */
export function createNoopRealtimeBridge(): RealtimeBridge {
  return {
    subscribe: () => () => {},
    subscribeAll: () => () => {},
    close: () => Promise.resolve(),
  }
}
