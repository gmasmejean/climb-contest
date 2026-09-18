import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRouter, createWebHistory } from 'vue-router'

import { judgeDb } from '../../judge/local-db'
import { flushLiveQueries } from '../../test-utils/flush'
import JudgeRoute from './JudgeRoute.vue'

const routeDetail = {
  route: { id: 'route-1', number: 3, name: null, holdCount: 40, categories: [] },
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
    {
      id: 'comp-2',
      bib: 12,
      firstName: 'Sacha',
      lastName: 'Dupont',
      categoryLabel: 'U16 Femme',
      ascent: {
        id: 'ascent-2',
        holdNumber: 30,
        modifier: 'none' as const,
        isTop: false,
        status: 'valid' as const,
        climbTimeMs: null,
        recordedAt: new Date().toISOString(),
      },
    },
  ],
}

describe('JudgeRoute', () => {
  let router: ReturnType<typeof createRouter>

  beforeEach(() => {
    router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: '/j/routes/:routeId', name: 'judge-route', component: JudgeRoute },
        { path: '/j/home', name: 'judge-home', component: { template: '<div />' } },
        {
          path: '/j/routes/:routeId/competitors/:competitorId',
          name: 'judge-ascent-entry',
          component: { template: '<div />' },
        },
      ],
    })
    // Aucun test de ce fichier ne doit jamais toucher le réseau : toutes les
    // lectures viennent de Dexie (ADR-012) ; un envoi de fond éventuel de
    // `packages/sync` (debounce 300ms) ne doit pas provoquer d'appel réel.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('réseau indisponible en test')))
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    await judgeDb.routeDetails.clear()
    await judgeDb.queue.clear()
    await judgeDb.lastSubmission.clear()
  })

  it('sépare les compétiteurs entre « à faire » et « fait »', async () => {
    await judgeDb.routeDetails.put({ routeId: 'route-1', detail: routeDetail })

    await router.push('/j/routes/route-1')
    await router.isReady()
    const wrapper = mount(JudgeRoute, { global: { plugins: [router] } })
    await flushLiveQueries()

    // Onglet « À faire » actif par défaut.
    expect(wrapper.text()).toContain('Dossard 47 — Léa Martin')
    expect(wrapper.text()).not.toContain('Dossard 12 — Sacha Dupont')

    await wrapper.get('[role="tab"]:nth-of-type(2)').trigger('click')
    expect(wrapper.text()).toContain('Dossard 12 — Sacha Dupont')
    expect(wrapper.text()).toContain('prise 30')
  })

  it('filtre par dossard ou par nom', async () => {
    await judgeDb.routeDetails.put({ routeId: 'route-1', detail: routeDetail })

    await router.push('/j/routes/route-1')
    await router.isReady()
    const wrapper = mount(JudgeRoute, { global: { plugins: [router] } })
    await flushLiveQueries()

    await wrapper.find('input').setValue('47')
    expect(wrapper.text()).toContain('Dossard 47')
  })

  it("affiche un état vide quand aucun tour n'est ouvert", async () => {
    await judgeDb.routeDetails.put({
      routeId: 'route-1',
      detail: { ...routeDetail, round: null, competitors: [] },
    })

    await router.push('/j/routes/route-1')
    await router.isReady()
    const wrapper = mount(JudgeRoute, { global: { plugins: [router] } })
    await flushLiveQueries()

    expect(wrapper.text()).toContain('Aucun tour ouvert')
  })

  it("affiche un message honnête quand la voie n'a jamais été téléchargée", async () => {
    await router.push('/j/routes/route-inconnue')
    await router.isReady()
    const wrapper = mount(JudgeRoute, { global: { plugins: [router] } })
    await flushLiveQueries()

    expect(wrapper.text()).toContain('indisponible hors ligne')
  })

  it('propose « Corriger » sur une ligne tout juste enregistrée de façon optimiste', async () => {
    // Simule ce que fait `ascent-mutations.ts` à l'enqueue : écriture
    // optimiste AVANT tout réseau (SPEC.md § 6.3) — la ligne apparaît « fait »
    // même si rien n'est encore parti.
    const recordedAt = new Date().toISOString()
    await judgeDb.routeDetails.put({
      routeId: 'route-1',
      detail: {
        ...routeDetail,
        competitors: [
          {
            ...routeDetail.competitors[0]!,
            ascent: {
              id: 'new-ascent',
              holdNumber: 25,
              modifier: 'plus' as const,
              isTop: false,
              status: 'valid' as const,
              climbTimeMs: null,
              recordedAt,
            },
          },
        ],
      },
    })
    await judgeDb.lastSubmission.put({
      key: 'current',
      competitorId: 'comp-1',
      ascentId: 'new-ascent',
      recordedAt,
      correctableUntil: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    })

    await router.push('/j/routes/route-1')
    await router.isReady()
    const wrapper = mount(JudgeRoute, { global: { plugins: [router] } })
    await flushLiveQueries()

    await wrapper.get('[role="tab"]:nth-of-type(2)').trigger('click')
    expect(wrapper.text()).toContain('prise 25+')
    expect(wrapper.text()).toContain('Corriger')
  })
})
