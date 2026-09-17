import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRouter, createWebHistory } from 'vue-router'

import JudgeRoute from './JudgeRoute.vue'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const routeDetail = {
  route: { id: 'route-1', number: 3, name: null, holdCount: 40 },
  round: { id: 'round-1', type: 'qualification' },
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
        modifier: 'none',
        isTop: false,
        status: 'valid',
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
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sépare les compétiteurs entre « à faire » et « fait »', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(routeDetail))
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(null))

    await router.push('/j/routes/route-1')
    await router.isReady()
    const wrapper = mount(JudgeRoute, { global: { plugins: [router] } })
    await flushPromises()

    // Onglet « À faire » actif par défaut.
    expect(wrapper.text()).toContain('Dossard 47 — Léa Martin')
    expect(wrapper.text()).not.toContain('Dossard 12 — Sacha Dupont')

    await wrapper.get('[role="tab"]:nth-of-type(2)').trigger('click')
    expect(wrapper.text()).toContain('Dossard 12 — Sacha Dupont')
    expect(wrapper.text()).toContain('prise 30')
  })

  it('filtre par dossard ou par nom', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(routeDetail))
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(null))

    await router.push('/j/routes/route-1')
    await router.isReady()
    const wrapper = mount(JudgeRoute, { global: { plugins: [router] } })
    await flushPromises()

    await wrapper.find('input').setValue('47')
    expect(wrapper.text()).toContain('Dossard 47')
  })

  it("affiche un état vide quand aucun tour n'est ouvert", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ ...routeDetail, round: null, competitors: [] }),
    )
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(null))

    await router.push('/j/routes/route-1')
    await router.isReady()
    const wrapper = mount(JudgeRoute, { global: { plugins: [router] } })
    await flushPromises()

    expect(wrapper.text()).toContain('Aucun tour ouvert')
  })

  // Placé en dernier : `useAscentRowState` est un état module-scope partagé
  // (comme `useToast`), donc la soumission simulée ici persiste pour le
  // reste du fichier si ce test n'est pas le dernier.
  it('propose « Corriger » sur une ligne tout juste synchronisée de façon optimiste', async () => {
    // Simule ce que fait `JudgeAscentEntry.vue` juste avant de naviguer :
    // la soumission part avant que `JudgeRoute.vue` ne relise le serveur, le
    // `GET` ci-dessous peut donc légitimement encore renvoyer `ascent: null`.
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ id: 'new-ascent' }, 201))
    const { useAscentRowState } = await import('../../judge/useAscentRowState')
    useAscentRowState().submitCreate('comp-1', {
      id: 'new-ascent',
      roundId: 'round-1',
      routeId: 'route-1',
      competitorId: 'comp-1',
      holdNumber: 25,
      modifier: 'plus',
      isTop: false,
      status: 'valid',
      climbTimeMs: null,
      recordedAt: new Date().toISOString(),
      deviceId: 'device-1',
    })
    await flushPromises()

    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ ...routeDetail, competitors: [routeDetail.competitors[0]] }),
    )
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(null))

    await router.push('/j/routes/route-1')
    await router.isReady()
    const wrapper = mount(JudgeRoute, { global: { plugins: [router] } })
    await flushPromises()

    await wrapper.get('[role="tab"]:nth-of-type(2)').trigger('click')
    expect(wrapper.text()).toContain('prise 25+')
    expect(wrapper.text()).toContain('Corriger')
  })
})
