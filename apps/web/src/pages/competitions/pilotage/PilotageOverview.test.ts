import type { DashboardResponse } from '@climbcontest/contracts'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'

import type { CompetitionPulse } from '../../../composables/useCompetitionPulse'
import PilotageOverview from './PilotageOverview.vue'

const COMPETITOR = '0192f0c0-0000-7000-8000-0000000000c1'
const ROUTE = '0192f0c0-0000-7000-8000-0000000000e1'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

/** Renvoie les URL appelées, pour vérifier aussi ce qui n'a PAS été demandé. */
function stubApi(
  entries: { id: string; type: string; createdAt: string; actorLabel: string }[] = [],
): string[] {
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request): Promise<Response> => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      calls.push(url)
      if (url.includes('/activity-log')) return Promise.resolve(jsonResponse({ entries }))
      if (url.endsWith('/competitors')) {
        return Promise.resolve(
          jsonResponse([
            { id: COMPETITOR, bib: 47, firstName: 'Léa', lastName: 'Martin', categoryId: 'cat' },
          ]),
        )
      }
      if (url.endsWith('/routes')) {
        return Promise.resolve(jsonResponse([{ id: ROUTE, number: 3, name: 'Le surplomb' }]))
      }
      return Promise.reject(new Error(`URL non gérée par ce test : ${url}`))
    }),
  )
  return calls
}

function dashboard(overrides: Partial<DashboardResponse> = {}): DashboardResponse {
  return {
    computedAt: '2026-09-22T10:00:00.000Z',
    categories: [
      {
        categoryId: 'cat',
        label: 'U16 Femme',
        routes: [
          {
            routeId: ROUTE,
            number: 3,
            name: 'Le surplomb',
            roundId: 'round',
            roundStatus: 'open',
            done: 12,
            expected: 30,
            lastAscentAt: null,
          },
          {
            routeId: 'other',
            number: 4,
            name: null,
            roundId: 'round',
            roundStatus: 'open',
            done: 8,
            expected: 30,
            lastAscentAt: null,
          },
        ],
      },
    ],
    competitorsPending: [],
    judges: [],
    alerts: [],
    ...overrides,
  }
}

/** Un pouls figé : ce composant lit le tableau de bord, il ne le charge plus. */
function makePulse(value: DashboardResponse | undefined): CompetitionPulse {
  const data = ref(value)
  const alerts = computed(() => data.value?.alerts ?? [])
  return {
    dashboard: computed(() => data.value),
    isStale: computed(() => false),
    lastUpdate: computed(() => '10:00:00'),
    conflictCount: computed(
      () => alerts.value.filter((alert) => alert.type === 'unresolved_conflict').length,
    ),
    alertCount: computed(() => alerts.value.length),
    blockingCount: computed(() => 0),
    done: computed(() => 0),
    expected: computed(() => 0),
    pilotageBadge: computed(() => undefined),
    readinessBadge: computed(() => undefined),
    refetch: () => Promise.resolve(),
  }
}

function open(pulse: CompetitionPulse) {
  return mount(PilotageOverview, {
    props: { competitionId: 'c1', pulse },
    global: {
      plugins: [
        [
          VueQueryPlugin,
          { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        ],
      ],
    },
  })
}

describe('PilotageOverview — poste de pilotage (Lot 20)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('met les panneaux côte à côte à partir de lg, empilés en dessous', async () => {
    stubApi()
    const wrapper = open(makePulse(dashboard()))
    await flushPromises()
    const grid = wrapper.get('[data-testid="pilotage-overview"]')
    // Une seule mise en page responsive, pas deux copies du contenu.
    expect(grid.classes()).toContain('flex-col')
    expect(grid.classes()).toContain('lg:grid')
    expect(grid.classes()).toContain('lg:grid-cols-[minmax(0,1fr)_22rem]')
  })

  it('montre une barre par voie et une barre de synthèse par catégorie', async () => {
    stubApi()
    const wrapper = open(makePulse(dashboard()))
    await flushPromises()
    const bars = wrapper.findAll('[role="progressbar"]')
    // 1 synthèse + 2 voies.
    expect(bars).toHaveLength(3)
    expect(bars[0]?.attributes('aria-label')).toBe('U16 Femme — total')
    expect(bars[0]?.attributes('aria-valuenow')).toBe('20')
    expect(bars[0]?.attributes('aria-valuemax')).toBe('60')
    expect(bars[1]?.attributes('aria-label')).toBe('Voie 3 — Le surplomb')
    expect(bars[2]?.attributes('aria-label')).toBe('Voie 4')
  })

  it('nomme les conflits à trancher et mène à l’onglet Conflits', async () => {
    stubApi()
    const wrapper = open(
      makePulse(
        dashboard({
          alerts: [
            {
              type: 'unresolved_conflict',
              conflictGroup: 'g1',
              routeId: ROUTE,
              competitorId: COMPETITOR,
            },
          ],
        }),
      ),
    )
    await flushPromises()
    const panel = wrapper.get('[data-testid="panel-conflicts"]')
    // Lot 21 : un compte seul ne dit pas de QUI il s'agit.
    expect(panel.text()).toContain('Dossard 47 — Léa Martin')
    expect(panel.text()).toContain('Voie 3')

    await panel.get('button').trigger('click')
    expect(wrapper.emitted('open')?.[0]).toEqual(['conflicts'])
  })

  it('ne demande ni compétiteurs ni voies quand rien n’est en conflit', async () => {
    const calls = stubApi()
    const wrapper = open(makePulse(dashboard()))
    await flushPromises()
    expect(calls.some((url) => url.endsWith('/competitors'))).toBe(false)
    expect(calls.some((url) => url.endsWith('/routes'))).toBe(false)
    expect(wrapper.get('[data-testid="panel-conflicts"]').text()).toContain('Rien à trancher')
  })

  it('dit qu’un juge est révoqué', async () => {
    stubApi()
    const wrapper = open(
      makePulse(
        dashboard({
          judges: [
            {
              judgeId: 'j1',
              displayName: 'Ana',
              revokedAt: '2026-09-22T09:00:00.000Z',
              lastSeenAt: null,
              ascentCount: 4,
            },
          ],
        }),
      ),
    )
    await flushPromises()
    const panel = wrapper.get('[data-testid="panel-judges"]')
    expect(panel.text()).toContain('Ana')
    expect(panel.text()).toContain('accès révoqué')
    expect(panel.text()).toContain('jamais vu')
  })

  it('résume les cinq dernières actions et mène au journal', async () => {
    stubApi(
      Array.from({ length: 8 }, (_, i) => ({
        id: `e${i}`,
        type: 'ascent_created',
        createdAt: `2026-09-22T10:0${i}:00.000Z`,
        actorLabel: `Juge ${i}`,
      })),
    )
    const wrapper = open(makePulse(dashboard()))
    await flushPromises()
    const panel = wrapper.get('[data-testid="panel-activity"]')
    expect(panel.findAll('li')).toHaveLength(5)
    expect(panel.text()).toContain('Passage saisi')

    await panel.get('button').trigger('click')
    expect(wrapper.emitted('open')?.[0]).toEqual(['activity-log'])
  })
})
