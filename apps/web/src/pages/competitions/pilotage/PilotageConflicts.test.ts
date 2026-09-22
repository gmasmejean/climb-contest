import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import PilotageConflicts from './PilotageConflicts.vue'

const GROUP = '0192f0c0-0000-7000-8000-000000000099'
const ROUTE = '0192f0c0-0000-7000-8000-000000000030'
const LEA = '0192f0c0-0000-7000-8000-0000000000a1'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function ascent(id: string, overrides: Record<string, unknown> = {}) {
  return {
    ascent: {
      id,
      competitionId: 'c1',
      roundId: 'r1',
      routeId: ROUTE,
      competitorId: LEA,
      holdNumber: 25,
      holdCount: 40,
      modifier: 'none',
      isTop: false,
      status: 'valid',
      scoreValue: '25',
      climbTimeMs: null,
      recordedByJudgeId: 'j1',
      recordedByUserId: null,
      recordedAt: '2026-09-22T10:00:00.000Z',
      syncedAt: '2026-09-22T10:00:01.000Z',
      deviceId: 'device-1',
      supersededBy: null,
      conflictGroup: GROUP,
      voidedAt: null,
      createdAt: '2026-09-22T10:00:01.000Z',
      updatedAt: '2026-09-22T10:00:01.000Z',
      ...overrides,
    },
    judgeDisplayName: 'Ana',
  }
}

function stubApi(ascents: ReturnType<typeof ascent>[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request): Promise<Response> => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.endsWith('/conflicts')) {
        return Promise.resolve(
          jsonResponse([
            {
              conflictGroup: GROUP,
              kind: ascents.length === 1 ? 'revoked_access' : 'conflict',
              competitionId: 'c1',
              roundId: 'r1',
              routeId: ROUTE,
              competitorId: LEA,
              ascents,
            },
          ]),
        )
      }
      if (url.endsWith('/competitors')) {
        return Promise.resolve(
          jsonResponse([
            { id: LEA, bib: 47, firstName: 'Léa', lastName: 'Martin', categoryId: 'cat' },
          ]),
        )
      }
      if (url.endsWith('/routes')) {
        return Promise.resolve(jsonResponse([{ id: ROUTE, number: 3, name: 'Le surplomb' }]))
      }
      return Promise.reject(new Error(`URL non gérée par ce test : ${url}`))
    }),
  )
}

function open() {
  return mount(PilotageConflicts, {
    props: { competitionId: 'c1' },
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

describe('PilotageConflicts — vis-à-vis (Lot 20)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('dit sur quoi les saisies diffèrent', async () => {
    stubApi([
      ascent('0192f0c0-0000-7000-8000-0000000000f1'),
      ascent('0192f0c0-0000-7000-8000-0000000000f2', { holdNumber: 27 }),
    ])
    const wrapper = open()
    await flushPromises()
    expect(wrapper.get('[data-testid="conflict-difference"]').text()).toBe(
      'Ces saisies diffèrent sur la prise.',
    )
  })

  it('nomme plusieurs champs quand plusieurs diffèrent', async () => {
    stubApi([
      ascent('0192f0c0-0000-7000-8000-0000000000f1'),
      ascent('0192f0c0-0000-7000-8000-0000000000f2', {
        holdNumber: null,
        isTop: true,
        modifier: 'plus',
      }),
    ])
    const wrapper = open()
    await flushPromises()
    expect(wrapper.get('[data-testid="conflict-difference"]').text()).toBe(
      'Ces saisies diffèrent sur le TOP, la prise, le modificateur.',
    )
  })

  it('ne dit rien pour une quarantaine à une seule saisie', async () => {
    // ADR-078 : un groupe solitaire n'est pas un désaccord, il n'y a rien à comparer.
    stubApi([ascent('0192f0c0-0000-7000-8000-0000000000f1')])
    const wrapper = open()
    await flushPromises()
    expect(wrapper.find('[data-testid="conflict-difference"]').exists()).toBe(false)
    expect(wrapper.text()).toContain("Saisie d'un accès révoqué")
  })

  it('garde le sujet du conflit et met les valeurs côte à côte', async () => {
    stubApi([
      ascent('0192f0c0-0000-7000-8000-0000000000f1'),
      ascent('0192f0c0-0000-7000-8000-0000000000f2', { holdNumber: 27 }),
    ])
    const wrapper = open()
    await flushPromises()
    expect(wrapper.get('[data-testid="conflict-subject"]').text()).toContain(
      'Dossard 47 — Léa Martin',
    )
    expect(wrapper.get('[data-testid="conflict-subject"]').text()).toContain('Voie 3')
    expect(wrapper.findAll('[data-testid^="conflict-ascent-"]')).toHaveLength(2)
  })
})
