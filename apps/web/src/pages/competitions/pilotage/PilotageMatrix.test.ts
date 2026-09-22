import type { DashboardResponse } from '@climbcontest/contracts'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRouter, createWebHistory, type Router } from 'vue-router'

import PilotageMatrix from './PilotageMatrix.vue'

const ROUND = '0192f0c0-0000-7000-8000-000000000010'
const ROUTE_3 = '0192f0c0-0000-7000-8000-000000000030'
const ROUTE_4 = '0192f0c0-0000-7000-8000-000000000040'
const CAT = '0192f0c0-0000-7000-8000-000000000001'
const LEA = '0192f0c0-0000-7000-8000-0000000000a1'
const NOE = '0192f0c0-0000-7000-8000-0000000000a2'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

const categories: DashboardResponse['categories'] = [
  {
    categoryId: CAT,
    label: 'U16 Femme',
    routes: [
      {
        routeId: ROUTE_3,
        number: 3,
        name: 'Le surplomb',
        roundId: ROUND,
        roundStatus: 'open',
        done: 1,
        expected: 2,
        lastAscentAt: null,
      },
      {
        routeId: ROUTE_4,
        number: 4,
        name: null,
        roundId: ROUND,
        roundStatus: 'open',
        done: 0,
        expected: 2,
        lastAscentAt: null,
      },
    ],
  },
]

function matrixBody() {
  return {
    roundId: ROUND,
    categoryId: CAT,
    routes: [
      { routeId: ROUTE_3, number: 3, name: 'Le surplomb', holdCount: 40 },
      { routeId: ROUTE_4, number: 4, name: null, holdCount: 35 },
    ],
    competitors: [
      {
        competitorId: LEA,
        bib: 47,
        firstName: 'Léa',
        lastName: 'Martin',
        cells: [
          {
            routeId: ROUTE_3,
            ascent: {
              id: '0192f0c0-0000-7000-8000-0000000000f1',
              holdNumber: 25,
              modifier: 'plus',
              isTop: false,
              status: 'valid',
              climbTimeMs: null,
              recordedAt: '2026-09-22T10:00:00.000Z',
            },
            conflict: false,
          },
          { routeId: ROUTE_4, ascent: null, conflict: false },
        ],
      },
      {
        competitorId: NOE,
        bib: 48,
        firstName: 'Noé',
        lastName: 'Durand',
        cells: [
          { routeId: ROUTE_3, ascent: null, conflict: true },
          { routeId: ROUTE_4, ascent: null, conflict: false },
        ],
      },
    ],
  }
}

function stubApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request): Promise<Response> => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.includes('/ascents/matrix')) return Promise.resolve(jsonResponse(matrixBody()))
      if (url.endsWith('/rounds')) {
        return Promise.resolve(
          jsonResponse([{ id: ROUND, type: 'qualification', displayOrder: 0 }]),
        )
      }
      return Promise.reject(new Error(`URL non gérée par ce test : ${url}`))
    }),
  )
}

let router: Router

/** La sélection vit dans `?pair=` (ADR-075) : l'écran a besoin d'un routeur. */
function makeRouter(): Router {
  return createRouter({
    history: createWebHistory(),
    routes: [{ path: '/competitions/:id/:tab?', component: { template: '<div />' } }],
  })
}

