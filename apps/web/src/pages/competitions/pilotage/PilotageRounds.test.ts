import { useToast } from '@climbcontest/ui'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import PilotageRounds from './PilotageRounds.vue'

const ROUND = '0192f0c0-0000-7000-8000-000000000010'
const ROUTE = '0192f0c0-0000-7000-8000-000000000020'
const U16 = '0192f0c0-0000-7000-8000-000000000001'
const U18 = '0192f0c0-0000-7000-8000-000000000002'

type Status = 'draft' | 'open' | 'closed' | 'published'

function dashboard(states: { id: string; label: string; status: Status }[]) {
  return {
    computedAt: '2026-09-20T10:00:00.000Z',
    categories: states.map((s) => ({
      categoryId: s.id,
      label: s.label,
      routes: [
        {
          routeId: ROUTE,
          number: 1,
          name: null,
          roundId: ROUND,
          roundStatus: s.status,
          done: 0,
          expected: 3,
          lastAscentAt: null,
        },
      ],
    })),
    competitorsPending: [],
    judges: [],
    alerts: [],
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

interface Posted {
  url: string
  body: { status: string; categoryIds: string[] }
}

/** Stub de `fetch` : le tableau de bord, la liste des tours, les qualifiés, et l'enregistrement des POST. */
function stubApi(
  states: { id: string; label: string; status: Status }[],
  postResponse: () => Response = () =>
    jsonResponse({ roundId: ROUND, categories: [], competitionStatus: 'running' }),
): Posted[] {
  const posted: Posted[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (init?.method === 'POST') {
        const raw = init.body
        if (typeof raw !== 'string') throw new Error('Corps de requête inattendu dans ce test.')
        posted.push({ url, body: JSON.parse(raw) as Posted['body'] })
        return Promise.resolve(postResponse())
      }
      if (url.endsWith('/dashboard')) return Promise.resolve(jsonResponse(dashboard(states)))
      if (url.endsWith('/rounds')) {
        return Promise.resolve(
          jsonResponse([{ id: ROUND, type: 'qualification', displayOrder: 0 }]),
        )
      }
      if (url.endsWith('/qualifiers')) {
        return Promise.resolve(jsonResponse({ roundId: ROUND, categories: [] }))
      }
      return Promise.reject(new Error(`URL non gérée par ce test : ${url}`))
    }),
  )
  return posted
}

function open() {
  return mount(PilotageRounds, {
    props: { competitionId: 'c1', format: 'phases' },
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

describe('PilotageRounds — statut par catégorie (ADR-065)', () => {
  beforeEach(() => {
    const { toasts } = useToast()
    toasts.splice(0, toasts.length)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('montre un état distinct pour chaque catégorie d’un même tour', async () => {
    stubApi([
      { id: U16, label: 'U16', status: 'closed' },
      { id: U18, label: 'U18', status: 'draft' },
    ])
    const wrapper = open()
    await flushPromises()

    expect(wrapper.find(`[data-testid="round-${ROUND}-category-${U16}"]`).text()).toContain('Fermé')
    expect(wrapper.find(`[data-testid="round-${ROUND}-category-${U18}"]`).text()).toContain(
      'Brouillon',
    )
  })

  it('n’ouvre que la catégorie dont on clique le bouton', async () => {
    const posted = stubApi([
      { id: U16, label: 'U16', status: 'closed' },
      { id: U18, label: 'U18', status: 'draft' },
    ])
    const wrapper = open()
    await flushPromises()

    await wrapper.get('button[aria-label="Ouvrir — U18"]').trigger('click')
    await flushPromises()

    expect(posted).toHaveLength(1)
    expect(posted[0]?.url).toBe(`/api/v1/competitions/c1/round-status/${ROUND}`)
    expect(posted[0]?.body).toEqual({ status: 'open', categoryIds: [U18] })
  })

  it('propose les actions de chaque catégorie selon son propre état', async () => {
    stubApi([
      { id: U16, label: 'U16', status: 'open' },
      { id: U18, label: 'U18', status: 'draft' },
    ])
    const wrapper = open()
    await flushPromises()

    // Ouverte : fermer ou repasser en brouillon. Brouillon : ouvrir seulement.
    expect(wrapper.find('button[aria-label="Fermer — U16"]').exists()).toBe(true)
    expect(wrapper.find('button[aria-label="Ouvrir — U16"]').exists()).toBe(false)
    expect(wrapper.find('button[aria-label="Ouvrir — U18"]').exists()).toBe(true)
    expect(wrapper.find('button[aria-label="Fermer — U18"]').exists()).toBe(false)
  })

  it('l’action groupée cible toutes les catégories éligibles', async () => {
    const posted = stubApi([
      { id: U16, label: 'U16', status: 'draft' },
      { id: U18, label: 'U18', status: 'draft' },
    ])
    const wrapper = open()
    await flushPromises()

    const bulk = wrapper.findAll('button').find((b) => b.text() === 'Ouvrir (2 catégories)')
    expect(bulk).toBeDefined()
    await bulk?.trigger('click')
    await flushPromises()

    expect(posted[0]?.body).toEqual({ status: 'open', categoryIds: [U16, U18] })
  })

  it('ne propose pas d’action groupée avec une seule catégorie', async () => {
    stubApi([{ id: U16, label: 'U16', status: 'draft' }])
    const wrapper = open()
    await flushPromises()

    expect(wrapper.text()).not.toContain('Plusieurs catégories d\'un coup')
  })

  it('montre le message du serveur, tel quel, quand la transition est refusée', async () => {
    stubApi(
      [{ id: U16, label: 'U16', status: 'draft' }],
      () =>
        jsonResponse(
          {
            title: 'Tour précédent non terminé',
            detail: 'Fermez d’abord « Qualification » pour ouvrir la demi-finale.',
          },
          409,
        ),
    )
    const wrapper = open()
    await flushPromises()

    await wrapper.get('button[aria-label="Ouvrir — U16"]').trigger('click')
    await flushPromises()

    const { toasts } = useToast()
    expect(toasts.map((t) => t.text)).toContain(
      'Fermez d’abord « Qualification » pour ouvrir la demi-finale.',
    )
    expect(toasts.find((t) => t.variant === 'error')).toBeDefined()
  })
})
