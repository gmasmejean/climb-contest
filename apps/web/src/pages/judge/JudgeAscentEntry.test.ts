import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRouter, createWebHistory } from 'vue-router'

import JudgeAscentEntry from './JudgeAscentEntry.vue'

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
  ],
}

describe('JudgeAscentEntry', () => {
  let router: ReturnType<typeof createRouter>

  beforeEach(() => {
    router = createRouter({
      history: createWebHistory(),
      routes: [
        {
          path: '/j/routes/:routeId/competitors/:competitorId',
          name: 'judge-ascent-entry',
          component: JudgeAscentEntry,
        },
        { path: '/j/routes/:routeId', name: 'judge-route', component: { template: '<div />' } },
      ],
    })
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function digitButton(wrapper: ReturnType<typeof mount>, label: string) {
    return wrapper.findAll('button').find((button) => button.text() === label)
  }

  it('compose une prise, affiche le récapitulatif exact et confirme', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(routeDetail))
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(null))

    await router.push('/j/routes/route-1/competitors/comp-1')
    await router.isReady()
    const wrapper = mount(JudgeAscentEntry, { global: { plugins: [router] } })
    await flushPromises()

    expect(wrapper.text()).toContain('Dossard 47 — Léa Martin')

    await digitButton(wrapper, '2')?.trigger('click')
    await digitButton(wrapper, '5')?.trigger('click')
    await digitButton(wrapper, '+')?.trigger('click')

    const recapButton = wrapper.findAll('button').find((b) => b.text() === 'Voir le récapitulatif')
    await recapButton?.trigger('click')

    expect(wrapper.text()).toContain('Dossard 47 — Léa Martin — Voie 3 — prise 25+')

    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ id: 'new-ascent' }, 201))
    const confirmButton = wrapper.findAll('button').find((b) => b.text() === 'Confirmer')
    await confirmButton?.trigger('click')
    await flushPromises()

    const postCall = vi.mocked(fetch).mock.calls.find(([, options]) => options?.method === 'POST')
    expect(postCall?.[0]).toBe('/api/v1/judge/ascents')
    const body = JSON.parse(postCall?.[1]?.body as string) as {
      holdNumber: number
      modifier: string
      routeId: string
      competitorId: string
    }
    expect(body.holdNumber).toBe(25)
    expect(body.modifier).toBe('plus')
    expect(body.routeId).toBe('route-1')
    expect(body.competitorId).toBe('comp-1')

    expect(router.currentRoute.value.name).toBe('judge-route')
  })

  it('un TOP vide le numéro de prise et l’affiche dans le récapitulatif', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(routeDetail))
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(null))

    await router.push('/j/routes/route-1/competitors/comp-1')
    await router.isReady()
    const wrapper = mount(JudgeAscentEntry, { global: { plugins: [router] } })
    await flushPromises()

    const topButton = wrapper.findAll('button').find((b) => b.text() === 'TOP')
    await topButton?.trigger('click')
    const recapButton = wrapper.findAll('button').find((b) => b.text() === 'Voir le récapitulatif')
    await recapButton?.trigger('click')

    expect(wrapper.text()).toContain('Dossard 47 — Léa Martin — Voie 3 — TOP')
  })

  it('refuse d’avancer au récapitulatif sans prise ni statut choisi', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(routeDetail))
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(null))

    await router.push('/j/routes/route-1/competitors/comp-1')
    await router.isReady()
    const wrapper = mount(JudgeAscentEntry, { global: { plugins: [router] } })
    await flushPromises()

    const recapButton = wrapper.findAll('button').find((b) => b.text() === 'Voir le récapitulatif')
    await recapButton?.trigger('click')

    expect(wrapper.text()).not.toContain('— Voie 3 —')
    expect(wrapper.text()).toContain('Indiquez la prise atteinte')
  })
})
