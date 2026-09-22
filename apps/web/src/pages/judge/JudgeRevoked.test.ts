import type { QueueItem } from '@climbcontest/sync'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clearJudgeSession, judgeToken, setJudgeSession } from '../../api/judge-session'
import { judgeDb } from '../../judge/local-db'
import type { QueuePayload } from '../../judge/queue-payload'
import { syncEngine } from '../../judge/sync-runtime'
import { flushLiveQueries } from '../../test-utils/flush'
import JudgeRevoked from './JudgeRevoked.vue'

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
      modifier: 'plus',
      isTop: false,
      status: 'valid',
      climbTimeMs: null,
    },
    state: 'pending',
    attempts: 3,
    // Loin dans le futur : le moteur ne tente aucun envoi pendant le test.
    nextAttemptAt: Number.MAX_SAFE_INTEGER,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('JudgeRevoked (ADR-078)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('réseau indisponible en test')))
    setJudgeSession('jeton-juge')
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    clearJudgeSession()
    await judgeDb.routeDetails.clear()
    await judgeDb.queue.clear()
    await syncEngine.hydrate()
  })

  it('garde le jeton tant que des saisies attendent de partir, et le dit', async () => {
    await judgeDb.queue.bulkPut([queued('a'), queued('b')])
    await syncEngine.hydrate()

    const wrapper = mount(JudgeRevoked)
    await flushLiveQueries()

    expect(wrapper.text()).toContain('Votre accès a été révoqué')
    expect(wrapper.get('[data-testid="judge-revoked-sending"]').text()).toContain(
      'Envoi de vos 2 dernière(s) saisie(s)',
    )
    expect(judgeToken.value).toBe('jeton-juge')
  })

  it('déconnecte le juge une fois la file vide, sans rien effacer du téléphone', async () => {
    await judgeDb.routeDetails.put({ routeId: 'route-1', detail: routeDetail })
    await syncEngine.hydrate()

    const wrapper = mount(JudgeRevoked)
    await flushLiveQueries()

    expect(wrapper.get('[data-testid="judge-revoked-done"]').text()).toContain(
      'Toutes vos saisies ont été transmises',
    )
    expect(judgeToken.value).toBeNull()
    expect(await judgeDb.routeDetails.count()).toBe(1)
  })

  it('liste en clair les saisies refusées, avec leur motif, à montrer à l’organisateur', async () => {
    await judgeDb.routeDetails.put({ routeId: 'route-1', detail: routeDetail })
    await judgeDb.queue.put(queued('r', { state: 'rejected', rejectedReason: 'Tour fermé.' }))
    await syncEngine.hydrate()

    const wrapper = mount(JudgeRevoked)
    await flushLiveQueries()

    expect(wrapper.text()).toContain('1 saisie(s) à montrer à l\'organisateur')
    expect(wrapper.text()).toContain('Dossard 47 — Léa Martin')
    expect(wrapper.text()).toContain('Voie 3 — prise 25+')
    expect(wrapper.text()).toContain('Tour fermé.')
    // Une saisie refusée ne partira plus : elle ne retient pas la déconnexion.
    expect(judgeToken.value).toBeNull()
  })
})
