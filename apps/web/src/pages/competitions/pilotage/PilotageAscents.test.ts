import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRouter, createWebHistory, type Router } from 'vue-router'

import { stubViewport } from '../../../test-utils/media-query'
import PilotageAscents from './PilotageAscents.vue'

const ROUND = '0192f0c0-0000-7000-8000-000000000010'
const ROUTE = '0192f0c0-0000-7000-8000-000000000030'
const CAT = '0192f0c0-0000-7000-8000-000000000001'
const LEA = '0192f0c0-0000-7000-8000-0000000000a1'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

const dashboard = {
  computedAt: '2026-09-22T10:00:00.000Z',
  categories: [
    {
      categoryId: CAT,
      label: 'U16 Femme',
      routes: [
        {
          routeId: ROUTE,
          number: 3,
          name: 'Le surplomb',
          roundId: ROUND,
          roundStatus: 'open',
          done: 0,
          expected: 1,
          lastAscentAt: null,
        },
      ],
    },
  ],
  competitorsPending: [],
  judges: [],
  alerts: [],
}

/** Renvoie les URL appelées : on veut vérifier lequel des deux rendus a chargé. */
function stubApi(): string[] {
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request): Promise<Response> => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      calls.push(url)
      if (url.endsWith('/dashboard')) return Promise.resolve(jsonResponse(dashboard))
      if (url.endsWith('/rounds')) {
        return Promise.resolve(
          jsonResponse([{ id: ROUND, type: 'qualification', displayOrder: 0 }]),
        )
      }
      if (url.includes('/ascents/matrix')) {
        return Promise.resolve(
          jsonResponse({
            roundId: ROUND,
            categoryId: CAT,
            routes: [{ routeId: ROUTE, number: 3, name: 'Le surplomb', holdCount: 40 }],
            competitors: [
              {
                competitorId: LEA,
                bib: 47,
                firstName: 'Léa',
                lastName: 'Martin',
                cells: [{ routeId: ROUTE, ascent: null, conflict: false }],
              },
            ],
          }),
        )
      }
      if (url.includes('/ascents?')) {
        return Promise.resolve(
          jsonResponse([
            {
              id: LEA,
              bib: 47,
              firstName: 'Léa',
              lastName: 'Martin',
              categoryLabel: 'U16 Femme',
              ascent: null,
            },
          ]),
        )
      }
      return Promise.reject(new Error(`URL non gérée par ce test : ${url}`))
    }),
  )
  return calls
}

let router: Router

async function open() {
  router = createRouter({
    history: createWebHistory(),
    routes: [{ path: '/competitions/:id/:tab?', component: { template: '<div />' } }],
  })
  await router.push('/competitions/c1/pilotage?section=ascents')
  await router.isReady()
  return mount(PilotageAscents, {
    props: { competitionId: 'c1' },
    // La modale de `packages/ui` se téléporte dans `body` : sans ça, le
    // formulaire n'est nulle part dans l'arbre du wrapper.
    attachTo: document.body,
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

describe('PilotageAscents — matrice au-dessus de lg, liste en dessous', () => {
  beforeEach(() => {
    stubApi()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('montre la grille à partir de 1024 px', async () => {
    stubViewport(1024)
    const wrapper = await open()
    await flushPromises()
    expect(wrapper.find('[data-testid="ascent-matrix"]').exists()).toBe(true)
    // Un seul arbre dans le DOM : le sélecteur de voie du rendu mobile n'y est pas.
    expect(wrapper.findAll('select')).toHaveLength(1)
    expect(wrapper.get('select').attributes('id')).toBeDefined()
  })

  it('garde la liste par voie en dessous de 1024 px', async () => {
    stubViewport(1023)
    const wrapper = await open()
    await flushPromises()
    expect(wrapper.find('[data-testid="ascent-matrix"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Tour et voie')
  })

  it('ne charge pas la liste par voie quand la grille est affichée', async () => {
    stubViewport(1024)
    const calls = stubApi()
    await open()
    await flushPromises()
    expect(calls.some((url) => url.includes('/ascents/matrix'))).toBe(true)
    // `GET .../ascents?roundId=&routeId=` n'a aucune raison de partir ici.
    expect(calls.some((url) => /\/ascents\?/.test(url))).toBe(false)
  })

  it('ouvre le formulaire de secours depuis une case de la grille', async () => {
    stubViewport(1024)
    const wrapper = await open()
    await flushPromises()

    await wrapper.get(`[data-testid="matrix-cell-${LEA}-${ROUTE}"]`).trigger('click')
    await flushPromises()
    expect(document.body.querySelector('[data-testid="ascent-edit-subject"]')?.textContent).toBe(
      '47 — Léa Martin — Voie 3 — Le surplomb',
    )
    // Case vide : c'est une saisie de secours, pas une correction.
    expect(document.body.textContent).toContain('Saisie de secours')
    wrapper.unmount()
  })
})
