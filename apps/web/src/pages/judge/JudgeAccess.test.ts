import type { QueueItem } from '@climbcontest/sync'
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRouter, createWebHistory } from 'vue-router'

import { judgeDb } from '../../judge/local-db'
import type { QueuePayload } from '../../judge/queue-payload'
import { syncEngine } from '../../judge/sync-runtime'
import { flushLiveQueries } from '../../test-utils/flush'
import JudgeAccess from './JudgeAccess.vue'

const PAUL = '0189dcd5-5311-7d40-8db0-9496a2eef301'
const LEA = '0189dcd5-5311-7d40-8db0-9496a2eef302'

const routeDetail = {
  route: { id: 'route-1', number: 3, name: null, holdCount: 40, categories: [], photo: null },
  round: { id: 'round-1', type: 'qualification' as const },
  timingEnabled: false,
  competitors: [
    {
      id: 'comp-1',
      bib: 47,
      firstName: 'Léa',
      lastName: 'Martin',
      categoryLabel: 'U16 Femme',
      ascent: null,
    },
  ],
}

function queued(id: string, overrides: Partial<QueueItem<QueuePayload>> = {}): QueueItem<QueuePayload> {
  return {
    id,
    kind: 'create',
    payload: {
      kind: 'create',
      id,
      roundId: 'round-1',
      routeId: 'route-1',
      competitorId: 'comp-1',
      recordedAt: new Date().toISOString(),
      deviceId: 'device-1',
      holdNumber: 25,
      modifier: 'none',
      isTop: false,
      status: 'valid',
      climbTimeMs: null,
    },
    state: 'pending',
    attempts: 0,
    nextAttemptAt: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

/** `GET /judge/access/:token` répond ; tout le reste (le lot de saisies) échoue comme hors réseau. */
function stubNetwork(scannedJudgeId: string): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) => {
      if (input.includes('/judge/access/')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ judgeId: scannedJudgeId, displayName: 'Léa', pinRequired: true }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        )
      }
      return Promise.reject(new Error('réseau indisponible en test'))
    }),
  )
}

async function knownLocally(judgeId: string, displayName: string): Promise<void> {
  await judgeDb.meta.put({
    key: 'judge',
    judgeId,
    displayName,
    fetchedAt: new Date().toISOString(),
  })
}

describe('JudgeAccess — garde au changement de juge (ADR-079)', () => {
  let wrapper: VueWrapper

  async function open(): Promise<void> {
    const router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: '/j/:token', name: 'judge-access', component: JudgeAccess },
        { path: '/j/home', name: 'judge-home', component: { template: '<div />' } },
      ],
    })
    await router.push('/j/un-jeton')
    await router.isReady()
    wrapper = mount(JudgeAccess, { global: { plugins: [router] } })
    await flushLiveQueries()
  }

  beforeEach(async () => {
    await judgeDb.routeDetails.put({ routeId: 'route-1', detail: routeDetail })
  })

  afterEach(async () => {
    wrapper.unmount()
    vi.unstubAllGlobals()
    await judgeDb.routeDetails.clear()
    await judgeDb.meta.clear()
    await judgeDb.queue.clear()
    await syncEngine.hydrate()
  })

  it('aucun message sur un téléphone vierge', async () => {
    stubNetwork(LEA)
    await open()
    expect(wrapper.find('[data-testid="judge-access-unsent"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="judge-access-confirm-switch"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Votre code à 6 chiffres')
  })

  it('aucun message quand le juge rescanne SON propre lien, même avec une file en attente', async () => {
    await knownLocally(LEA, 'Léa')
    await judgeDb.queue.put(queued('a'))
    await syncEngine.hydrate()
    stubNetwork(LEA)
    await open()
    expect(wrapper.find('[data-testid="judge-access-unsent"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Votre code à 6 chiffres')
  })

  it('autre juge, file vide : demande une confirmation nominative avant le code', async () => {
    await knownLocally(PAUL, 'Paul')
    stubNetwork(LEA)
    await open()

    const confirm = wrapper.get('[data-testid="judge-access-confirm-switch"]')
    expect(confirm.text()).toContain('connecté en tant que Paul')
    expect(wrapper.text()).not.toContain('Votre code à 6 chiffres')

    await confirm.findAll('button')[0]?.trigger('click')
    expect(wrapper.text()).toContain('Votre code à 6 chiffres')
  })

  it('autre juge, saisies en attente : les liste, ne propose pas le code, et n’efface rien', async () => {
    await knownLocally(PAUL, 'Paul')
    await judgeDb.queue.bulkPut([queued('a'), queued('b')])
    await syncEngine.hydrate()
    stubNetwork(LEA)
    await open()

    const unsent = wrapper.get('[data-testid="judge-access-unsent"]')
    expect(unsent.text()).toContain('encore 2 saisie(s) de Paul')
    expect(unsent.text()).toContain('Dossard 47 — Léa Martin')
    expect(unsent.text()).toContain('Voie 3 — prise 25')
    expect(wrapper.text()).not.toContain('Votre code à 6 chiffres')
    expect(await judgeDb.queue.count()).toBe(2)
  })

  it('effacer demande une confirmation explicite, puis mène à la confirmation de changement', async () => {
    await knownLocally(PAUL, 'Paul')
    await judgeDb.queue.put(queued('r', { state: 'rejected', rejectedReason: 'Tour fermé.' }))
    await syncEngine.hydrate()
    stubNetwork(LEA)
    await open()

    const unsent = wrapper.get('[data-testid="judge-access-unsent"]')
    expect(unsent.text()).toContain('Tour fermé.')
    expect(unsent.text()).toContain('ne partiront plus toutes seules')

    // Premier geste : rien n'est effacé, un avertissement s'affiche.
    await unsent.get('button.underline').trigger('click')
    expect(wrapper.get('[role="alert"]').text()).toContain('définitivement perdues')
    expect(await judgeDb.queue.count()).toBe(1)

    const confirmButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('Oui, effacer'))
    await confirmButton?.trigger('click')
    await flushLiveQueries()

    expect(await judgeDb.queue.count()).toBe(0)
    expect(wrapper.find('[data-testid="judge-access-confirm-switch"]').exists()).toBe(true)
  })
})