async function open() {
  await router.push('/competitions/c1/pilotage?section=ascents')
  await router.isReady()
  return mount(PilotageMatrix, {
    props: { competitionId: 'c1', categories },
    global: {
      plugins: [
        router,
        [
          VueQueryPlugin,
          { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        ],
      ],
    },
  })
}

describe('PilotageMatrix — grille compétiteurs × voies (Lot 20)', () => {
  beforeEach(() => {
    router = makeRouter()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('croise les compétiteurs et les voies, et résume chaque passage', async () => {
    stubApi()
    const wrapper = await open()
    await flushPromises()

    const headers = wrapper.findAll('thead th').map((th) => th.text())
    expect(headers).toEqual(['Compétiteur', 'Voie 3 — Le surplomb', 'Voie 4'])
    expect(wrapper.findAll('[data-testid="matrix-row"]')).toHaveLength(2)
    expect(wrapper.get(`[data-testid="matrix-cell-${LEA}-${ROUTE_3}"]`).text()).toBe('25+')
    expect(wrapper.get(`[data-testid="matrix-cell-${LEA}-${ROUTE_4}"]`).text()).toBe('—')
  })

  it('ouvre une correction préremplie sur une case déjà saisie', async () => {
    stubApi()
    const wrapper = await open()
    await flushPromises()

    await wrapper.get(`[data-testid="matrix-cell-${LEA}-${ROUTE_3}"]`).trigger('click')
    expect(wrapper.emitted('edit')?.[0]?.[0]).toEqual(
      expect.objectContaining({
        mode: 'correct',
        holdNumber: 25,
        modifier: 'plus',
        routeId: ROUTE_3,
        competitorId: LEA,
        holdCount: 40,
        subject: '47 — Léa Martin — Voie 3 — Le surplomb',
      }),
    )
  })

  it('ouvre une saisie de secours sur une case vide', async () => {
    stubApi()
    const wrapper = await open()
    await flushPromises()

    await wrapper.get(`[data-testid="matrix-cell-${LEA}-${ROUTE_4}"]`).trigger('click')
    expect(wrapper.emitted('edit')?.[0]?.[0]).toEqual(
      expect.objectContaining({ mode: 'create', ascentId: null, holdCount: 35 }),
    )
  })

  it('renvoie vers les conflits au lieu de laisser corriger une case à trancher', async () => {
    stubApi()
    const wrapper = await open()
    await flushPromises()

    const cell = wrapper.get(`[data-testid="matrix-cell-${NOE}-${ROUTE_3}"]`)
    // Une case à trancher n'est pas une case vide : les deux appellent des
    // gestes opposés, et rien ne doit les confondre à l'œil.
    expect(cell.text()).toBe('à trancher')
    expect(cell.classes()).toContain('bg-red-100')

    await cell.trigger('click')
    expect(wrapper.emitted('conflict')).toHaveLength(1)
    expect(wrapper.emitted('edit')).toBeUndefined()
  })

  it('ne nomme le tour que s’il y en a plusieurs', async () => {
    stubApi()
    const single = await open()
    await flushPromises()
    // Contest : le tour est implicite (ADR-023), le nommer n'apprend rien.
    expect(single.get('select').text()).toContain('U16 Femme')
    expect(single.get('select').text()).not.toContain('Qualification')

    vi.unstubAllGlobals()
    stubApi()
    const twoRounds = await mount(PilotageMatrix, {
      props: {
        competitionId: 'c1',
        categories: [
          {
            ...categories[0]!,
            routes: [
              categories[0]!.routes[0]!,
              { ...categories[0]!.routes[1]!, roundId: '0192f0c0-0000-7000-8000-000000000011' },
            ],
          },
        ],
      },
      global: {
        plugins: [
          router,
          [
            VueQueryPlugin,
            { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
          ],
        ],
      },
    })
    await flushPromises()
    expect(twoRounds.get('select').text()).toContain('Qualification')
  })

  it('annonce chaque case en toutes lettres', async () => {
    stubApi()
    const wrapper = await open()
    await flushPromises()
    expect(
      wrapper.get(`[data-testid="matrix-cell-${LEA}-${ROUTE_3}"]`).attributes('aria-label'),
    ).toBe('47 — Léa Martin, Voie 3 — Le surplomb : 25+')
  })

  it('écrit la sélection dans l’adresse, sans empiler d’historique', async () => {
    stubApi()
    const wrapper = await open()
    await flushPromises()
    await wrapper.get('select').setValue(`${ROUND}:${CAT}`)
    await flushPromises()
    expect(router.currentRoute.value.query.pair).toBe(`${ROUND}:${CAT}`)
    // `replace` et non `push` : « précédent » ne doit pas désélectionner.
    expect(router.currentRoute.value.query.section).toBe('ascents')
  })
})
