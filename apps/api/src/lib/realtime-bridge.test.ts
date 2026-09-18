import type { PublicStreamEvent } from '@climbcontest/contracts'
import { applyPendingMigrations, createDatabase, type DatabaseHandle } from '@climbcontest/db'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { sql } from 'drizzle-orm'
import pg from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import type { Logger } from './logger'
import { notifyPublic } from './notify-public'
import { createRealtimeBridge, type RealtimeBridge } from './realtime-bridge'

let container: StartedPostgreSqlContainer
let handle: DatabaseHandle
const silentLogger = { info: () => {}, warn: () => {}, error: () => {} } as unknown as Logger

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16.15-alpine').start()
  const client = new pg.Client({ connectionString: container.getConnectionUri() })
  await client.connect()
  await applyPendingMigrations(client)
  await client.end()
  handle = createDatabase(container.getConnectionUri())
}, 180_000)

afterAll(async () => {
  await handle.close()
  await container.stop()
})

const openBridges: RealtimeBridge[] = []
afterEach(async () => {
  await Promise.all(openBridges.map((bridge) => bridge.close()))
  openBridges.length = 0
})

async function createConnectedBridge(): Promise<RealtimeBridge> {
  const bridge = createRealtimeBridge(container.getConnectionUri(), { logger: silentLogger })
  openBridges.push(bridge)
  // `connect()` est fire-and-forget (constructeur synchrone) — laisse le
  // temps au LISTEN de s'établir avant que les tests n'émettent un NOTIFY.
  await sleep(500)
  return bridge
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function waitForNextEvent(
  subscribe: (listener: (event: PublicStreamEvent) => void) => () => void,
  timeoutMs = 5000,
): Promise<PublicStreamEvent> {
  return new Promise((resolve, reject) => {
    let unsubscribe: () => void = () => {}
    const timer = setTimeout(() => {
      unsubscribe()
      reject(new Error('Timeout en attente d’un événement.'))
    }, timeoutMs)
    unsubscribe = subscribe((event) => {
      clearTimeout(timer)
      unsubscribe()
      resolve(event)
    })
  })
}

const sampleEvent: PublicStreamEvent = {
  type: 'ranking_updated',
  competitionId: '0189dcd5-5311-7d40-8db0-9496a2eef37b',
  categoryId: '0189dcd5-5311-7d40-8db0-9496a2eef37c',
}

describe('createRealtimeBridge — livraison via LISTEN/NOTIFY', () => {
  it('délivre un événement NOTIFY émis après COMMIT', async () => {
    const bridge = await createConnectedBridge()
    const received = waitForNextEvent((listener) => bridge.subscribe(sampleEvent.competitionId, listener))

    await handle.db.transaction(async (tx) => {
      await notifyPublic(tx, sampleEvent)
    })

    await expect(received).resolves.toEqual(sampleEvent)
  })

  it("ne délivre RIEN pour un NOTIFY émis dans une transaction annulée (rollback) — garantie centrale du Lot 7", async () => {
    const bridge = await createConnectedBridge()
    let receivedAnything = false
    const unsubscribe = bridge.subscribeAll(() => {
      receivedAnything = true
    })

    await expect(
      handle.db.transaction(async (tx) => {
        await notifyPublic(tx, sampleEvent)
        throw new Error('Échec volontaire — la transaction doit être annulée.')
      }),
    ).rejects.toThrow('Échec volontaire')

    await sleep(500)
    unsubscribe()
    expect(receivedAnything).toBe(false)
  })

  it('unsubscribe arrête la livraison à ce seul abonné', async () => {
    const bridge = await createConnectedBridge()
    let count = 0
    const unsubscribe = bridge.subscribe(sampleEvent.competitionId, () => {
      count += 1
    })
    unsubscribe()

    await handle.db.transaction(async (tx) => {
      await notifyPublic(tx, sampleEvent)
    })
    await sleep(500)

    expect(count).toBe(0)
  })

  it('subscribeAll reçoit les événements de toutes les compétitions', async () => {
    const bridge = await createConnectedBridge()
    const otherEvent: PublicStreamEvent = {
      type: 'route_updated',
      competitionId: '0189dcd5-5311-7d40-8db0-9496a2eef37d',
      routeId: '0189dcd5-5311-7d40-8db0-9496a2eef37e',
    }
    const received = waitForNextEvent((listener) => bridge.subscribeAll(listener))

    await handle.db.transaction(async (tx) => {
      await notifyPublic(tx, otherEvent)
    })

    await expect(received).resolves.toEqual(otherEvent)
  })

  it(
    'se reconnecte et reprend le LISTEN après une coupure de connexion',
    async () => {
      const bridge = await createConnectedBridge()

      // Coupe la connexion PostgreSQL du bridge, sans redémarrer le
      // conteneur — identifiée par son `application_name` stable.
      await handle.db.execute(
        sql`select pg_terminate_backend(pid) from pg_stat_activity where application_name = 'climbcontest-realtime-bridge'`,
      )

      const received = waitForNextEvent(
        (listener) => bridge.subscribe(sampleEvent.competitionId, listener),
        15_000,
      )

      // Laisse le temps à la reconnexion + au nouveau LISTEN de s'établir
      // avant de réémettre — le repli exponentiel peut aller jusqu'à
      // quelques secondes dès la première tentative.
      await sleep(3000)
      await handle.db.transaction(async (tx) => {
        await notifyPublic(tx, sampleEvent)
      })

      await expect(received).resolves.toEqual(sampleEvent)
    },
    20_000,
  )
})
